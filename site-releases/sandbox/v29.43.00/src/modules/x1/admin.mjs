import {el,button,dialog,errorText} from '../shared/dom.mjs';
import {readCurrentPolicy,readPolicyReceipt,samePolicy} from './policy.mjs';
import {mountX1Releases} from './admin-releases.mjs';

const switches = {
  enabled:'在聊天中使用 LEAVES AI x1',
  modelReview:'依公司 SOP 核對報價',
  diagnosticsEnabled:'在 AI 對話檢測中記錄 x1 流程'
};
const environmentName = env => env==='sandbox'?'沙盒':'正式站';
export function mountX1Admin(host,api,check,{siteVersion,onPolicyChanged,onReleaseChanged}) {
  const environment=api.person().environment;
  const summary=el('dl',{class:'li-x1-versions'});
  const values=['使用環境','官網版本','環境已指定的 x1','本視窗使用的 x1'].map(label=>{
    const value=el('dd',{},'讀取中');
    summary.append(el('div',{},el('dt',{},label),value));
    return value;
  });
  values[0].textContent=environmentName(environment);
  values[1].textContent=siteVersion||'未提供';
  const policyHost=el('div'),releaseHost=el('div');
  const root=el('section',{class:'li-x1-admin'},summary,policyHost,releaseHost);
  host.append(root);
  const readEngine=()=>globalThis.window?.leavesIdentityApp?.x1?.getEngineStatus?.()||{};
  let approvedRevision=null;
  const updateEngine=()=>{
    const engine=readEngine();
    let note='';
    if(engine.state==='failed')note='（版本校驗或載入失敗）';
    else if(engine.state==='unavailable')note='（版本檢查未開放）';
    else if(engine.pendingVersion)note='（切回一般對話後套用 '+engine.pendingVersion+'）';
    else if(approvedRevision!==null&&Number.isInteger(engine.adoptedRevision)&&approvedRevision!==engine.adoptedRevision)note='（等待同步）';
    values[3].textContent=engine.activeVersion?engine.activeVersion+note:'尚未載入';
  };
  updateEngine();
  const policy=api.can('technical.settings')?mountX1Settings(policyHost,api,check,onPolicyChanged):null;
  const releases=mountX1Releases(releaseHost,api,check,{
    environment,onSaved:onReleaseChanged,
    onStatus:result=>{
      approvedRevision=result?.revision??null;
      const embedded=readEngine().embeddedVersion;
      values[2].textContent=result?(result.active?.version||(embedded?embedded+'（官網隨附）':'官網隨附版本')):'未能讀取';
      updateEngine();
    }
  });
  function syncWindow(){
    if(!root.isConnected||document.hidden)return;
    updateEngine();void policy?.observe();void releases.observe();
  }
  window.addEventListener('leaves:x1-engine-status',syncWindow);
  window.addEventListener('focus',syncWindow);
  return {dispose(){window.removeEventListener('focus',syncWindow);window.removeEventListener('leaves:x1-engine-status',syncWindow);releases.dispose();policy?.dispose();root.remove();}};
}

export function mountX1Settings(host,api,check,onSaved) {
  if (!api.can('technical.settings')) return;
  const environment=api.person().environment;
  const heading=el('h3',{},'使用設定');
  const status=el('p',{class:'li-note',role:'status','aria-live':'polite'},'正在讀取設定…');
  const grid=el('div',{class:'li-permission-grid'});
  const section=el('section',{class:'li-card',id:'leavesX1Settings'},heading,status,grid);
  host.append(section);
  const save=button('預覽設定',preview);
  const reload=button('重新讀取設定',()=>{if(!busy)void load();});
  section.append(el('div',{class:'li-actions'},save,reload));
  const controls=new Map();
  let stored=null, draft={},pending=null,busy=false,sequence=0,activeDialog=null,observing=false;
  let pausedReview=null;
  for(const [key,label] of Object.entries(switches)){
    if(key==='diagnosticsEnabled'&&environment!=='sandbox')continue;
    const caption=el('span',{},'讀取中');
    const toggle=button('',()=>{
      if(toggle.disabled)return;
      const enabled=!draft[key];
      draft={...draft,[key]:enabled};
      if(key==='enabled'){
        if(!enabled){pausedReview=draft.modelReview;draft.modelReview=false;}
        else if(pausedReview!==null){draft.modelReview=pausedReview;pausedReview=null;}
      }
      pending=null;draw();
      if(key==='enabled'){
        status.textContent='設定 r'+stored.revision+' · '+(stored.enabled?'已開放同事使用':'已關閉');
        if(!samePolicy(draft,stored)){
          if(enabled&&!draft.modelReview)status.textContent+=' · 若要依公司 SOP 核對報價，請一起開啟該項設定。';
          if(!enabled&&stored.modelReview)status.textContent+=' · 儲存後會一併關閉 SOP 報價核對。';
        }
      }
    },'li-permission-toggle');
    toggle.append(el('span',{},label),caption);
    controls.set(key,{toggle,caption});grid.append(toggle);
  }
  function draw(){
    const ready=!!stored&&!busy;
    for(const [key,{toggle,caption}] of controls){
      const changed=!!stored&&draft[key]!==stored[key];
      toggle.disabled=!ready||(key!=='enabled'&&!draft.enabled);
      // The indicator shows the confirmed setting until a new revision is read back.
      toggle.setAttribute('aria-pressed',String(!!stored?.[key]));
      toggle.setAttribute('aria-busy',String(busy));
      const suspended=key==='diagnosticsEnabled'&&stored?.[key]&&!stored.enabled&&!changed;
      toggle.dataset.suspended=String(!!suspended);
      caption.textContent=!stored?'未讀取':suspended?'暫停（保留設定）':changed?(draft[key]?'待開啟':'待關閉'):(stored[key]?'已開啟':'已關閉');
      toggle.dataset.changed=String(changed);
    }
    save.disabled=!ready||samePolicy(draft,stored);
    reload.disabled=busy;
  }
  function accept(value){
    stored=value;draft={...value};pending=null;pausedReview=null;
    status.textContent='設定 r'+value.revision+' · '+(value.enabled?'已開放同事使用':'已關閉');
    draw();
  }
  async function load(){
    const mine=++sequence;busy=true;draw();
    try{
      const value=await readCurrentPolicy(api);check();if(mine===sequence)accept(value);
    }catch(e){
      if(mine!==sequence||!section.isConnected)return;
      stored=null;draft={};
      status.textContent=['UNKNOWN_ACTION','X1_POLICY_UNAVAILABLE'].includes(e.code)?'此環境尚未提供 x1 設定服務。':'無法讀取 x1 設定。'+errorText(e);
    }finally{if(mine===sequence){busy=false;draw();}}
  }
  async function observe(){
    if(busy||observing||!stored)return;
    const before=stored,mine=sequence;
    observing=true;
    try{
      const fresh=await readCurrentPolicy(api);check();
      if(busy||sequence!==mine||stored!==before||fresh.revision<=before.revision)return;
      const edits=Object.fromEntries(Object.keys(switches).filter(k=>draft[k]!==before[k]).map(k=>[k,draft[k]]));
      activeDialog?.close();accept(fresh);
      if(Object.keys(edits).length){
        Object.assign(draft,edits);
        if(!draft.enabled){pausedReview=fresh.enabled?fresh.modelReview:null;draft.modelReview=false;}
        status.textContent+=' · 別處已更新設定，請核對保留的變更。';draw();
      }
    }catch{ /* Keep the last confirmed values; the explicit reload reports service errors. */ }
    finally{observing=false;}
  }
  function preview(){
    if(save.disabled||!stored||!api.can('technical.settings'))return;
    check();
    const expected=stored.revision,content=Object.fromEntries(Object.keys(switches).map(k=>[k,draft[k]]));
    const d=dialog('確認 x1 設定',{close:()=>{if(activeDialog===d)activeDialog=null;}});activeDialog=d;
    d.content.append(el('p',{},'套用至'+environmentName(environment)+'。'));
    for(const key of Object.keys(switches)){
      if(content[key]!==stored[key])d.content.append(el('p',{},switches[key]+'　'+(stored[key]?'開啟':'關閉')+' → '+(content[key]?'開啟':'關閉')));
    }
    const submit=button('確認儲存',async()=>{
      if(busy||submit.disabled)return;
      let unknown=false;
      try{
        check();if(!api.can('technical.settings'))throw Object.assign(Error(),{code:'FORBIDDEN'});
        busy=true;submit.disabled=true;draw();
        const requestId=pending?.expected===expected&&samePolicy(pending.content,content)?pending.requestId:crypto.randomUUID();
        pending={requestId,expected,content};
        let result;
        try{
          const receipt=await api.write('x1.settings',{action:'save',requestId,expectedRevision:expected,confirm:'CONFIRM_X1_SETTINGS',content});
          result=readPolicyReceipt(receipt,environment);
        }catch(e){
          if(!e.verificationRequired&&!['SERVICE_UNAVAILABLE','X1_POLICY_UNAVAILABLE'].includes(e.code))throw e;
          unknown=true;
        }
        check();const fresh=await readCurrentPolicy(api);check();
        if(fresh.revision!==expected+1||!samePolicy(fresh,content)||(result&&result.revision!==fresh.revision)){
          accept(fresh);status.textContent='已重讀設定 r'+fresh.revision+'，請核對後再修改。';onSaved?.(fresh);
        }else{accept(fresh);onSaved?.(fresh);if(unknown)status.textContent+=' · 已重新讀取確認';}
        d.close();
      }catch(e){
        if(e.code==='STALE_SESSION'||!section.isConnected){d.close();return;}
        if(/CONFLICT|STALE_REVISION|REVISION_CHANGED/.test(e.code||'')){
          d.close();busy=false;await load();if(stored)status.textContent+=' · 設定已有更新，請重新核對。';return;
        }
        d.status.textContent=unknown||e.verificationRequired?'寫入狀態待核對，可重新讀取。':errorText(e);
      }finally{busy=false;submit.disabled=false;draw();}
    },'li-primary');
    d.content.append(el('div',{class:'li-actions'},submit,button('返回',()=>d.close())));
  }
  draw();void load();
  return{observe,dispose(){sequence++;activeDialog?.close();section.remove();}};
}
