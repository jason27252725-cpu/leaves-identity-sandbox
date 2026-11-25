import {el,button,errorText} from '../shared/dom.mjs';
import {revisionIntent} from './intent.mjs';

const opLabel={replace:'修改',after:'在此段後新增',delete:'刪除'};
const states={pending:'待審核',approved:'已發布',withdrawn:'已撤回',rejected:'已退回'};
const messages={
 SOP_PROTOCOL:'此環境尚未啟用新版 SOP 修訂服務。',SOP_TARGET_CHANGED:'原文位置或內容已有差異，請依最新版重新分析。',
 SOP_REBASE_REQUIRED:'提案依據的 SOP 已更新，請重新比較。',SOP_PROTECTED_SECTION:'此段含受保護的資料，無法在聊天中修訂。',
 SOP_ROSTER_FORMAT:'請保留一行一個職稱及姓名的原本格式。',SOP_HEADING_FORMAT:'請保留原有章節標題，再調整段內條文。',
 SOP_REVIEW_REQUIRED:'請先填寫每項衝突的處理方式。',BAD_SOP_REQUEST:'請以一般條文描述修改內容，移除憑證或私人資料。',
 BAD_SOP_PATCH:'差異無法套用至原文，請重新核對選取的內容。',SOP_SOURCE_MISSING:'此環境尚無可供修訂的已發布 SOP。',
 READBACK_PENDING:'送出結果仍待核對，請點「重新核對」讀取同一筆紀錄。',SOP_BUSY:'這張修訂卡仍在處理上一個動作。'};
const describe=e=>messages[e.code||e.message]||errorText(e);
const fail=code=>{throw Object.assign(Error(code),{code});};
const field=(name,input)=>el('label',{},el('span',{},name),input);
const details=(title,...nodes)=>el('details',{},el('summary',{},title),...nodes);
const area=(value,label,update,maxLength=12000)=>el('textarea',{value,rows:3,maxLength,'aria-label':label,oninput:e=>update(e.target.value)});
const literal=text=>el('pre',{},text);
const diff=(before,after,isAfter=false)=>el('div',{class:'sop-diff',role:'group','aria-label':'修訂前後比較'},el('div',{},el('small',{},isAfter?'插入位置的原文':'目前原文'),literal(before)),el('div',{},el('small',{},isAfter?'新增於此行之後':'修訂後'),after));
export function showChanges(target,changes,related=[],editable=false){
 for(const c of changes){
  const title=c.section+' · 第 '+c.start+(c.end===c.start?'':'–'+c.end)+' 行 · '+opLabel[c.op];
  const after=c.op==='delete'?literal('刪除此段'):editable?area(c.after,title+' 新文',v=>{c.after=v;}):literal(c.after);
  target.append(el('p',{},el('strong',{},title)),diff(c.before,after,c.op==='after'),el('small',{},c.why));
 }
 for(const r of related){
  const block=el('div',{},el('p',{},el('strong',{},(r.kind==='conflict'?'待決定':'相關條文')+' · '+r.section+' · 第 '+r.line+' 行')),literal(r.excerpt),el('p',{},r.why));
  if(r.kind==='conflict')block.append(editable?field('這個差異要怎麼處理？',area(r.decision||'','衝突處理方式',v=>{r.decision=v;},500)):el('p',{},'處理方式　'+(r.decision||'尚未填寫')));
  target.append(block);
 }
}
export function createRevisionChat({api,analyze,classify,container=()=>document.getElementById('chatContainer'),published=()=>{},openPeople=()=>{},noticeUser=()=>{}}){
 let active=null,source=null,pendingSource=null,capabilityBinding=null;
 const cards=new Set();
 const identity=()=>{const p=api.person();return p?JSON.stringify([api.epoch(),p.employeeId,p.environment,p.revision,p.permissions]):'';};
 const alive=c=>!!c&&c.binding===identity()&&c.box.isConnected;
 function check(c){if(!alive(c))fail('STALE_SESSION');}
 function clear(){capabilityBinding=null;for(const c of cards){c.stop?.abort();c.box.remove();}cards.clear();active=null;source=null;pendingSource=null;document.querySelectorAll('button.sop-source').forEach(b=>b.remove());}
 function newCard(title){
  const parent=container();if(!parent)return null;
  for(const old of cards)if(!alive(old)){old.stop?.abort();cards.delete(old);}
  const box=el('section',{class:'sop-revision selectable-text','aria-label':title}),heading=el('h3',{},title),body=el('div'),status=el('p',{class:'sop-message',role:'status','aria-live':'polite'});
  const actions=el('div',{class:'sop-actions'});box.append(heading,body,status,actions);parent.append(box);
  const c={box,heading,body,status,actions,binding:identity(),busy:false};
  cards.add(c);parent.scrollTop=parent.scrollHeight;return c;
 }
 function view(c,title){check(c);c.heading.textContent=title;c.body.replaceChildren();c.status.textContent='';c.actions.replaceChildren();}
 function action(c,label,fn,primary=false){
  const b=button(label,()=>run(c,fn),primary?'primary':'');c.actions.append(b);return b;
 }
 async function run(c,fn){
  if(!alive(c)||c.busy)return;
  c.busy=true;c.box.setAttribute('aria-busy','true');
  try{await fn(c);}catch(e){if(alive(c)){c.status.textContent=describe(e);if(['REVISION_CONFLICT','SOP_TARGET_CHANGED','SOP_DATA_CHANGED','SOP_REBASE_REQUIRED','PLAN_STALE'].includes(e.code||e.message))stale(c);}}
  finally{c.busy=false;c.box.removeAttribute('aria-busy');}
 }
 function stale(c){
  if(c.staleButton?.isConnected)return;
  c.plan=null;
  c.staleButton=action(c,'比較最新原文',async()=>{
   const r=await api.workspace('sop.read');check(c);
   const sourceLines=(r.sop?.content||'').split(/\r?\n/);
   const d=c.draft||c.proposal?.change_set||{};
   const box=el('div',{},el('p',{},'目前為 r'+r.sop.revision+'。以下是原先位置現在的文字，請重新選定章節。'));
   for(const item of d.changes||[])box.append(el('p',{},item.section+' · 舊位置 '+item.start),diff(item.before,literal(sourceLines.slice(item.start-1,item.end).join('\n'))),details('原提議新文',literal(item.after)));
   c.body.append(box);c.actions.replaceChildren();action(c,'依新版重新分析',async()=>{
    const fresh=newCard('依最新版重新分析');fresh.origin=c.origin||c.proposal?.reason||d.topic;fresh.reference=null;active=fresh;
    await run(fresh,()=>generate(fresh,fresh.origin+'\n請在最新原文重新定位這些舊版提議：'+(d.changes||[]).map(v=>v.section+'：'+(v.op==='delete'?'刪除「'+v.before+'」':v.after)).join('\n').slice(0,2000)));
   },true);
  });
 }
 function cancelCard(c){
  c.stop?.abort();if(active===c)active=null;
  view(c,'已結束本次草稿');c.draft=null;c.pending=null;
 }
 async function capabilities(c){
  const at=identity();if(capabilityBinding===at&&at)return;
  const meta=await api.workspace('sop.history');
  if(at!==identity())fail('STALE_SESSION');if(c)check(c);
  if(meta.revisionProtocol!==1)fail('SOP_PROTOCOL');capabilityBinding=at;
 }
 async function generate(c,question){
  check(c);
  if(!api.can('sop.propose')||!api.can('sop.view')||!api.can('ai.use'))fail('FORBIDDEN');
  c.lastQuestion=question;const previous=c.draft;
  view(c,'正在比對 SOP 原文');c.status.textContent='正在讀取已發布版本，查找修改位置與相關章節。';
  c.stop=new AbortController();const stop=c.stop;
  const stopButton=button('停止分析',()=>stop.abort());c.actions.append(stopButton);
  try{
   await capabilities(c);
   const request={protocol:1,origin:c.origin,...(c.reference?{reference:c.reference}:{}),...(previous?{previous:{revision:previous.revision,topic:previous.topic,changes:previous.changes.map(({start,end,after,op})=>({start,end,after,op}))}}:{})};
   const result=await analyze(question,request,stop.signal);check(c);
   if(stop.signal.aborted)fail('AI_CANCELLED');
   const draft=result?.sopDraft;
   if(!draft||!Number.isInteger(draft.revision)||!Array.isArray(draft.changes)||!Array.isArray(draft.related))fail('SOP_PROTOCOL');
   c.draft=draft;c.followup=!draft.changes.length;c.pending=null;c.reference={revision:draft.revision,lines:draft.changes.slice(0,12).map(x=>x.start)};active=c;
   renderDraft(c);
  }catch(e){check(c);if(previous){c.draft=previous;renderDraft(c);}else{view(c,'SOP 修訂尚未完成');action(c,'取消草稿',()=>cancelCard(c));}
   action(c,'重新分析',()=>generate(c,question));throw e;
  }finally{if(c.stop===stop)c.stop=null;}
 }
 function renderDraft(c){
  const d=c.draft;view(c,d.topic);c.body.append(el('p',{},d.summary),el('p',{class:'sop-context'},'草稿 · 依據已發布 SOP r'+d.revision+' · 本次比對 '+d.shown+' / '+d.sections+' 個可讀章節'));
  showChanges(c.body,d.changes,d.related,true);
  if(!d.changes.length&&d.choices?.length){
   c.body.append(el('p',{},'可選擇一個原文位置繼續'));
   for(const opt of d.choices){const b=button(opt.section+' · 第 '+opt.line+' 行',()=>run(c,()=>{c.reference={revision:d.revision,lines:[opt.line]};return generate(c,'請以我選擇的〈'+opt.section+'〉第 '+opt.line+' 行為主要位置，繼續原提議。');}));b.title=opt.text;c.body.append(b);}
  }
  if(d.changes.length)action(c,'確認差異，送出提案',()=>submit(c),true);
  action(c,'繼續用聊天調整',()=>{active=c;c.followup=true;document.getElementById('userInput')?.focus();c.status.textContent='請在原本的聊天輸入框說明要調整的部分。';});
  action(c,'取消草稿',()=>cancelCard(c));
 }
 async function submit(c){
  const d=c.draft;
  if(d.related.some(r=>r.kind==='conflict'&&!r.decision?.trim()))fail('SOP_REVIEW_REQUIRED');
  if(d.changes.some(x=>x.op!=='delete'&&(!x.after.trim()||x.op==='replace'&&x.after===x.before)))fail('NO_DIFFERENCE');
  if(!api.can('sop.propose'))fail('FORBIDDEN');
  const request=c.pending||{id:crypto.randomUUID(),baseRevision:d.revision,changeAction:'patch',topic:d.topic,
    oldText:d.changes.map(x=>x.before).join('\n')||'（空白錨點）',newText:d.changes.map(x=>x.after).join('\n').trim()||'（刪除所選段落）',
    reason:d.summary.slice(0,1000),changeSet:structuredClone({changes:d.changes,related:d.related})};
  c.pending=request;if(active===c)active=null;
  view(c,'正在核對提案');c.status.textContent='核對提案編號與版本…';
  async function verify(){
   const record=await api.workspace('sop.proposal',{proposalId:request.id});check(c);
   if(record.proposal?.id!==request.id||record.proposal.base_revision!==request.baseRevision||!record.proposal.change_set)fail('READBACK_PENDING');
   c.pending=null;return review(c,record);
  }
  let writeError;
  try{const receipt=await api.workspace('sop.propose',request,true);check(c);if(receipt?.proposalId!==request.id)fail('READBACK_PENDING');}catch(e){writeError=e;}
  check(c);
  try{await verify();}
  catch(e){
   check(c);
   if(writeError&&!['SERVICE_UNAVAILABLE','WRITE_UNCONFIRMED','UNCONFIRMED_WRITE','MUTATION_UNCONFIRMED','READBACK_PENDING','NETWORK_ERROR'].includes(writeError.code||writeError.message)&&!writeError.uncertain&&['REVISION_CONFLICT','SOP_REBASE_REQUIRED','FORBIDDEN','BAD_SOP_PATCH','SOP_TARGET_CHANGED','SOP_ROSTER_FORMAT','SOP_PROTECTED_SECTION','SOP_HEADING_FORMAT','SOP_REVIEW_REQUIRED','NO_DIFFERENCE','BAD_PROPOSAL'].includes(writeError.code||writeError.message)){
    c.pending=null;active=c;renderDraft(c);throw writeError;
   }
   action(c,'重新核對',verify,true);action(c,'用同一編號重送',()=>submit(c));fail('READBACK_PENDING');
  }
 }
 function review(c,record){
  const p=record.proposal;c.proposal=p;c.pid=p.id;c.plan=null;c.draft=null;
  view(c,p.topic+' · '+(states[record.status]||record.status));
  c.body.append(el('p',{class:'sop-context'},'提案 '+p.id+' · 原文 r'+p.base_revision+(record.publishedRevision?' · 發布 r'+record.publishedRevision:'')),el('p',{},p.reason));
  if(p.change_set)showChanges(c.body,p.change_set.changes,p.change_set.related);
  else c.body.append(diff(p.old_text,literal(p.new_text)));
  if(record.status!=='pending')return;
  const reason=area('','審核說明',()=>{},1000);reason.placeholder='退回或撤回時請說明原因';
  c.body.append(field('審核說明',reason));
  if(api.can('sop.review')&&api.can('sop.edit')&&api.can('sop.publish'))action(c,'預覽發布',()=>plan(c,'approve',reason.value.trim()||'已逐項核對提案差異'),true);
  if(api.can('sop.review'))action(c,'預覽退回',()=>plan(c,'reject',reason.value.trim()));
  if(p.author_id===api.person()?.employeeId&&api.can('sop.propose'))action(c,'預覽撤回',()=>plan(c,'withdraw',reason.value.trim()));
 }
 async function plan(c,op,reason,sourceRevision){
  if(reason.length<3)fail('REASON_REQUIRED');
  const latest=await api.workspace('sop.read');check(c);
  const args={operation:op,expectedRevision:latest.sop?.revision||0,reason,...(sourceRevision?{sourceRevision}:{proposalId:c.pid})};
  const r=await api.workspace('sop.plan',args,true);check(c);
  if(!r?.planId||r.preview?.before!==latest.sop.content||typeof r.preview.after!=='string')fail('REVISION_CONFLICT');
  const label={approve:'發布',reject:'退回',withdraw:'撤回',restore:'還原'}[op];
  view(c,'確認'+label+(c.proposal?' · '+c.proposal.topic:''));
  c.plan=r;c.body.append(el('p',{},'本次操作依據 r'+args.expectedRevision+'。'+reason));
  if(op==='approve'||op==='restore'){
   if(c.proposal?.change_set)showChanges(c.body,c.proposal.change_set.changes,c.proposal.change_set.related);
   c.body.append(details('展開發布前後的完整原文',diff(r.preview.before,literal(r.preview.after))));
  }
  action(c,'確認'+label,()=>commit(c,op,r),true);
  action(c,'返回',()=>c.pid?loadProposal(c,c.pid):history(c));
 }
 async function commit(c,op,plan){
  if(c.plan!==plan)fail('PLAN_STALE');
  const isVersion=op==='approve'||op==='restore';
  const samePlan=()=>api.workspace('sop.commit',{planId:plan.planId,confirm:'CONFIRM_SOP_REVIEW'},true);
  const verify=async(receipt)=>{
   const got=c.pid?await api.workspace('sop.proposal',{proposalId:c.pid}):null;check(c);
   if(got&&got.status!==({approve:'approved',reject:'rejected',withdraw:'withdrawn'}[op]))fail('READBACK_PENDING');
   if(isVersion){
    const revision=got?.publishedRevision??receipt?.revision;if(!Number.isInteger(revision))fail('READBACK_PENDING');
    const exact=await api.workspace('sop.version',{revision});check(c);
    const current=await api.workspace('sop.read');check(c);
    if(exact?.sop?.content!==plan.preview.after||exact.sop.revision!==revision||current.sop.revision<revision||current.sop.revision===revision&&current.sop.content!==exact.sop.content)fail('READBACK_PENDING');
    published(current.sop);source=null;pendingSource=null;
    view(c,'已核對發布原文');c.body.append(el('p',{},'此次'+(op==='restore'?'還原':'發布')+'為 r'+revision+'，目前問答讀取 r'+current.sop.revision+'。'));
   }else review(c,got);
   c.plan=null;
  };
  let receipt;
  try{receipt=await samePlan();check(c);if(receipt?.planId!==plan.planId||receipt?.operation!==op)fail('READBACK_PENDING');await verify(receipt);}
  catch(e){
   check(c);if(['PLAN_STALE','REVISION_CONFLICT','SOP_REBASE_REQUIRED','FORBIDDEN','PROPOSAL_RESOLVED'].includes(e.code||e.message)){c.plan=null;view(c,'請重新核對審核狀態');action(c,'重新讀取',()=>c.pid?loadProposal(c,c.pid):history(c));throw e;}
   try{await verify(receipt);return;}catch{/* An idempotent retry uses only the original plan. */}
   view(c,'正在核對審核結果');action(c,'重新核對',()=>commit(c,op,plan),true);fail('READBACK_PENDING');
  }
 }
 async function loadProposal(c,id){const result=await api.workspace('sop.proposal',{proposalId:id});check(c);review(c,result);}
 async function inbox(c){
  const result=await api.workspace('sop.proposals');check(c);view(c,'SOP 修訂提案');
  if(!result.proposals.length)c.body.append(el('p',{},'目前可查看的範圍內沒有提案。'));
  for(const p of result.proposals)c.body.append(button(p.topic+' · '+(states[p.status]||p.status)+' · '+p.authorName,()=>run(c,()=>loadProposal(c,p.id))));
 }
 async function history(c){
  const r=await api.workspace('sop.history');check(c);view(c,'SOP 版本紀錄');c.pid=null;c.proposal=null;
  for(const v of r.versions){const row=el('div',{},el('p',{},'r'+v.revision+' · '+(v.note||'已發布版本')));
   if(v.revision!==r.currentRevision&&['sop.review','sop.edit','sop.publish'].every(k=>api.can(k))){
    const reason=area('','還原 r'+v.revision+' 的原因',()=>{},1000);
    row.append(details('還原此版',field('還原原因',reason),button('預覽還原',()=>run(c,()=>plan(c,'restore',reason.value.trim(),v.revision)))));
   }
   c.body.append(row);
  }
 }
 function noteSource(reference,answer){
  pendingSource=Number.isInteger(reference?.revision)&&Array.isArray(reference.lines)&&reference.lines.length&&typeof answer==='string'?{reference,binding:identity(),anchor:answer.trim().slice(-55)}:null;
 }
 function bindSource(node,answer){
  if(!node||!pendingSource||pendingSource.binding!==identity()||!answer.includes(pendingSource.anchor))return;
  const ref=pendingSource.reference;pendingSource=null;const b=button('提議修訂這段 SOP',()=>{if(b.isConnected&&sourceBinding===identity()){active=null;source={reference:ref,node:b,binding:sourceBinding,explicit:true};const input=document.getElementById('userInput');if(input){input.placeholder='描述這段 SOP 要怎麼改';input.focus();}}},'sop-source');
  const sourceBinding=identity();node.append(b);source={reference:ref,node:b,binding:sourceBinding};
 }
 function handle(text,echo=noticeUser,resolved=null){
  if(active&&!alive(active))active=null;
  if(source&&(!source.node.isConnected||source.binding!==identity()))source=null;
  let type=resolved||revisionIntent(text,{source:!!source,draft:!!active});
  if(type==='interpret'){
   const binding=identity();
   if(!classify||!api.can('ai.use')||!api.can('sop.view')||!api.can('sop.propose'))type='normal';
   else{
    const original=active,reference=source;
    return capabilities().then(()=>classify(text,{hasSource:!!source,hasDraft:!!active})).catch(()=>'clarify').then(intent=>{
     if(binding!==identity()||original!==active||reference!==source)return true;
     const choice={revise:'edit',question:'normal',account:'normal',clarify:'clarify'}[intent]||'clarify';
     return handle(text,echo,choice);
    });
   }
  }
  if(!resolved&&type==='normal'&&active?.followup&&!/查詢|請問|帳號|通行碼|月報|報表|時數|工時|專案進度|[?？]/.test(text))type='edit';
  if(!resolved&&type==='normal'&&source?.explicit&&!/怎麼|如何|誰|[?？]|查詢|帳號|報表|工時|通行碼/.test(text))type='edit';
  const ref=source?.reference;source=null;pendingSource=null;
  if(type==='normal'){active=null;return false;}
  if(!container()||!identity())return false;
  echo(text);
  if(type==='cancel'){if(active&&!active.busy)cancelCard(active);else active?.stop?.abort();return true;}
  if(type==='edit'&&active?.busy){active.status.textContent=messages.SOP_BUSY;return true;}
  const c=type==='edit'&&active?active:newCard('SOP 修訂');
  if(type==='inbox'||type==='history'){active=null;void run(c,()=>type==='inbox'?inbox(c):history(c));return true;}
  c.followup=false;c.origin||=text;if(ref&&!c.draft)c.reference=ref;
  if(type==='clarify'){
   active=null;view(c,'這段要列入 SOP 修訂嗎？');c.body.append(el('p',{},'可以先比對現行條文，確認差異後再送審。'));
   action(c,'比對 SOP 原文',()=>{active=c;return generate(c,c.origin);},true);
   action(c,'結束這次提議',()=>cancelCard(c));
  }else if(type==='ambiguous'){
   active=null;view(c,'要更新哪一份資料？');c.body.append(el('p',{},'修改 SOP 名單會產生條文差異。人員的登入資格與職務權限由通行碼管理處理。'));
   action(c,'修改 SOP 文字',()=>{active=c;return generate(c,c.origin);},true);
   if(api.can('people.manage'))action(c,'開啟人員管理',openPeople);
   else action(c,'查看帳號處理方式',()=>{c.status.textContent='請聯絡具人員管理權限的主管開立或異動帳號。';});
  }else{active=c;void run(c,()=>generate(c,text));}
  return true;
 }
 return {handle,clear,noteSource,bindSource};
}
