const invalid = code => Object.assign(new Error(code), {code});

export function readPolicyReceipt(result, environment) {
  const content = result?.content;
  if (!environment || result?.ok !== true || result.protocol !== 1 ||
      result.environment !== environment || !Number.isSafeInteger(result.revision) ||
      result.revision < 0 || !content ||
      ['enabled', 'modelReview', 'diagnosticsEnabled'].some(key => typeof content[key] !== 'boolean')) {
    throw invalid('X1_POLICY_UNAVAILABLE');
  }
  return {...Object.fromEntries(['enabled', 'modelReview', 'diagnosticsEnabled'].map(k => [k, content[k]])), revision:result.revision};
}

export function readCurrentPolicy(api) {
  const epoch = api.epoch(), actor = api.person();
  if (!actor) return Promise.reject(invalid('AUTH_REQUIRED'));
  return api.read('x1.settings', {action:'read'}).then(result => {
    if (epoch !== api.epoch() || actor.employeeId !== api.person()?.employeeId || actor.environment !== api.person()?.environment) {
      throw invalid('STALE_SESSION');
    }
    return readPolicyReceipt(result, actor.environment);
  });
}

export function samePolicy(left, right) {
  return ['enabled', 'modelReview', 'diagnosticsEnabled'].every(key => left?.[key] === right?.[key]);
}
