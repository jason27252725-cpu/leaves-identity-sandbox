const invalid=code=>Object.assign(new Error(code),{code});
const traceIdOK=id=>typeof id==='string' && /^[a-f0-9-]{36}$/i.test(id);
const temporary=new Set(['SERVICE_UNAVAILABLE','QUEUE_RESULT_UNKNOWN','QUEUE_FINISHED','AI_INVALID_RESPONSE','X1_INVALID_RESPONSE','AI_OUTPUT_TRUNCATED','AI_EMPTY_RESPONSE','BAD_X1_ANALYSIS']);

export function createReviewTransport({api,send,pause,canTrace,trace}) {
  return async function request({query,items},signal,notify,id) {
    const actor=api.person(),epoch=api.epoch();
    if(!actor)throw invalid('AUTH_REQUIRED');
    const {employeeId,environment,revision,role}=actor;
    const scope=JSON.stringify(actor.permissions),diagnostics=traceIdOK(id)&&canTrace();
    const request={x1:{version:'1',query,items},messages:[{role:'user',content:query}],queueVersion:1,attempt:1,requestId:crypto.randomUUID()};
    if(diagnostics)request.diagnostics=1;
    const current=()=>{
      const person=api.person();
      return api.epoch()===epoch && !!person && person.employeeId===employeeId &&
        person.environment===environment && person.revision===revision && person.role===role && JSON.stringify(person.permissions)===scope;
    };
    for(let attempt=1;;attempt++) {
      signal?.throwIfAborted();
      if(!current())throw invalid('STALE_SESSION');
      request.attempt=attempt;
      try {
        const queued=state=>{
          if(signal?.aborted||!current())return;
          notify?.(state);
          if(diagnostics && state && canTrace())trace(id,request.requestId,state.diagnostics,'排隊中');
        };
        const response=await send(request,signal,queued);
        signal?.throwIfAborted();
        if(!current())throw invalid('STALE_SESSION');
        if(diagnostics && canTrace())trace(id,request.requestId,response?.diagnostics,null);
        if(response?.ok!==true || !response.x1Review || !Array.isArray(response.x1Review.items))throw invalid('X1_INVALID_RESPONSE');
        const {summary,items,sopRevision}=response.x1Review;
        const review={summary,items,sopRevision};
        if(typeof response.model==='string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(response.model))review.model=response.model;
        const usage={};
        for(const key of ['prompt_tokens','completion_tokens','total_tokens']){
          const count=response.usage?.[key];
          if(Number.isSafeInteger(count)&&count>=0)usage[key]=count;
        }
        if(Object.keys(usage).length)review.usage=usage;
        return review;
      } catch(e) {
        const code=e?.code||'SERVICE_UNAVAILABLE';
        if(diagnostics && !signal?.aborted && current() && canTrace())trace(id,request.requestId,e.diagnostics,code);
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
  let pending=null,modeRequest=0;
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
  const runtime={
    attach(port) {
      detach?.();host=port;detach=controller?.attach(port)||null;
      if(!controller)void ready();
      return ()=>{if(host===port){detach?.();host=null;detach=null;}};
    },
    async handle(text,meta) {return controller?controller.handle(text,meta):null;},
    getMode:()=>controller?.getMode()||'default',
    getState:()=>controller?.getState()||closed,
    async setMode(mode) {
      const mine=++modeRequest,generation=cleared;
      let active=await ready();
      const current=()=>generation===cleared && mine===modeRequest;
      if(!active||!current())return false;
      if(mode==='x1' && active.getMode()==='default' && active.getState()?.enabled && engine){
        // A colleague can select x1 while the first policy/engine check is in
        // flight. Settle that pointer while still safe to replace the host.
        await engine.checkForUpdate();
        if(!current())return false;
        if(runtime.adoptEngine()||active!==controller)await controller.refreshPolicy();
        active=controller;
        if(!current())return false;
      }
      const before=active.getMode();
      const result=await active.setMode(mode);
      if(current()&&before!==active.getMode())options.onModeChange?.();
      return current()&&result;
    },
    async refreshPolicy() {
      const generation=cleared, active=await ready();
      if(active && generation===cleared)return active.refreshPolicy();
      return closed;
    },
    getEngineStatus:()=>engine?.getStatus()||{activeVersion:namespace?.X1_ENGINE_VERSION??null,embeddedVersion:namespace?.X1_ENGINE_VERSION??null,state:namespace?'embedded':'loading'},
    invalidateEngine:()=>engine?.invalidate(),
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
          try{replacement.clear('engine');}catch{}
          detach=host?previousController.attach(host):null;
          // Detach clears controller-local policy. Restore it before the next
          // interaction instead of waiting for the next presence heartbeat.
          void Promise.resolve(previousController.refreshPolicy()).catch(()=>{});
          return false;
        }
        controller=replacement;namespace=candidate;
        return true;
      });
      return namespace!==previous;
    },
    clear(reason) {cleared++;if(reason==='session')engine?.invalidate();controller?.clear(reason);},
    invalidateReference:()=>controller?.invalidateReference(),
    cancel:()=>controller?.cancel()
  };
  return runtime;
}
