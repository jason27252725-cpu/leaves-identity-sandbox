export const X1_ENGINE_VERSION='1.0.0';
const PAGE_SIZE=8;
const CONTEXT_TTL_MS=10*60*1000;
const LOCAL_REF=/^i[1-9]\d{0,5}$/;
const CELL=/^[A-Z]{1,3}[1-9]\d{0,5}$/;
const QUOTE=/報價(?:單|表|工作簿|草稿)?|估價單|quotation/i;
const SOP=/\bSOP\b|公司(?:的)?(?:報價)?(?:規範|規則|標準|計價流程)/i;
const NATIVE_REPAIR=/^(?:請|拜託|麻煩)?\s*(?:(?:幫(?:我|忙)|替我|把|將|先|就|直接)\s*)*(?:修正|修改|修復|修好|修|更正|校正|調整)\s*(?:剛才|剛剛|上面)?\s*第\s*[0-9一二兩三四五六七八九十]+\s*項\s*(?:吧|即可|就好|先(?:給我看|預覽)|先不要(?:套用|改動)|請先(?:給我看|預覽))?[。！!？?\s]*$/;
const NUMBERED=/第\s*([0-9一二兩三四五六七八九十]+)\s*項/g;
const SENSITIVE=/(?:sk-|eyJ)[A-Za-z0-9_.-]{16,}|\b(?:Bearer|service_role)\s*[=:]?\s*[A-Za-z0-9_.-]{12,}|(?:通行碼|密碼|金鑰|權杖|令牌|密鑰|api[ _-]*key|access[ _-]*token|secret)\s*[:：=]\s*[^\s，；。]{3,}/gi;
const PRIVATE_DATA=/通行碼|密碼|密鑰|金鑰|門禁|wi-?fi|password|\btoken\b|api.?key|service.role|銀行帳號|薪資|請假原因|\[已遮蔽\]/iu;
const SAFE_ERROR=/^[A-Z][A-Z0-9_]{1,55}$/;
const READ_PERMISSIONS=['ai.use','sop.view','quotation.use','assistant.use'];

function failure(code){return Object.assign(new Error(code),{code});}
function safeCode(error){const code=error?.code||error?.message||'';return SAFE_ERROR.test(code)?code:'X1_FAILED';}
function clean(value,max){return typeof value==='string'?value.replace(SENSITIVE,'[已遮蔽]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max):'';}
function scalar(value){return typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'?clean(value,160):null;}
function int(value,fallback=0){return Number.isSafeInteger(value)&&value>=0?value:fallback;}

function ordinal(value){
 if(/^\d+$/.test(value))return int(Number(value));
 const digit=x=>({'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}[x]||0);
 if(!value.includes('十'))return value.length===1?digit(value):0;
 const [t,u,...rest]=value.split('十');
 return rest.length||t.length>1||u.length>1?0:(t?digit(t):1)*10+digit(u);
}

function intent(text,bound){
 if(/^(?:取消|中止|停止)(?:這次(?:檢查|分析|預覽)|檢查|分析|預覽|x1)?[。！!\s]*$/i.test(text))return bound?{kind:'cancel'}:null;
 if(/^(?:好[，、,\s]*)?(?:確定|確認|同意|套用|送出)(?:修改|修正|套用|變更|差異|這次預覽)?[。！!\s]*$/.test(text))return bound?{kind:'approve'}:null;
 if(/^(?:重試|重新分析|重新檢查)(?:這(?:一)?(?:頁|份報價))?[。！!\s]*$/.test(text))return bound?{kind:'retry'}:null;
 if(/^(?:請|麻煩)?\s*(?:繼續|再)?\s*(?:看)?\s*下一頁[。！!\s]*$/.test(text))return bound?{kind:'next'}:null;
 if(QUOTE.test(text)&&SOP.test(text)&&/檢查|核對|稽核|比對|健檢|看一下|列.{0,8}(?:差異|問題)|符不符合|有沒有符合/.test(text)&&!/(?:修改|修訂|更新|新增|更改|刪除|發布|送審)\s*(?:公司(?:的)?)?\s*SOP\b/i.test(text))return {kind:'audit'};
 const matches=[...text.matchAll(NUMBERED)];
 if(!matches.length||(!bound&&(SOP.test(text)||/工時|3D|模型|圖紙/.test(text))))return null;
 const number=ordinal(matches[0][1]);
 if(matches.length===1&&number>0){
  if(NATIVE_REPAIR.test(text)||/^第\s*[0-9一二兩三四五六七八九十]+\s*項\s*(?:請)?\s*(?:幫我|麻煩)\s*(?:修正|修復|修好|修)[。！!\s]*$/.test(text))return {kind:'preview',number};
  if(/怎麼|如何|為何|為什麼|問題是什麼|說明|解釋/.test(text)&&!/全部|其他也|其他全|直接套用|直接修改/.test(text))return {kind:'explain',number};
 }
 return {kind:'scope'};
}

function quotePage(raw,requestedOffset){
 if(!raw?.binding||!Array.isArray(raw.items))throw failure('X1_NO_QUOTE');
 const coverage=raw.coverage||{},offset=int(coverage.offset,requestedOffset);
 if(offset!==requestedOffset)throw failure('X1_QUOTE_SCOPE');
 const items=[],seen=new Set();
 for(const item of raw.items.slice(0,PAGE_SIZE)){
  if(!LOCAL_REF.test(item?.ref||'')||!CELL.test(item?.address||'')||seen.has(item.ref))throw failure('X1_QUOTE_SCOPE');
  const code=clean(item.code,64),sheet=clean(item.sheet,80),message=clean(item.message,320);
  if(!code||!sheet||!message)throw failure('X1_QUOTE_SCOPE');
  seen.add(item.ref);
  items.push({ref:item.ref,sheet,address:item.address,code,message,current:scalar(item.current),expected:scalar(item.expected),reason:clean(item.reason,320),repairable:item.repairable===true,index:offset+items.length+1});
 }
 const nextOffset=coverage.nextOffset;
 return {binding:raw.binding,items,coverage:{offset,total:Math.max(offset+items.length,int(coverage.total)),nextOffset:Number.isSafeInteger(nextOffset)&&nextOffset>offset?nextOffset:null,scope:clean(coverage.scope,80)||'可見客戶報價工作表'}};
}

function modelReview(value,items){
 if(!value||!Array.isArray(value.items)||!Number.isSafeInteger(value.sopRevision)||value.sopRevision<1)throw failure('X1_MODEL_RESULT');
 const allowed=new Set(items.map(x=>x.ref)),matches=new Map();
 if(value.items.length>items.length)throw failure('X1_MODEL_RESULT');
 for(const picked of value.items){
  if(!allowed.has(picked?.ref)||matches.has(picked.ref)||typeof picked.advice!=='string'||!Array.isArray(picked.sources)||picked.sources.length>4)throw failure('X1_MODEL_RESULT');
  const sources=picked.sources.map(source=>{
   const text=clean(source?.text,400);
   if(!Number.isSafeInteger(source?.line)||source.line<=0||!text)throw failure('X1_MODEL_RESULT');
   return {line:source.line,text};
  });
  matches.set(picked.ref,{advice:clean(picked.advice,700),sources});
 }
 return {summary:clean(value.summary,650),sopRevision:value.sopRevision,model:clean(value.model,120),items:items.map(item=>({...item,...(matches.get(item.ref)||{advice:'',sources:[]})}))};
}

function normalizePolicy(value){
 const revision=typeof value?.revision==='string'||Number.isSafeInteger(value?.revision)?String(value.revision):null;
 if(value?.enabled===true&&(revision===null||revision.length>120))throw failure('X1_POLICY_INVALID');
 return {enabled:value?.enabled===true,modelReview:value?.modelReview===true,diagnosticsEnabled:value?.diagnosticsEnabled===true,revision};
}

const messages={
 X1_NO_QUOTE:'請先開啟一份可操作的客戶報價工作簿，再指定依公司 SOP 檢查。',
 X1_QUOTE_CHANGED:'目前的報價工作簿或內容已變更。請用目前的工作簿重新檢查。',
 X1_STALE:'前一次檢查已失效，請指定目前的報價工作簿重新檢查。',
 X1_FORBIDDEN:'目前身分沒有執行這項公司的報價 SOP 檢查所需的權限。',
 X1_EDIT_FORBIDDEN:'目前身分只能檢查報價，無法產生修改預覽。',
 X1_ACCESS_UNAVAILABLE:'目前無法從後端核對操作權限，請稍後重新確認。',
 X1_POLICY_CHANGED:'x1 設定已變更，請重新檢查目前的報價。',
 X1_SOP_CHANGED:'檢查使用的 SOP 版本已變更，請重新核對目前的報價。',
 X1_DISABLED:'目前環境尚未啟用 LEAVES AI x1。',
 X1_POLICY_INVALID:'目前無法確認 x1 的版本設定。請稍後重試。',
 X1_QUOTE_SCOPE:'報價檢查範圍無法核對。請重新開啟工作簿後再試一次。',
 X1_PREVIEW_UNAVAILABLE:'目前的報價模組無法提供修改預覽。請在原工作台確認此項。',
 X1_CANCELLED:'已停止 x1 任務。',
 X1_MODEL_RESULT:'這次未能取得可核對的 SOP 分析。',
 FORBIDDEN:'目前身分無法繼續這項操作。',
 AUTH_REVOKED:'登入權限已變更，請重新登入。',
 STALE_SESSION:'登入工作階段已變更，請重新登入。',
 X1_FAILED:'x1 未能完成這次操作。',
};

export function createX1Controller({person,epoch,can,loadPolicy,request,sopRevision,refreshAccess,diagnose=()=>{},now=Date.now}){
 let port=null,mode='default',policy=normalizePolicy(null),audit=null,retrying=null,task=null,preview=null;
 const identity=()=>{
  const p=person();
  return p?.employeeId!=null&&p.environment?JSON.stringify([epoch(),p.environment,p.employeeId,p.revision??null]):null;
 };
 const permitted=(edit=false)=>READ_PERMISSIONS.every(can)&&(!edit||can('quotation.edit'));
 const canUseMode=()=>can('ai.use')&&(can('progress.view')||permitted());
 const getState=()=>({mode,enabled:policy.enabled&&!!identity()&&canUseMode(),modelReview:policy.modelReview,diagnosticsEnabled:policy.diagnosticsEnabled,busy:!!task});
 const publish=()=>port?.onState?.(getState());
 const note=(stage,job,code,counts)=>{
  if(!job?.id)return;
  try{diagnose({stage,code,id:job.id,revision:job.policyRevision??policy.revision,counts});}catch{}
 };
 const notify=(text,job,extra={})=>port?.showStatus?.(text,{id:job?.id,query:job?.displayQuery,...extra});
 const clarify=(code,job,extra={})=>port?.showClarification?.(messages[code]||messages.X1_FAILED,{id:job?.id,query:job?.displayQuery,code,...extra});
 const present=result=>{
  const {subject,...display}=result;
  port?.showAudit?.(display);
 };

 function invalidateReference(){
  audit=null;retrying=null;
  preview?.abort();preview=null;
 }
 function cancel(){
  const wasActive=!!task||!!preview||!!audit||!!retrying;
  const current=task;
  task=null;invalidateReference();
  if(current){current.controller.abort(failure('X1_CANCELLED'));note('cancelled',current,'X1_CANCELLED');}
  publish();
  return wasActive;
 }
 function clear(){cancel();mode='default';policy=normalizePolicy(null);publish();}
 function attach(value){
  cancel();port=value;publish();
  return ()=>{if(port===value){clear();port=null;}};
 }
 function setMode(next){
  if(!['default','x1'].includes(next)||next==='x1'&&!getState().enabled)return false;
  if(mode!==next){cancel();mode=next;publish();}
  return true;
 }

 function checkIdentity(subject,edit=false){
  checkSubject(subject);
  if(!permitted())throw failure('X1_FORBIDDEN');
  if(edit&&!can('quotation.edit'))throw failure('X1_EDIT_FORBIDDEN');
 }
 function checkSubject(subject){if(!subject||identity()!==subject)throw failure('X1_STALE');}
 async function refreshIdentity(subject,edit=false){
  if(typeof refreshAccess!=='function'||await refreshAccess()===false)throw failure('X1_ACCESS_UNAVAILABLE');
  checkIdentity(subject,edit);
 }
 async function readPolicy(subject){
  checkSubject(subject);
  if(!canUseMode())throw failure('X1_FORBIDDEN');
  let updated;
  try{updated=normalizePolicy(await loadPolicy());}catch(error){throw failure(safeCode(error)==='X1_FAILED'?'X1_POLICY_INVALID':safeCode(error));}
  checkSubject(subject);
  if(!canUseMode())throw failure('X1_FORBIDDEN');
  policy=updated;publish();
  if(!policy.enabled)throw failure('X1_DISABLED');
  return updated;
 }
 async function refreshPolicy(){
  const subject=identity(),previous=policy;
  try{
   const updated=await readPolicy(subject);
   if(previous.revision!==updated.revision||previous.modelReview!==updated.modelReview)cancel();
  }catch{
   if(identity()===subject){policy=normalizePolicy(null);mode='default';cancel();}
  }
  return getState();
 }

 function checkTask(job){
  if(task!==job||job.controller.signal.aborted||mode!=='x1')throw failure('X1_CANCELLED');
  checkIdentity(job.subject);
 }
 function checkQuote(binding){if(!port?.isCurrentQuote?.(binding))throw failure('X1_QUOTE_CHANGED');}
 async function checkSop(revision){if(revision!=null&&sopRevision&&(await sopRevision())!==revision)throw failure('X1_SOP_CHANGED');}
 function checkAudit(result,edit){
  if(!result||audit!==result||now()-result.at>=CONTEXT_TTL_MS||mode!=='x1')throw failure('X1_STALE');
  checkIdentity(result.subject,edit);
  checkQuote(result.binding);
 }
 async function checkAuditPolicy(result,edit){
  checkAudit(result,edit);
  await refreshIdentity(result.subject,edit);
  checkAudit(result,edit);
  const updated=await readPolicy(result.subject);
  checkAudit(result,edit);
  if(updated.revision!==result.policyRevision||updated.modelReview!==result.modelPolicy)throw failure('X1_POLICY_CHANGED');
  await checkSop(result.sopRevision);
  checkAudit(result,edit);
 }

 async function inspect(displayQuery,{result=null,offset=0}={}){
  const query=result?.query||displayQuery,subject=identity(),controller=new AbortController();
  const job={id:result?.id||globalThis.crypto.randomUUID(),displayQuery,controller,subject};
  task=job;publish();
  let page,updated;
  const anterior=result?.binding;
  try{
   checkTask(job);
   if(anterior)checkQuote(anterior);
   updated=await readPolicy(subject);checkTask(job);
   job.policyRevision=updated.revision;
   if(result&&(result.policyRevision!==updated.revision||result.modelPolicy!==updated.modelReview||now()-result.at>=CONTEXT_TTL_MS))throw failure('X1_STALE');
   await refreshIdentity(subject);checkTask(job);
   if(anterior)checkQuote(anterior);
   note('inspect',job,undefined,{offset});
   notify('正在檢查目前的報價工作簿',job,{stage:'inspection'});
   page=quotePage(await port.readQuote({query,offset}),offset);
   checkTask(job);checkQuote(page.binding);
   if(anterior)checkQuote(anterior);
   let response={items:page.items.map(item=>({...item,advice:'',sources:[]})),summary:''};
   const outbound=page.items.map(({ref,sheet,address,code,message,current,expected})=>({ref,sheet,address,code,message,current,expected}));
   const sensitive=outbound.some(item=>Object.values(item).some(value=>typeof value==='string'&&PRIVATE_DATA.test(value)));
   const reviewed=updated.modelReview&&page.items.length>0&&!sensitive;
   if(reviewed){
    notify('正在核對本頁項目與已發布的公司 SOP',job,{stage:'review'});
    const raw=await request({query:clean(query,500),items:outbound},controller.signal,text=>{
     if(task===job&&identity()===subject&&!controller.signal.aborted&&typeof text==='string')notify(clean(text,150),job,{stage:'waiting'});
    },job.id);
    checkTask(job);checkQuote(page.binding);response=modelReview(raw,page.items);
   }else if(sensitive)response.summary='這一頁含可能敏感的欄位。本機檢查已完成，未送出 SOP 模型分析。';
   else if(!updated.modelReview)response.summary='目前未啟用 SOP 模型分析，以下為本機報價檢查結果。';
   const finalPolicy=await readPolicy(subject);checkTask(job);checkQuote(page.binding);
   if(finalPolicy.revision!==updated.revision||finalPolicy.modelReview!==updated.modelReview)throw failure('X1_POLICY_CHANGED');
   await checkSop(response.sopRevision);checkTask(job);checkQuote(page.binding);
   invalidateReference();
   audit={...response,id:job.id,displayQuery,query,subject,at:now(),policyRevision:updated.revision,modelPolicy:updated.modelReview,binding:page.binding,coverage:page.coverage,reviewed};
   note('audit',audit,undefined,{offset,items:audit.items.length,sourceCount:audit.items.flatMap(x=>x.sources).length,sopRevision:audit.sopRevision,sourceLines:audit.items.flatMap(x=>x.sources.map(s=>s.line))});
   present({...audit,kind:'audit'});
  }catch(error){
   if(task!==job||controller.signal.aborted||identity()!==subject)return;
   const code=safeCode(error);
   note('error',job,code);
   if(page&&updated&&port.isCurrentQuote?.(page.binding)&&!['X1_DISABLED','X1_STALE','X1_FORBIDDEN','X1_POLICY_INVALID','X1_POLICY_CHANGED','X1_CANCELLED','X1_QUOTE_CHANGED','X1_QUOTE_SCOPE','FORBIDDEN','AUTH_REQUIRED','AUTH_REVOKED','STALE_SESSION'].includes(code)){
    retrying={...job,at:now(),query,binding:page.binding,policyRevision:updated.revision,modelPolicy:updated.modelReview,coverage:page.coverage};
   }
   clarify(code,job,{retry:retrying?()=>handle('重試'):undefined});
  }finally{if(task===job){task=null;publish();}}
 }

 async function follow(text,route){
  const result=audit,subject=identity(),job={id:result?.id||globalThis.crypto.randomUUID(),displayQuery:text,policyRevision:result?.policyRevision};
  if(['next','retry'].includes(route.kind)){
   const bound=route.kind==='retry'?retrying||result:result;
   if(!bound){clarify('X1_STALE',job);return;}
   const offset=route.kind==='next'?bound.coverage.nextOffset:bound.coverage.offset;
   if(offset===null){notify('這次檢查已沒有下一頁。',job);return;}
   await inspect(text,{result:bound,offset});return;
  }
  if(route.kind==='scope'){
   port?.showClarification?.('請指明比較表的一個項目。例如「第 2 項怎麼改」或「幫我修第 2 項」。',job);return;
  }
  if(route.kind==='approve'){
   port?.showClarification?.(preview?'請核對預覽，再按該張差異表中的「確認修改」。':'目前沒有可確認的 x1 修改預覽。請指定項目並先查看差異。',job);return;
  }
  const edit=route.kind==='preview';
  try{
   checkAudit(result,edit);
   if(!edit)await checkAuditPolicy(result,false);
   const selected=result.items.find(item=>item.index===route.number);
   if(!selected){port?.showClarification?.('目前這一頁沒有這個項目。請依畫面上的項目編號重試。',job);return;}
   if(!edit){
    present({...result,...job,kind:'explain',items:[selected],summary:selected.advice||selected.reason||selected.message});
    note('explain',result,undefined,{selectedIndex:selected.index});return;
   }
   if(!selected.repairable){port?.showClarification?.('此項需要人工判斷或補齊資料，目前沒有可直接預覽的規則修正。',job);return;}
   if(typeof port.runPreview!=='function')throw failure('X1_PREVIEW_UNAVAILABLE');
   preview?.abort();
   const approval=new AbortController();preview=approval;
   const verify=async()=>{
    if(preview!==approval||approval.signal.aborted)throw failure('X1_STALE');
    await checkAuditPolicy(result,true);
    if(preview!==approval||approval.signal.aborted)throw failure('X1_STALE');
    return true;
   };
   const reportOutcome=(stage,{code,changes}={})=>{
    if(!['commit','undo'].includes(stage)||identity()!==subject)return;
    const diagnosticCode=typeof code==='string'&&SAFE_ERROR.test(code)?code:undefined;
    note(stage,result,diagnosticCode,{changes:int(changes)});
   };
   const verifyUndo=async()=>{
    checkIdentity(subject,true);
    await refreshIdentity(subject,true);
    await readPolicy(subject);
    checkIdentity(subject,true);
    return true;
   };
   await verify();
   await port.runPreview({audit:result,selected,query:text,verify,verifyUndo,signal:approval.signal,reportOutcome});
   if(preview===approval&&!approval.signal.aborted)note('preview',result,undefined,{selectedIndex:selected.index});
  }catch(error){
   if(identity()!==subject||mode!=='x1')return;
   const code=safeCode(error);
   if(['X1_STALE','X1_QUOTE_CHANGED','X1_POLICY_CHANGED','X1_SOP_CHANGED','X1_DISABLED'].includes(code))invalidateReference();
   note('error',job,code);clarify(code,job);
  }
 }

 async function handle(raw,{images=[],hasImages=false}={}){
  const text=typeof raw==='string'?raw.normalize('NFKC').trim():'';
  if(!port||!text||mode!=='x1')return null;
  if(text.startsWith('/')){invalidateReference();return null;}
  const route=intent(text,!!audit||!!retrying||!!task);
  if(!route){invalidateReference();return null;}
  if(task&&route.kind!=='cancel'){
   port?.showClarification?.('上一個 x1 任務仍在處理中。');return {handled:true,keepInput:true};
  }
  if(route.kind!=='cancel'&&(hasImages||images.length)){port?.showClarification?.('報價 SOP 檢查使用目前的工作簿。請移除附件後再送出。');return {handled:true,keepInput:true};}
  if(route.kind==='cancel'){cancel();notify(messages.X1_CANCELLED);}
  else if(route.kind==='audit'){
   invalidateReference();
   if(text.length>500||clean(text,500)!==text||PRIVATE_DATA.test(text)){port?.showClarification?.('請用不含憑證及私人資訊，且不超過 500 字的描述指定這次檢查。');return {handled:true,keepInput:true};}
   await inspect(text);
  }else await follow(text,route);
  return {handled:true,keepInput:false};
 }

 return Object.freeze({attach,handle,refreshPolicy,clear,cancel,invalidateReference,setMode,getMode:()=>mode,getState});
}
