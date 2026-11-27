import {el,button,dialog,table,errorText} from '../shared/dom.mjs';

const versionFormat=/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/;
const shaFormat=/^[a-f0-9]{64}$/;
const fileLimit=720*1024, sourceLimit=512*1024;
const versionName=m=>m?.version||'官網隨附版本';
const sameManifest=(a,b)=>!!a&&!!b&&['environment','protocol','version','entry','bytes','sha256'].every(k=>a[k]===b[k]);
const sameRelease=(a,b)=>a===null&&b===null||sameManifest(a,b);
const publisher=api=>api.person()?.role==='owner'&&api.can('technical.release');
function validManifest(m,env){
  return m&&m.environment===env&&m.protocol===1&&typeof m.version==='string'&&versionFormat.test(m.version)&&
    m.entry===m.version+'/controller.mjs'&&Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=sourceLimit&&typeof m.sha256==='string'&&shaFormat.test(m.sha256);
}
export async function readX1Package(file,env){
  if(!file||file.size<1||file.size>fileLimit)throw Error('請選擇 720 KiB 以內的 x1 更新檔。');
  let pkg;
  try{pkg=JSON.parse(await file.text());}catch{throw Error('無法讀取更新檔，請選擇 x1 的 JSON 安裝包。');}
  const m=pkg?.manifest,source=pkg?.sourceBase64;
  if(m?.environment!==env&&['sandbox','stable'].includes(m?.environment))throw Error('這個更新檔屬於另一個環境。');
  if(!validManifest(m,env)||typeof source!=='string'||source.length!==4*Math.ceil(m.bytes/3)||!/^[A-Za-z0-9+/]+={0,2}$/.test(source)){
    throw Error('更新包缺少引擎內容，或版本與檔案規格不符。');
  }
  const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==m.bytes||hash!==m.sha256)throw Error('檔案長度或 SHA-256 校驗失敗，請重新選擇更新檔。');
  return{manifest:{environment:env,protocol:1,version:m.version,entry:m.entry,bytes:m.bytes,sha256:m.sha256},sourceBase64:source};
}

export function readReleaseStatus(result,env,{history=false}={}){
  if(result?.ok!==true||result.environment!==env||result.protocol!==1||!Number.isSafeInteger(result.revision)||result.revision<0||
    !(result.active===null||validManifest(result.active,env))||history&&!Array.isArray(result.history)){
    throw Error('版本服務回執不完整，請重新讀取。');
  }
  if(history){
    const revs=new Set();
    for(const h of result.history){
      if(!Number.isSafeInteger(h?.revision)||h.revision<1||h.revision>result.revision||revs.has(h.revision)||
        !(h.version===null||typeof h.version==='string'&&versionFormat.test(h.version))||!['activate','rollback'].includes(h.action)){
        throw Error('版本歷史不完整，請重新讀取。');
      }
      revs.add(h.revision);
    }
  }
  return result;
}
const releaseErrors={
  UNKNOWN_ACTION:'這個環境尚未提供獨立引擎版本服務。',
  X1_RELEASE_UNAVAILABLE:'這個環境暫時無法讀取引擎版本服務。',
  X1_RELEASE_CONFLICT:'版本已有更新，請重新讀取。',
  X1_VERSION_CONFLICT:'此版號已對應到其他引擎內容，請改用新的版號。',
  BAD_X1_RELEASE_INTEGRITY:'引擎檔案未通過完整性校驗。',
  BAD_X1_RELEASE_SYNTAX:'引擎程式語法不完整，請使用重新建置的更新檔。',
  BAD_X1_RELEASE_DEPENDENCY:'更新檔必須包含完整引擎，不能匯入其他模組。',
  BAD_X1_RELEASE_EXPORTS:'更新檔的引擎版號或啟動介面與規格不符。',
  BAD_X1_RELEASE_ENCODING:'更新檔的程式內容無法解碼。',
  BAD_X1_RELEASE_SIZE:'引擎檔案大小與清單不符。',
  BAD_X1_RELEASE_MANIFEST:'版本清單與本環境或引擎規格不符。',
  BAD_X1_RELEASE_PACKAGE:'無法讀取此 x1 更新檔。',
  BAD_X1_RELEASE_TARGET:'選取的回復版本無效，請重新讀取。',
  VERSION_NOT_FOUND:'選取的版本已無法取得，請重新讀取。',
  NO_DIFFERENCE:'所選版本已經生效，請重新讀取。'
};
const explain=e=>releaseErrors[e.code]||errorText(e);
const stamp=iso=>iso&&!Number.isNaN(Date.parse(iso))?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(iso)):'未提供';
export function mountX1Releases(host,api,check,{environment,onSaved,onStatus}){
  const envName=environment==='sandbox'?'沙盒':'正式站';
  const status=el('p',{class:'li-note',role:'status','aria-live':'polite'},'正在讀取版本紀錄…');
  const reload=button('重新讀取版本',()=>{if(!busy)void refresh();});
  const root=el('section',{class:'li-card'},el('h3',{},'引擎更新'),status);
  host.append(root);
  let current=null,prepared=null,selected=null,busy=false,sequence=0,activeDialog=null,observing=false;
  const file=el('input',{type:'file',accept:'.json,application/json','aria-label':'選擇 x1 更新檔'});
  const verify=button('驗證更新檔',()=>void preview());
  const install=button('預覽啟用',()=>confirmChange('activate'),'li-primary');
  const detail=el('div',{class:'li-x1-candidate','aria-live':'polite'});
  const history=el('div',{class:'li-x1-history'});
  const allowed=publisher(api);
  if(allowed)root.append(el('label',{class:'li-field'},el('span',{},'x1 更新檔'),el('span',{class:'li-x1-file'},file)),detail);
  root.append(el('div',{class:'li-actions'},...(allowed?[verify,install]:[]),reload),history);
  function draw(){
    const ready=!busy&&!!current;
    reload.disabled=busy;file.disabled=busy||!publisher(api);
    verify.disabled=!ready||!selected||!publisher(api);
    install.disabled=!ready||!prepared||prepared.revision!==current.revision||sameManifest(prepared.pkg.manifest,current.active)||!publisher(api);
    for(const b of history.querySelectorAll('button'))b.disabled=!ready||!publisher(api);
  }
  function accept(result){
    current=result;prepared=null;detail.replaceChildren();
    status.textContent='版本設定 r'+result.revision+' · 目前指定 '+versionName(result.active);
    const versions=[...result.history].sort((a,b)=>b.revision-a.revision);
    const rows=versions.map(row=>{
      const label=row.version||'官網隨附版本';
      const action=row.revision===result.revision?'目前設定':(row.version===result.active?.version||(!row.version&&!result.active))?'同目前版本':
        allowed?button('預覽回復',()=>confirmChange('rollback',row)):'';
      return['r'+row.revision+' · '+label,row.action==='activate'?'啟用':'回復',stamp(row.createdAt),action];
    });
    if(result.revision>0)rows.push(['r0 · 官網隨附版本','初始版本','—',result.active&&allowed?button('預覽回復',()=>confirmChange('rollback',{revision:0,version:null})):'']);
    history.replaceChildren(el('h3',{},'版本紀錄'),rows.length?table(['版本','動作','時間','操作'],rows):el('p',{class:'li-note'},'目前使用官網隨附版本，尚無切換紀錄。'));
    onStatus?.(result);draw();
  }
  function invalidate(){
    current=null;prepared=null;detail.replaceChildren();history.replaceChildren();onStatus?.(null);draw();
  }
  async function getStatus(){
    const result=await api.read('x1.release',{action:'status'});check();return readReleaseStatus(result,environment,{history:true});
  }
  async function refresh(){
    const mine=++sequence;busy=true;draw();
    try{
      const result=await getStatus();
      if(mine===sequence){
        const changed=current&&current.revision!==result.revision;
        accept(result);if(changed)onSaved?.(result);
      }
    }
    catch(e){if(mine===sequence&&root.isConnected){invalidate();status.textContent=explain(e);}}
    finally{if(mine===sequence){busy=false;draw();}}
  }
  async function observe(){
    if(busy||observing||!current)return;
    const mine=sequence,before=current;
    observing=true;
    try{
      const fresh=await getStatus();
      if(busy||sequence!==mine||current!==before||fresh.revision<=before.revision)return;
      activeDialog?.close();accept(fresh);
      if(selected)detail.textContent='版本已在別處更新；請重新驗證 '+selected.name+'。';
    }catch{ /* Keep the last confirmed history until manual readback or the next refresh. */ }
    finally{observing=false;}
  }
  file.addEventListener('change',()=>{
    selected=file.files?.[0]||null;prepared=null;
    detail.textContent=selected?'已選擇 '+selected.name+'，請驗證檔案。':'';draw();
  });
  async function preview(){
    if(verify.disabled||!publisher(api))return;
    const mine=++sequence,chosen=selected;prepared=null;busy=true;draw();
    try{
      check();detail.textContent='正在核對環境、引擎檔案與版本…';
      const pkg=await readX1Package(chosen,environment);check();if(mine!==sequence||selected!==chosen)return;
      if(!publisher(api))throw Object.assign(Error(),{code:'FORBIDDEN'});
      const result=await api.read('x1.release',{action:'preview',package:pkg});check();
      if(mine!==sequence||selected!==chosen)return;
      readReleaseStatus(result,environment);
      if(!sameManifest(result.candidate,pkg.manifest))throw Error('驗證回執與所選更新檔不同，請重新選擇。');
      if(result.revision!==current?.revision||!sameRelease(current.active,result.active)){
        accept(await getStatus());status.textContent+=' · 驗證期間版本已變更，請再核對。';return;
      }
      prepared={pkg,revision:result.revision};
      detail.replaceChildren(el('strong',{},'校驗通過 · x1 '+pkg.manifest.version),el('p',{class:'li-note'},envName+' · '+pkg.manifest.bytes.toLocaleString()+' bytes'+(sameManifest(result.active,pkg.manifest)?' · 已是目前指定版本':'')));
    }catch(e){if(mine===sequence&&root.isConnected)detail.textContent=explain(e);}
    finally{if(mine===sequence){busy=false;draw();}}
  }
  function confirmChange(action,target){
    if(!current||busy||!publisher(api)||action==='activate'&&install.disabled)return;
    check();
    const before=current, pkg=prepared?.pkg,revision=before.revision, requestId=crypto.randomUUID();
    const next=action==='activate'?pkg.manifest.version:target.version;
    const verb=action==='activate'?'啟用':'回復';
    const d=dialog('確認'+verb+' x1',{close:()=>{if(activeDialog===d)activeDialog=null;}});activeDialog=d;
    d.content.append(el('p',{},envName+'將從 '+versionName(before.active)+' 切換至 '+(next||'官網隨附版本')+'。'),
      el('p',{class:'li-note'},'使用 x1 的同事完成目前工作並切回一般對話後，系統會套用版本。'));
    const submit=button('確認'+verb,async()=>{
      if(busy||submit.disabled)return;
      let ambiguous=false;
      try{
        check();if(!publisher(api))throw Object.assign(Error(),{code:'FORBIDDEN'});
        busy=true;submit.disabled=true;draw();
        const payload=action==='activate'?{action,package:pkg,confirm:'CONFIRM_X1_RELEASE'}:{action,targetRevision:target.revision,confirm:'CONFIRM_X1_ROLLBACK'};
        let receipt;
        try{
          receipt=await api.write('x1.release',{...payload,expectedRevision:revision,requestId});
          readReleaseStatus(receipt,environment);
        }catch(e){
          if(!e.verificationRequired&&!['SERVICE_UNAVAILABLE','X1_RELEASE_UNAVAILABLE'].includes(e.code))throw e;
          ambiguous=true;
        }
        check();const fresh=await getStatus();check();
        const matched=(r)=>r.revision===revision+1&&(action==='activate'?sameManifest(r.active,pkg.manifest):(r.active?.version??null)===next);
        accept(fresh);onSaved?.(fresh);
        if(!matched(fresh)||receipt&&!matched(receipt))status.textContent+=' · 已重新讀取最新版本，請核對此次切換。';
        else{selected=null;file.value='';status.textContent+=ambiguous?' · 已重讀核對':' · 已確認'+verb;}
        d.close();
      }catch(e){
        if(!root.isConnected||e.code==='STALE_SESSION'){d.close();return;}
        if(['REVISION_CONFLICT','X1_RELEASE_CONFLICT','STALE_REVISION','REVISION_CHANGED'].includes(e.code)){
          d.close();busy=false;await refresh();if(current)status.textContent+=' · 版本已有更新，請重新核對。';return;
        }
        d.status.textContent=ambiguous||e.verificationRequired?'寫入結果待核對，可重新讀取版本紀錄。':explain(e);
      }finally{busy=false;submit.disabled=false;draw();}
    },'li-primary');
    d.content.append(el('div',{class:'li-actions'},submit,button('返回',()=>d.close())));
  }
  void refresh();
  return{observe,dispose(){sequence++;activeDialog?.close();selected=prepared=null;root.remove();}};
}
