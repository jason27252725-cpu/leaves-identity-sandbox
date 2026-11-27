const invalid=code=>Object.assign(new Error(code),{code});
const traceIdOK=id=>typeof id==='string' && /^[a-f0-9-]{36}$/i.test(id);
const temporary=new Set(['SERVICE_UNAVAILABLE','QUEUE_RESULT_UNKNOWN','QUEUE_FINISHED','AI_INVALID_RESPONSE','X1_INVALID_RESPONSE','AI_OUTPUT_TRUNCATED','AI_EMPTY_RESPONSE','BAD_X1_ANALYSIS']);

export function createReviewTransport({api,send,pause,canTrace,trace}) {
  return async function request({query,items},signal,notify,id) {
    const actor=api.person(),epoch=api.epoch();
    if(!actor)throw invalid('AUTH_REQUIRED');
    const scope=JSON.stringify(actor.permissions),diagnostics=traceIdOK(id)&&canTrace();
    const request={x1:{version:'1',query,items},messages:[{role:'user',content:query}],queueVersion:1,attempt:1,requestId:crypto.randomUUID()};
    if(diagnostics)request.diagnostics=1;
    const current=()=>api.epoch()===epoch && actor.employeeId===api.person()?.employeeId &&
      actor.environment===api.person()?.environment && actor.revision===api.person()?.revision &&
      JSON.stringify(api.person()?.permissions)===scope;
    for(let attempt=1;;attempt++) {
      signal?.throwIfAborted();
      if(!current())throw invalid('STALE_SESSION');
      request.attempt=attempt;
      try {
        const queued=state=>{
          notify?.(state);
          if(diagnostics && state && canTrace())trace(id,request.requestId,state.diagnostics,'排隊中');
        };
        const response=await send(request,signal,queued);
        signal?.throwIfAborted();
        if(!current())throw invalid('STALE_SESSION');
        if(diagnostics && canTrace())trace(id,request.requestId,response?.diagnostics,null);
        if(response?.ok!==true || !response.x1Review || !Array.isArray(response.x1Review.items))throw invalid('X1_INVALID_RESPONSE');
        const model=response.model;
        return typeof model==='string' && /^[A-Za-z0-9_.:/-]{1,100}$/.test(model)?{...response.x1Review,model}:response.x1Review;
      } catch(e) {
        const code=e?.code||'SERVICE_UNAVAILABLE';
        if(diagnostics && canTrace())trace(id,request.requestId,e.diagnostics,code);
        if(signal?.aborted || !current() || attempt>=3 || !temporary.has(code))throw e;
        notify?.({reason:code==='SERVICE_UNAVAILABLE'?'CONNECTION':'ANALYSIS_RETRY',seconds:attempt*2});
        await pause(attempt*2000,signal);
        // Reconcile an ambiguous network outcome under the existing job ID.
        // A completed, unreadable model response is safe to regenerate under a fresh ID.
        if(code!=='SERVICE_UNAVAILABLE')request.requestId=crypto.randomUUID();
      }
    }
  };
}

// Load the optional mode independently of identity, reports and ordinary chat.
export function createX1Runtime(load, options) {
  let controller=null, host=null, detach=null, cleared=0, engine=null, namespace=null;
  const closed=Object.freeze({mode:'default',enabled:false,modelReview:false,diagnosticsEnabled:false});
  let pending=null;
  function ready() {
    if(controller)return Promise.resolve(controller);
    if(!pending) {
      pending=load().then(module=>{
        engine=options.makeEngine?.(module)||null;
        namespace=engine?.getController()||module;
        controller=namespace.createX1Controller(options);
        if(host)detach=controller.attach(host);
        return controller;
      }).catch(()=>{pending=null;return null;});
    }
    return pending;
  }
  return {
    attach(port) {
      detach?.();host=port;detach=controller?.attach(port)||null;
      if(!controller)void ready();
      return ()=>{if(host===port){detach?.();host=null;detach=null;}};
    },
    async handle(text,meta) {return controller?controller.handle(text,meta):null;},
    getMode:()=>controller?.getMode()||'default',
    getState:()=>controller?.getState()||closed,
    async setMode(mode) {
      const generation=cleared, active=await ready();
      if(generation===cleared && active){
        const before=active.getMode();
        const result=await active.setMode(mode);
        if(before!==active.getMode())options.onModeChange?.();
        return result;
      }
      return false;
    },
    async refreshPolicy() {
      const generation=cleared, active=await ready();
      if(active && generation===cleared)return active.refreshPolicy();
      return closed;
    },
    getEngineStatus:()=>engine?.getStatus()||{activeVersion:namespace?.X1_ENGINE_VERSION||'1.0.0',state:'embedded'},
    async checkEngine() {
      await ready();
      return engine?.checkForUpdate();
    },
    adoptEngine() {
      if(!engine || controller?.getMode()!=='default' || controller?.getState()?.busy)return false;
      const previous=namespace;
      engine.activatePending(candidate=>{
        const replacement=candidate.createX1Controller(options);
        if(['attach','handle','clear','setMode','getState','refreshPolicy','invalidateReference','cancel','getMode'].some(key=>typeof replacement?.[key]!=='function'))return false;
        const previousController=controller;
        try {
          detach?.();
          detach=host?replacement.attach(host):null;
        } catch {
          replacement.clear('engine');
          detach=host?previousController.attach(host):null;
          return false;
        }
        controller=replacement;namespace=candidate;
        return true;
      });
      return namespace!==previous;
    },
    clear(reason) {cleared++;controller?.clear(reason);},
    invalidateReference:()=>controller?.invalidateReference(),
    cancel:()=>controller?.cancel()
  };
}
