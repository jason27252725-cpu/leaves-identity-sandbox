import {openReportImport} from '../workforce/report-import.mjs';
import {openReportAction} from './report-action.mjs';
import {tracing,recordAttempt,clearDiagnostics,beginDiagnostic,recordX1Step,recordX1Dispatch,forgetX1Diagnostics} from './admin-heritage.mjs';
import {readCurrentPolicy} from '../x1/policy.mjs';
import {createX1Runtime,createReviewTransport} from '../x1/transport.mjs';
import {createEngineLoader} from '../x1/engine-loader.mjs';
import {isX1ReportQuestion,reportFollowupContext,rememberReportContext} from '../x1/report-followup.mjs';
import './ui-unification.mjs';
import {reauthenticateOwner} from './release-auth.mjs';
import {openDailyWindow,openTeamDay} from './daily-window.mjs';
import {createIdentityClient} from '../identity/identity-client.mjs';
import {createDraftVault} from '../shared/draft-vault.mjs';
import {installCoreApi} from '../shared/core-api.mjs';
import {createIdentityCost} from '../shared/cost-adapter.mjs';
import {bundledModules} from './bundled-modules.mjs';
import {createModuleSwitch} from './module-switch.mjs';
import {prepareIdentityHandover} from './identity-handover.mjs';
import {loadFoundation} from './module-loader.mjs';
import {checkFoundationUpdates} from './foundation-updates.mjs';
import {startFoundationPoll} from './foundation-poll.mjs';
import {completionResponse,validateChatResult} from '../shared/ai-bridge.mjs';
import {startPresence} from './presence.mjs';
import {mountAdmin,canOpenAdmin} from './admin.mjs';
const switches=createModuleSwitch(bundledModules);let screenSequence=0;
import {el,button,dialog,errorText,roles} from '../shared/dom.mjs';
import {mountUpdates} from './updates.mjs';
const client=createIdentityClient(),vault=createDraftVault(localStorage);let hook=null,screen=null,screenMount=null,sessionEpoch=0,refreshing=false;

function queueDraftName(){
 let tab=sessionStorage.getItem('leaves-chat-tab');
 if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('leaves-chat-tab',tab);}
 return 'chat-queue-'+client.snapshot()?.person?.environment+'-'+tab;
}
async function offerRecovery(){
 const person=api.person(),at=sessionEpoch;
 const key=queueDraftName(),draft=await vault.load(key).catch(()=>null);
 if(!draft||sessionEpoch!==at)return;
 if(draft.expires<=Date.now()||draft.revision!==person.revision||draft.scope!==JSON.stringify(person.permissions)){vault.remove(key);return;}
 const notice=el('aside',{class:'li-card',id:'leavesPendingQuestion'},el('p',{},'上次的聊天問題仍在等待。'));
 Object.assign(notice.style,{position:'fixed',bottom:'18px',right:'18px',zIndex:'10100'});
 notice.append(button('繼續等待',async()=>{
   if(sessionEpoch!==at)return;
   if(window.dispatchEvent(new CustomEvent('leaves:resume-question',{detail:draft,cancelable:true})))notice.remove();
 }),button('取消等待',()=>{notice.remove();vault.remove(key);api.read('ai.queue.cancel',{job:draft.payload.requestId}).catch(()=>{});}));
 document.body.append(notice);
}
export async function resumeQueued(draft,signal,notify){
 const p=api.person();if(!p||draft.revision!==p.revision)throw Error('STALE_SESSION');
 const result=validateChatResult(await queueWithSource(draft.payload,signal,notify,true));sopChat?.noteSource(result.sopReference,result.text);return result;
}
async function queueWithSource(payload,signal,notify,inspectFirst=false){
 const question=payload.messages.at(-1)?.content;
 const kind=payload.x1Report===1?'x1Report':sourceKind(question,payload.reportContext);
 if(!kind||!payload.reportTools)return sendQueued(payload,signal,notify,inspectFirst);
 const epoch=sessionEpoch;
 const limit=AbortSignal.timeout(22000),stop=signal?AbortSignal.any([signal,limit]):limit;
 let lastReason='';
 try{return await sendQueued(payload,stop,s=>{if(s?.reason)lastReason=s.reason;notify?.(s);},inspectFirst);}
 catch(e){
  if(signal?.aborted||sessionEpoch!==epoch||['FORBIDDEN','AUTH_REQUIRED','AUTH_REVOKED','STALE_SESSION'].includes(e.code))throw e;
  if(e?.code==='X1_DISABLED'||e?.code==='X1_POLICY_CHANGED')throw e;
  if(!limit.aborted&&!['AI_TIMEOUT','AI_BUSY','AI_PROVIDER_BUSY','AI_PROVIDER_OVERLOAD','AI_PROVIDER_UNAVAILABLE','AI_DAILY_LIMIT','PROVIDER_DAILY','AI_NOT_CONFIGURED','AI_EMPTY_RESPONSE','SERVICE_UNAVAILABLE'].includes(e.code))throw e;
  const sourceLimit=AbortSignal.timeout(kind==='x1Report'?55000:6500),sourceSignal=signal?AbortSignal.any([signal,sourceLimit]):sourceLimit;
  let result;
  try{result=await guarded(()=>client.call('ai.source',{question,kind,...(['month','x1Report'].includes(kind)?{reportContext:payload.reportContext}: {})},{mutation:false,signal:sourceSignal}));}
  catch(sourceError){
   if(signal?.aborted||epoch!==sessionEpoch||!['SERVICE_UNAVAILABLE','AI_CANCELLED','UNKNOWN_ACTION'].includes(sourceError.code))throw sourceError;
   throw Object.assign(Error('模型與授權資料來源暫時無法回覆，請稍後重試。'),{code:'AI_SOURCE_UNAVAILABLE'});
  }
  if(epoch!==sessionEpoch||signal?.aborted)throw Error('STALE_SESSION');
  const status={AI_BUSY:'服務排隊中',AI_PROVIDER_BUSY:'模型服務限流',AI_PROVIDER_OVERLOAD:'模型服務過載',PROVIDER_DAILY:'模型當日額度已滿',AI_DAILY_LIMIT:'當日額度已滿'}[lastReason||e.code]||'模型未完成回覆';
  result.text=status+'，以下顯示系統核對的資料。\n\n'+result.text;
  return result;
 }
}
export function sourceKind(question,previous=null){
 if(typeof question!=='string'||question.length>800)return null;
 if(/(?:工時|時數)/.test(question)&&/[ISR]\s*\d{5,6}/i.test(question)&&/20\d\d\s*年/.test(question))return 'report';
 if(/(?:本月|這個?月|上個?月|上月|上上個?月)/.test(question)&&(previous||/(?:我|本人).*(?:工時|時數)|(?:工時|時數).*(?:我|本人)/.test(question)))return 'month';
 if(/(?:成員|同事|同仁|設計師|員工).{0,8}(?:名單|有誰|有哪些|是哪位)|組織架構|SOP|公司.{0,12}(?:流程|程序|步驟)|設計流程/i.test(question))return 'sop';
 return null;
}
async function sendQueued(payload,signal,notify,inspectFirst=false){
 const at=sessionEpoch,key=(payload.sopRevision||payload.x1||payload.x1Report)?null:queueDraftName(),revision=api.person()?.revision;
 const call=(action,body,stop)=>guarded(()=>client.call(action,body,{mutation:false,signal:stop}));
 const job=payload.requestId;
 const start=Date.now(),scope=JSON.stringify(api.person()?.permissions);let waited=false;
 const track=state=>{
   if(state)waited=true;
   notify?.(state);
   if(state&&tracing()&&!payload.x1&&!payload.x1Report)recordAttempt(job.replace(/-a[1-3]$/,''),payload.attempt,{...state.diagnostics,modelCalls:state.diagnostics?.modelCalls??0,queries:state.diagnostics?.queries??0,events:[...(state.diagnostics?.events||[]),{kind:'等待 '+state.reason,ms:Date.now()-start}]},'排隊中',Date.now()-start);
 };
 try{
  const result=await driveChatQueue({signal,inspectFirst,notify:track,
   send:async()=>{
    if(waited||inspectFirst){const latest=await guarded(()=>client.refresh({visible:true}));if(sessionEpoch!==at||latest.person.revision!==revision||JSON.stringify(latest.person.permissions)!==scope)throw Object.assign(Error('STALE_SESSION'),{code:'STALE_SESSION'});}
    const result=await call('ai.chat',payload,signal);if(result.queue&&result.diagnostics)result.queue.diagnostics=result.diagnostics;return result;},
   status:()=>call('ai.queue.status',{job},signal),cancel:()=>call('ai.queue.cancel',{job}),
   remember:()=>key&&vault.save(key,{payload,revision,expires:Date.now()+86400000,scope:JSON.stringify(api.person()?.permissions)}).catch(()=>{})});
  if(key&&at===sessionEpoch)vault.remove(key);return result;
 }catch(e){if(key&&at===sessionEpoch&&(signal?.aborted||!['SERVICE_UNAVAILABLE','AUTH_REQUIRED'].includes(e.code)))vault.remove(key);throw e;}
}
const reportActions=new Map();
document.addEventListener('click',event=>{const link=event.target.closest?.('a[href^="#leaves-report-"]');if(!link)return;const item=reportActions.get(link.getAttribute('href'));if(!item)return;event.preventDefault();if(item.epoch===sessionEpoch)openReportAction(api,item.action).catch(e=>alert(errorText(e)));});
let lastQuery=null,querySequence=0;const deadlines=new Map();
export function resetX1ReportContext(){x1ReportMemory=null;}
function resetQuery(){resetX1ReportContext();x1?.clear('session');sopChat?.clear();querySequence++;reportActions.clear();clearDiagnostics();lastQuery=null;deadlines.clear();}
function endUI(){discardX1Policy();document.querySelector('#leavesPendingQuestion')?.remove();resetQuery();sessionEpoch++;screenSequence++;for(const d of [...document.querySelectorAll('.li-dialog')])d.close();screenMount?.dispose();screenMount=null;screen?.close();screen=null;vault.lock();hook?.clear();}
async function guarded(fn){try{return await fn();}catch(e){if(['AUTH_REQUIRED','AUTH_REVOKED'].includes(e.code)){client.forget();endUI();}throw e;}}
export const api=installCoreApi({activeModuleVersion:key=>switches.current(key)?.version,chat:(text,options)=>chat(text,options),person:()=>client.snapshot()?.person||null,can:k=>!!client.snapshot()?.person?.permissions?.[k],read:(a,p={})=>guarded(()=>client.call(a,p,{mutation:false})),
 publicStatus:()=>client.status(),
 openDaily:options=>openDailyWindow(api,options),openMonth:date=>open('workforce',{tab:'monthly',date}),
 write:(a,p={})=>guarded(()=>client.call(a,p,{mutation:true})),
 progress:(a,p={},write=false,options={})=>guarded(()=>client.call('progress',{...p,action:a},{mutation:write,signal:options.signal})),watchTeamDay:(date,options)=>guarded(()=>client.watchTeamDay(date,options)),openTeamChat:(date,role)=>window.dispatchEvent(new CustomEvent('leaves:team-query',{detail:{date,role}})),cost:(a,p={},write=false)=>guarded(()=>client.call('cost',{...p,action:a},{mutation:write})),
 workspace:(a,p={},write=false)=>guarded(()=>client.call('workspace',{...p,action:a},{mutation:write})),plan:p=>guarded(()=>client.plan(p)),confirm:(id,c)=>guarded(()=>client.confirm(id,c)),cancelPreview:()=>client.cancelPreview(),drafts:vault,
 reauthenticate:code=>reauthenticateOwner({client,epoch:()=>sessionEpoch,createClient:createIdentityClient,code}),
 publisher:(body,write=false)=>guarded(()=>client.service('publisher',body,{mutation:write})),
 release:(body,write=false)=>guarded(()=>client.service('release',body,{mutation:write})),router:(body,write=false)=>guarded(()=>client.service('router',body,{mutation:write})),epoch:()=>sessionEpoch});
let x1ReportMemory=null;
let x1Policy=null,policyReadSequence=0;
const x1Tracing=()=>tracing() && api.person()?.role==='owner' && api.person()?.environment==='sandbox' &&
  x1Policy?.diagnosticsEnabled===true && x1Policy?.enabled===true;
function discardX1Policy(){policyReadSequence++;x1Policy=null;forgetX1Diagnostics();}
async function loadX1Policy() {
 const sequence=++policyReadSequence;
 let value;
 try{value=await readCurrentPolicy(api);}catch(e){
  if(sequence===policyReadSequence){x1Policy=null;forgetX1Diagnostics();resetX1ReportContext();}
  throw e;
 }
 if(x1Policy && value.revision<x1Policy.revision)return x1Policy;
 if(sequence!==policyReadSequence && !x1Policy)throw Object.assign(Error('設定讀取已更新'),{code:'X1_POLICY_INVALID'});
 if(sequence===policyReadSequence || (x1Policy && value.revision>x1Policy.revision)){
  x1Policy=value;
  if(!value.enabled || !value.diagnosticsEnabled)forgetX1Diagnostics();
  if(!value.enabled)resetX1ReportContext();
 }
 return value;
}
async function refreshX1Access(){
 const epoch=sessionEpoch,before=api.person();
 if(!before)throw Object.assign(Error('登入已變更'),{code:'AUTH_REQUIRED'});
 const receipt=await guarded(()=>client.refresh({visible:!document.hidden}));
 const current=receipt.person;
 if(epoch!==sessionEpoch || current.employeeId!==before.employeeId || current.environment!==before.environment ||
    current.role!==before.role || current.revision!==before.revision || JSON.stringify(current.permissions)!==JSON.stringify(before.permissions)){
   resetQuery();hook?.permissionsChanged?.();
   throw Object.assign(Error('身分或授權已變更'),{code:'STALE_SESSION'});
 }
 if(receipt.maintenance?.active)throw Object.assign(Error('系統維護中'),{code:'MAINTENANCE'});
}
const reviewTransport=createReviewTransport({api,send:sendQueued,pause:delayQueue,canTrace:x1Tracing,trace:recordX1Dispatch});
export const x1=createX1Runtime(()=>import('../x1/controller.mjs'),{
 person:api.person,epoch:api.epoch,can:api.can,loadPolicy:loadX1Policy,onModeChange:resetX1ReportContext,refreshAccess:refreshX1Access,
 makeEngine:embedded=>createEngineLoader({environment:window.LEAVES_IDENTITY_CONFIG.environment,embedded}),
 sopRevision:async()=>(await api.workspace('sop.read')).sop?.revision,
 request:(input,signal,notify,traceId)=>reviewTransport(input,signal,state=>{
   if(!state)return;
   const reason={ANALYSIS_RETRY:'正在重新解析核對結果',CONNECTION:'連線恢復後會繼續',AI_PROVIDER_BUSY:'模型暫時限流',AI_BUSY:'等待可用模型'}[state.reason]||'等待可用服務';
   notify?.(reason+(Number.isFinite(state.seconds)?'，約 '+state.seconds+' 秒後重試':''));
 },traceId),
 diagnose:event=>{if(x1Tracing())recordX1Step({...event,engineVersion:x1.getEngineStatus().activeVersion});}
});
let engineCheckedEpoch=-1;
function syncX1Policy(){
 if(!api.person()||!(api.can('ai.use')||api.can('technical.settings')))return;
 const at=sessionEpoch;
 void x1.refreshPolicy().then(async()=>{
  if(at!==sessionEpoch || !x1.getState().enabled || engineCheckedEpoch===at)return;
  engineCheckedEpoch=at;await x1.checkEngine();
  if(at===sessionEpoch && x1.getState().enabled && x1.getMode()==='default' && x1.adoptEngine())await x1.refreshPolicy();
 }).catch(()=>{});
}
let policyChannel;
try {
 policyChannel=new BroadcastChannel('leaves-x1-policy-'+window.LEAVES_IDENTITY_CONFIG.environment);
 policyChannel.onmessage=event=>{if(event.data==='refresh')syncX1Policy();};
}catch{}
window.addEventListener('leaves:x1-policy-change',()=>{syncX1Policy();policyChannel?.postMessage('refresh');});
async function revisionRequest(question,sopRevision,signal,notify){
 const payload={messages:[{role:'user',content:question}],sopRevision,requestId:crypto.randomUUID(),attempt:1,queueVersion:1};
 // Analysis is read-only. A lost completed response can be regenerated; proposal writes use a separate receipt path.
 const epoch=sessionEpoch,actor=api.person(),scope=JSON.stringify(actor?.permissions);
 for(let retry=0;;retry++){
  try{return await sendQueued(payload,signal,notify);}
  catch(e){
   if(signal?.aborted||retry>=2||!['SERVICE_UNAVAILABLE','QUEUE_RESULT_UNKNOWN','QUEUE_FINISHED'].includes(e.code))throw e;
   const seconds=5*(retry+1);notify?.({reason:'CONNECTION',seconds});
   await delayQueue(seconds*1000,signal);
   const latest=await guarded(()=>client.refresh({visible:true}));
   if(sessionEpoch!==epoch||latest.person.employeeId!==actor.employeeId||latest.person.revision!==actor.revision||JSON.stringify(latest.person.permissions)!==scope)throw Object.assign(Error('STALE_SESSION'),{code:'STALE_SESSION'});
   if(e.code!=='SERVICE_UNAVAILABLE')payload.requestId=crypto.randomUUID();
  }
 }
}
export let sopChat=null;
export const sopChatReady=import('../sop-revision/chat.mjs').then(({createRevisionChat})=>{
 sopChat=createRevisionChat({api,openPeople:()=>open('people'),
  published:doc=>window.dispatchEvent(new CustomEvent('leaves:sop-published',{detail:{revision:doc.revision}})),
  analyze:revisionRequest,
  classify:async(question,context,signal,notify)=>{
   const answer=await revisionRequest(question,{protocol:1,mode:'intent',...context},signal,notify);
   return answer?.sopDraft?.intent||'clarify';
  }
 });
 return sopChat;
}).catch(()=>null);
export const costs=createIdentityCost(api);
export function attachCore(bridge){hook=bridge;hook.clear();}
export async function login(code){endUI();const e=++sessionEpoch;try{const s=await client.login(code);window.dispatchEvent(new CustomEvent('leaves:auth-stage',{detail:{stage:1,label:'載入介面'}}));await vault.unlock(code,s.person.employeeId);window.dispatchEvent(new CustomEvent('leaves:auth-stage',{detail:{stage:2,label:'準備工作區'}}));if(e!==sessionEpoch)throw Error('登入已變更');if(switches.pending().identity){try{await loadFoundation(switches.pending().identity);if(e!==sessionEpoch)throw Error('登入已變更');prepareIdentityHandover(switches);}catch(err){if(e!==sessionEpoch)throw err;alert('新版身分畫面尚未通過載入檢查，繼續使用原版：'+errorText(err));}}x1.adoptEngine();hook?.authenticated(s.person);await refresh();await offerRecovery().catch(()=>{});return s;}catch(err){if(e===sessionEpoch){client.forget();endUI();}throw err;}}
export async function logout(){endUI();let err;try{await client.logout();}catch(e){err=e;}finally{client.forget();}if(err)throw err;}
export async function refresh({visible=!document.hidden}={}){if(refreshing||!api.person())return;refreshing=true;try{const before=api.person(),s=await guarded(()=>client.refresh({visible}));if(before.revision!==s.person.revision||JSON.stringify(before.permissions)!==JSON.stringify(s.person.permissions)){resetQuery();for(const d of [...document.querySelectorAll('.li-dialog')])d.close();screenMount?.dispose();screenMount=null;screen?.close();screen=null;hook?.permissionsChanged?.();}hook?.authenticated(s.person);hook?.maintenance?.(s.maintenance);if(visible)syncX1Policy();}finally{refreshing=false;}}
export async function open(section='workforce',route=null){
 if(section==='people')return hook?.openAdmin?.('passcodes');
 if(section==='updates')return hook?.openAdmin?.('releaseCenter');
 if(!api.person())throw Error('請先登入');
 if(screen?.box?.open){if(route)await screenMount?.navigate?.(route);screen.box.focus();window.LeavesWindowStack?.raise(screen.box);return;}
 const sequence=++screenSequence;await refresh();if(sequence!==screenSequence)return;
 const root=el('section',{class:'li-shell'}),at=sessionEpoch;
 const d=dialog('進度與工時',{modal:false,width:1100,height:730,close:()=>{screenSequence++;screenMount?.dispose();screenMount=null;screen=null;}});
 screen=d;d.box.id='leavesIdentityWorkspace';d.box.classList.add('li-workspace-window');d.content.append(root);
 window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 try{
  const descriptor=switches.pending().workforce||switches.current('workforce');let module;
  try{module=await loadFoundation(descriptor);if(at===sessionEpoch)switches.adopt('workforce',{safe:true});}
  catch{module=await loadFoundation(switches.current('workforce'));}
  if(at!==sessionEpoch||sequence!==screenSequence)return;
  const mounted=await module.mount(root,api);
  if(at!==sessionEpoch||sequence!==screenSequence){mounted?.dispose();return;}
  screenMount=mounted;if(route)await mounted.navigate?.(route);
 }catch(e){d.status.textContent=errorText(e);}
}
export async function chat(text,{signal,report}={}){const requestId=crypto.randomUUID(),start=Date.now();
 const diagnostics=tracing()&&api.person()?.environment==='sandbox'&&api.person()?.role==='owner';
 if(diagnostics){window.dispatchEvent(new CustomEvent('leaves:diagnostic-start',{detail:{}}));beginDiagnostic(requestId,1);}
 try{
  const result=await guarded(()=>client.call('ai.chat',{messages:[{role:'user',content:text}],requestId,attempt:1,...(report?{report,reportTools:1}:{}),...(diagnostics?{diagnostics:1}:{})},{mutation:false,signal}));
  validateChatResult(result);
  if(diagnostics)recordAttempt(requestId,1,result.diagnostics,null,Date.now()-start);
  return result;
 }catch(e){if(diagnostics)recordAttempt(requestId,1,e.diagnostics,e.code||e.name||'UNKNOWN_ERROR',Date.now()-start);throw e;}
}
export async function chatResponse(messages,{requestId=crypto.randomUUID(),attempt=1,signal,reportTools=false,onQueue=null}={}){
 const inX1=reportTools && x1.getMode()==='x1';
 const reportSession={epoch:sessionEpoch,person:api.person()};
 const remembered=inX1?reportFollowupContext(messages,x1ReportMemory,reportSession):null;
 const reportX1=inX1 && isX1ReportQuestion(messages.at(-1)?.content,remembered);
 const diagnostics=reportX1?x1Tracing():tracing()&&api.person()?.role==='owner'&&api.person()?.environment==='sandbox';
 if(diagnostics){if(reportX1)recordX1Step({stage:'report',id:requestId,engineVersion:x1.getEngineStatus().activeVersion,revision:x1Policy?.revision});else beginDiagnostic(requestId,attempt);}
 const diagnosticResult=(trace,error,elapsed)=>{
   if(!diagnostics)return;
   if(reportX1){if(x1Tracing())recordX1Dispatch(requestId,requestId,trace,error);}
   else recordAttempt(requestId,attempt,trace,error,elapsed);
 };
 const epoch=sessionEpoch,sequence=querySequence;
 const previous=messages.filter(m=>m.role==='assistant').at(-1)?.content;
 const context=reportX1?remembered:(lastQuery&&typeof previous==='string'&&previous.includes(lastQuery.anchor)?lastQuery.plan:null);
 const started=Date.now();
 if(!deadlines.has(requestId))deadlines.set(requestId,started+54000);
 if(deadlines.size>20)deadlines.delete(deadlines.keys().next().value);
 const remaining=deadlines.get(requestId)-started;
 if(!onQueue&&remaining<=0)throw Object.assign(Error('AI_TIMEOUT'),{code:'AI_TIMEOUT'});
 const budget=AbortSignal.timeout(Math.max(1,remaining));
 const bounded=signal?AbortSignal.any([signal,budget]):budget;
 let result;
 try{
   const payload={messages,requestId,attempt,...(reportTools?{reportTools:1,reportContext:context}:{}),...(reportX1?{x1Report:1}:{}),...(diagnostics?{diagnostics:1}:{})};
   result=onQueue?await queueWithSource({...payload,requestId:requestId+'-a'+attempt,queueVersion:1},signal,onQueue):
     await guarded(()=>client.call('ai.chat',payload,{mutation:false,signal:reportTools?bounded:signal}));
   validateChatResult(result);
 }catch(e){
   diagnosticResult(e.diagnostics,e.code||e.name||'UNKNOWN_ERROR',Date.now()-started);
   if(!onQueue&&reportTools&&budget.aborted)throw Object.assign(Error('AI_TIMEOUT'),{code:'AI_TIMEOUT'});
   throw e;
 }
 if(epoch!==sessionEpoch||sequence!==querySequence||signal?.aborted)throw Object.assign(Error('工作階段已變更'),{code:'STALE_SESSION'});
 if(result.action){const href='#leaves-report-'+crypto.randomUUID();reportActions.set(href,{epoch:sessionEpoch,action:result.action});if(reportActions.size>20)reportActions.delete(reportActions.keys().next().value);result.text+='\n\n[開啟月報預覽與匯出]('+href+')';}
 if(reportTools && result.reportProtocol!==1){diagnosticResult(result.diagnostics,'REPORT_GATEWAY_VERSION',Date.now()-started);throw Object.assign(Error('此環境的報表查詢服務尚待更新，請先完成後端版本同步。'),{code:'REPORT_GATEWAY_VERSION'});}
 if(reportX1 && (x1.getMode()!=='x1'||!x1Policy?.enabled))throw Object.assign(Error('x1 已關閉或已切換模式'),{code:'X1_DISABLED'});
 diagnosticResult(result.diagnostics,null,Date.now()-started);
 if(reportX1 && diagnostics && x1Tracing())recordX1Step({stage:'reportResult',id:requestId,revision:x1Policy?.revision,counts:{projects:result.reportContext?.codes?.length}});
 x1ReportMemory=reportX1?rememberReportContext(result,reportSession):null;
 lastQuery=!reportX1&&result.reportContext?{plan:result.reportContext,anchor:result.text.trim().slice(-64)}:null;
 sopChat?.noteSource(result.sopReference,result.text);
 return completionResponse(result);
}
import {watchPublishedPage} from './release-entry.mjs';
watchPublishedPage(window.LEAVES_IDENTITY_CONFIG.environment);
window.addEventListener('focus',()=>refresh().catch(()=>{}));const stopPresence=startPresence({refresh,leave:()=>client.leavePresence(),isLoggedIn:()=>!!api.person(),document,window});window.addEventListener('pagehide',()=>{client.forget();vault.lock();});
const stopPoll=startFoundationPoll(async()=>{if(!api.person())return;const changed=await checkFoundationUpdates(switches);if(changed.length){let n=document.getElementById('identityUpdateNotice');if(!n){n=el('aside',{id:'identityUpdateNotice',role:'status',style:'position:fixed;bottom:12px;right:12px;z-index:9500;background:#262626;padding:12px;border-radius:10px;max-width:360px'});document.body.append(n);}n.replaceChildren(el('span',{},'新版已備妥：身分畫面於下次登入接手，進度畫面關閉後接手。'),button('知道了',()=>n.remove()));}});
window.addEventListener('pagehide',stopPoll);
export {errorText};
export const canAdmin=key=>canOpenAdmin(key,api);
export const mountAdminPanel=(root,key,bridge)=>mountAdmin(root,key,api,{...bridge,mountFoundation,openSopReview:async(host,record)=>(await sopChatReady).openReview(host,record)});
export async function mountFoundation(key,root){const at=sessionEpoch;if(!['identity','workforce'].includes(key))throw Error('UNKNOWN_MODULE');const descriptor=key==='workforce'?(switches.pending()[key]||switches.current(key)):switches.current(key),module=await loadFoundation(descriptor);if(at!==sessionEpoch)throw Error('STALE_SESSION');switches.adopt(key,{safe:true});return module.mount(root,api);}
export const publicBranding=()=>client.branding();

export function installDailyEntrypoints(){
 const dock=document.querySelector('#chatComposerDock'),drawer=document.querySelector('#chatDrawer');
 if(dock&&!document.getElementById('liChatExcel')){
  const openImport=f=>{if(!api.person())return alert('請先登入');openReportImport(api,f).catch(e=>alert(errorText(e)));};
  const b=button('Excel',()=>openImport(null),'text-neutral-400 hover:text-white p-2 text-sm rounded-xl');b.id='liChatExcel';b.title='匯入月報或結算表';dock.querySelector('#micBtn')?.before(b);
  drawer?.addEventListener('drop',e=>{const files=[...(e.dataTransfer?.files||[])];if(!files.some(f=>/\.xlsx$/i.test(f.name)))return;e.preventDefault();e.stopImmediatePropagation();
    if(files.length!==1)return alert('每次請拖入一份 Excel 報表。');openImport(files[0]);},true);
 }
 const rail=document.querySelector('.leaves-chat-rail');if(!rail)return;
 document.getElementById('identityDailyButton')?.remove();
 let actions=document.getElementById('identityWorkButtons');
 if(!actions){
  actions=el('section',{id:'identityWorkButtons','aria-label':'工作進度'});
  for(const [id,label,icon,run]of [
   ['identityDailyEntry','填寫今日進度','✎',()=>openDailyWindow(api)],
   ['identityReportsEntry','進度與工時','▦',()=>open('workforce')]
  ]){const b=button('',()=>run().catch(e=>alert(errorText(e))),'leaves-chat-rail-icon');b.id=id;b.title=label;b.append(el('span',{},icon),el('span',{class:'rail-label'},label));actions.append(b);}
  const assistant=rail.querySelector('[data-leaves-module="assistant"]');
  if(assistant)assistant.after(actions);else rail.insertBefore(actions,rail.querySelector('#identityTeamButton'));
 }
 if(!document.getElementById('identityTeamButton')){const b=button('',()=>openTeamDay(api).catch(e=>alert(errorText(e))),'leaves-chat-rail-icon');b.id='identityTeamButton';b.title='團隊今日進度';b.append(el('span',{},'▦'),el('span',{class:'rail-label'},'團隊今日進度'));rail.append(b);}
 syncDailyEntrypoints();
}
export function syncDailyEntrypoints(){const p=api.person();for(const id of ['identityDailyEntry','identityReportsEntry']){const b=document.getElementById(id);if(b)b.hidden=!p||!api.can('progress.view');}const team=document.getElementById('identityTeamButton');if(team)team.hidden=!p||!['owner','boss','supervisor'].includes(p.role)||!api.can('progress.view');}

function delayQueue(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Object.assign(Error('AI_CANCELLED'),{code:'AI_CANCELLED'}));return;}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
  function cancel(){clearTimeout(timer);reject(Object.assign(Error('AI_CANCELLED'),{code:'AI_CANCELLED'}));}
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
export async function driveChatQueue({send,status,cancel,signal,notify,remember,pause=delayQueue,inspectFirst=false}){
 let state=null,saved=inspectFirst;
 try{
  signal?.throwIfAborted();
  if(inspectFirst)state=await status();
  for(;;){
   signal?.throwIfAborted();
   if(state?.state==='waiting'){
    notify(state);
    if(!saved){await remember();saved=true;}
    const seconds=Math.max(1,Math.min(172800,Number(state.seconds)||5));
    await pause(seconds*1000+Math.floor(Math.random()*450),signal);
    try{state=await status();}catch(e){if(e.code!=='SERVICE_UNAVAILABLE')throw e;state={state:'waiting',reason:'CONNECTION',seconds:12};}
    continue;
   }
   notify(null);
   const result=await send();
   if(!result.queue)return result;
   state=result.queue;
   if(state.state!=='waiting')throw Error('BAD_QUEUE_STATE');
  }
 }finally{
  if(signal?.aborted)void cancel().catch(()=>{});
 }
}
