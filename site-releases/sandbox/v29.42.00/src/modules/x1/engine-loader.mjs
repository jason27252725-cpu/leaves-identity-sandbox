const PAGES_ORIGIN = 'https://jason27252725-cpu.github.io';
const REPOSITORIES = Object.freeze({sandbox: 'leaves-identity-sandbox', stable: 'leaves-system'});
export const X1_ENGINE_PROTOCOL = 1;
const MANIFEST_LIMIT = 8 * 1024;
const ENGINE_LIMIT = 512 * 1024;
const CHECK_LIMIT_MS = 10000;
const VERSION = /^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const textDecoder = new TextDecoder('utf-8', {fatal: true});

function failure(code) { return Object.assign(new Error(code), {code}); }

function compareVersions(a, b) {
 const lhs = a.split('.').map(Number);
 const rhs = b.split('.').map(Number);
 for (let index = 0; index < lhs.length; index++) {
  if (lhs[index] !== rhs[index]) return Math.sign(lhs[index] - rhs[index]);
 }
 return 0;
}

function verifyExports(controller, version) {
 if (!VERSION.test(version) || controller?.X1_ENGINE_VERSION !== version || typeof controller.createX1Controller !== 'function') {
  throw failure('X1_ENGINE_EXPORTS');
 }
 return controller;
}

async function fileBytes(fetchImpl, url, maxBytes, signal) {
 const response = await fetchImpl(url, {signal, mode: 'same-origin', credentials: 'omit', cache: 'no-store', redirect: 'error'});
 if (response?.status === 404) throw failure('X1_ENGINE_NOT_PUBLISHED');
 if (response?.status !== 200 || response.redirected || response.url !== url || !response.body) throw failure('X1_ENGINE_FETCH');
 const declared = response.headers.get('Content-Length');
 if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw failure('X1_ENGINE_SIZE');
 const reader = response.body.getReader();
 const chunks = [];
 let size = 0;
 try {
  while (true) {
   signal.throwIfAborted();
   const {done, value} = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > maxBytes) throw failure('X1_ENGINE_SIZE');
   chunks.push(value);
  }
 } catch (error) {
  await reader.cancel().catch(() => {});
  throw error;
 } finally {
  reader.releaseLock();
 }
 const bytes = new Uint8Array(size);
 let offset = 0;
 for (const chunk of chunks) {
  bytes.set(chunk, offset);
  offset += chunk.byteLength;
 }
 return bytes;
}

function parseManifest(bytes, environment) {
 let manifest;
 try { manifest = JSON.parse(textDecoder.decode(bytes)); }
 catch { throw failure('X1_ENGINE_MANIFEST'); }
 if (!manifest || manifest.environment !== environment || manifest.protocol !== X1_ENGINE_PROTOCOL ||
  typeof manifest.version !== 'string' || !VERSION.test(manifest.version) ||
  manifest.entry !== `${manifest.version}/controller.mjs` || typeof manifest.sha256 !== 'string' ||
  !SHA256.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > ENGINE_LIMIT) {
  throw failure('X1_ENGINE_MANIFEST');
 }
 return manifest;
}

async function digest(bytes) {
 const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
 return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function importBlob(bytes) {
 // Use exactly the validated bytes. Importing the remote URL would refetch them.
 const objectUrl = URL.createObjectURL(new Blob([bytes], {type: 'text/javascript'}));
 try { return await import(objectUrl); }
 finally { URL.revokeObjectURL(objectUrl); }
}

export function createEngineLoader({environment, embedded, origin = globalThis.location?.origin,
 pathname = globalThis.location?.pathname, fetchImpl = globalThis.fetch, importVerified = importBlob}) {
 const safeEnvironment = Object.hasOwn(REPOSITORIES, environment);
 const repositoryPath = safeEnvironment ? `/${REPOSITORIES[environment]}/` : '';
 const base = origin === PAGES_ORIGIN && repositoryPath && typeof pathname === 'string' && pathname.startsWith(repositoryPath)
  ? `${PAGES_ORIGIN}${repositoryPath}releases/x1/` : '';
 let active = verifyExports(embedded, embedded?.X1_ENGINE_VERSION);
 let pending = null;
 let check = null;
 let state = base ? 'idle' : 'unavailable';
 let code = base ? null : 'X1_ENGINE_ORIGIN';

 function getStatus() {
  return Object.freeze({environment, activeVersion: active.X1_ENGINE_VERSION,
   pendingVersion: pending?.controller.X1_ENGINE_VERSION ?? null, source: active === embedded ? 'embedded' : 'repository', state, code});
 }

 function invalidate() {
  const previous = check;
  check = null;
  pending = null;
  state = base ? 'idle' : 'unavailable';
  code = base ? null : 'X1_ENGINE_ORIGIN';
  previous?.controller.abort();
 }

 function activatePending(accept) {
  const candidate = pending?.controller;
  pending = null;
  if (!candidate || compareVersions(candidate.X1_ENGINE_VERSION, active.X1_ENGINE_VERSION) <= 0) return active;
  try {
   const accepted = accept?.(candidate);
   if (accepted === false || typeof accepted?.then === 'function') throw failure('X1_ENGINE_EXPORTS');
  } catch {
   state = 'failed';
   code = 'X1_ENGINE_EXPORTS';
   return active;
  }
  active = candidate;
  state = 'current';
  code = null;
  return active;
 }

 function checkForUpdate({signal} = {}) {
  if (!base || signal?.aborted) return Promise.resolve(getStatus());
  if (check) return check.promise;
  const controller = new AbortController();
  const task = {controller};
  const previousPending = pending;
  pending = null;
  const abort = () => controller.abort();
  const deadline = setTimeout(() => controller.abort(failure('X1_ENGINE_TIMEOUT')), CHECK_LIMIT_MS);
  signal?.addEventListener('abort', abort, {once: true});
  state = 'checking';
  code = null;
  check = task;
  // Freeze the request after login but never keep a silently changed active version.
  task.promise = (async () => {
   const innerSignal = controller.signal;
   try {
    const manifest = parseManifest(await fileBytes(fetchImpl, base + 'manifest.json', MANIFEST_LIMIT, innerSignal), environment);
    innerSignal.throwIfAborted();
    if (compareVersions(manifest.version, active.X1_ENGINE_VERSION) <= 0) {
     if (check === task) state = 'current';
     return getStatus();
    }
    if (previousPending?.controller.X1_ENGINE_VERSION === manifest.version) {
     if (previousPending.sha256 !== manifest.sha256) throw failure('X1_ENGINE_INTEGRITY');
     if (check === task) {
      pending = previousPending;
      state = 'pending';
     }
     return getStatus();
    }
    const bytes = await fileBytes(fetchImpl, base + manifest.entry, manifest.bytes, innerSignal);
    if (bytes.byteLength !== manifest.bytes || await digest(bytes) !== manifest.sha256) throw failure('X1_ENGINE_INTEGRITY');
    innerSignal.throwIfAborted();
    let controllerModule;
    try { controllerModule = await importVerified(bytes); }
    catch { throw failure('X1_ENGINE_IMPORT'); }
    innerSignal.throwIfAborted();
    if (check === task && compareVersions(manifest.version, active.X1_ENGINE_VERSION) > 0) {
     pending = {controller: verifyExports(controllerModule, manifest.version), sha256: manifest.sha256};
     state = 'pending';
    } else if (check === task) state = 'current';
   } catch (error) {
    if (check === task) {
     const timedOut = innerSignal.reason?.code === 'X1_ENGINE_TIMEOUT';
     state = pending ? 'pending' : innerSignal.aborted && !timedOut ? 'idle' : 'failed';
     code = timedOut ? 'X1_ENGINE_TIMEOUT' : innerSignal.aborted ? null :
      typeof error?.code === 'string' && /^X1_ENGINE_[A-Z_]+$/.test(error.code) ? error.code : 'X1_ENGINE_FETCH';
    }
   } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
    if (check === task) check = null;
   }
   return getStatus();
  })();
  return task.promise;
 }

 return Object.freeze({getController: () => active, getStatus, checkForUpdate, activatePending, invalidate});
}
