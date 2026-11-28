import {el,button,errorText} from '../shared/dom.mjs';
import {revisionIntent,sopConversationKind,usesRevisionReference} from './intent.mjs';

const opLabel={replace:'修改',after:'在此段後新增',delete:'刪除'};
export const states={pending:'待審核',approved:'已發布',withdrawn:'已撤回',rejected:'已退回'};
const messages={
 SOP_PROTOCOL:'此環境尚未啟用新版 SOP 修訂服務。',SOP_TARGET_CHANGED:'原文位置或內容已有差異，請依最新版重新分析。',
 SOP_REBASE_REQUIRED:'提案依據的 SOP 已更新，請重新比較。',SOP_PROTECTED_SECTION:'此段含受保護的資料，無法在聊天中修訂。',
 SOP_ROSTER_FORMAT:'同一個職稱請合併在原名單那一行。若是舊提案，請退回調整後再送審。',SOP_HEADING_FORMAT:'請保留原有章節標題，再調整段內條文。',
 SOP_REVIEW_REQUIRED:'請先填寫每項衝突的處理方式。',BAD_SOP_REQUEST:'請以一般條文描述修改內容，移除憑證或私人資料。',
 BAD_SOP_PATCH:'差異無法套用至原文，請重新核對選取的內容。',SOP_SOURCE_MISSING:'此環境尚無可供修訂的已發布 SOP。',
 READBACK_PENDING:'送出結果仍待核對，請點「重新核對」讀取同一筆紀錄。',SOP_BUSY:'這張修訂卡仍在處理上一個動作。'};
const describe=e=>e.name==='AbortError'?'已停止分析，輸入的內容仍保留在對話中。':messages[e.code||e.message]||errorText(e);
function sameData(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameData(a[k],b[k]));
}
const fail=code=>{throw Object.assign(Error(code),{code});};
const field=(name,input)=>el('label',{},el('span',{},name),input);
const details=(title,...nodes)=>el('details',{},el('summary',{},title),...nodes);
const area=(value,label,update,maxLength=12000)=>el('textarea',{value,rows:3,maxLength,'aria-label':label,oninput:e=>update(e.target.value)});
const literal=readable;
const diff=(before,after,isAfter=false,original=literal(before))=>el('div',{class:'sop-diff',role:'group','aria-label':'修訂前後比較'},el('div',{},el('small',{},isAfter?'插入位置的原文':'目前原文'),original),el('div',{},el('small',{},isAfter?'新增於此行之後':'修訂後'),after));
// Unchanged ranges share grid rows. A long insertion on either side cannot move the following section out of alignment.
export function fullComparison(before,after,changes=[]){
 const grid=el('div',{class:'sop-full-grid'});
 const box=details('展開發布前後的完整原文',el('div',{class:'sop-full-labels'},el('strong',{},'目前原文'),el('strong',{},'修訂後')),grid);
 let mounted=false;
 box.addEventListener('toggle',()=>{
  if(!box.open||mounted)return;
  mounted=true;
  const left=before.split(/\r?\n/),right=after.split(/\r?\n/);
  const ranges=[];let i=0,j=0;
  function add(oldLines,newLines,changed){
   if(oldLines.length||newLines.length)ranges.push({oldLines,newLines,changed});
   i+=oldLines.length;j+=newLines.length;
  }
  for(const c of changes){
   const start=c.op==='after'?c.end:c.start-1;
   if(start<i||start>left.length)break;
   const count=start-i;add(left.slice(i,start),right.slice(j,j+count),false);
   const oldCount=c.op==='after'?0:c.end-c.start+1,newCount=c.op==='delete'?0:c.after.split('\n').length;
   add(left.slice(i,i+oldCount),right.slice(j,j+newCount),true);
  }
  let common=0;
  while(i+common<left.length&&j+common<right.length&&left[i+common]===right[j+common])common++;
  add(left.slice(i,i+common),right.slice(j,j+common),false);
  let tail=0;
  while(left.length-tail>i&&right.length-tail>j&&left[left.length-tail-1]===right[right.length-tail-1])tail++;
  add(left.slice(i,left.length-tail),right.slice(j,right.length-tail),true);
  add(left.slice(i),right.slice(j),false);
  let anchor;
  for(const r of ranges){
   const row=el('div',{class:'sop-full-row'},el('pre',{},r.oldLines.join('\n')),el('pre',{},r.newLines.join('\n')));
   if(r.changed&&!anchor)anchor=row;
   grid.append(row);
  }
  if(anchor)grid.scrollTop+=anchor.getBoundingClientRect().top-grid.getBoundingClientRect().top;
 });
 return box;
}
function readable(text){
 const p=el('div',{class:'sop-literal'});
 for(const [i,row] of String(text).split('\n').entries()){
  if(i)p.append('\n');
  for(const [n,part] of row.replace(/^(\s*)[-*] /,'$1• ').split(/\*\*([^*\n]+)\*\*/).entries())p.append(n%2?el('strong',{},part):part);
 }
 return p;
}
function markRange(node,start,end){
 let offset=0;
 function walk(parent){
  for(const child of [...parent.childNodes]){
   if(child.nodeType!==3){walk(child);continue;}
   const text=child.textContent,from=Math.max(0,start-offset),to=Math.min(text.length,end-offset);offset+=text.length;
   if(from<to)child.replaceWith(text.slice(0,from),el('mark',{},text.slice(from,to)),text.slice(to));
  }
 }
 walk(node);
}
function markDifference(left,right,op){
 const old=left.textContent,fresh=right.textContent;
 if(op==='after'){markRange(right,0,fresh.length);return;}
 if(op==='delete'){markRange(left,0,old.length);return;}
 let start=0,tail=0;
 while(start<old.length&&start<fresh.length&&old[start]===fresh[start])start++;
 while(old.length-tail>start&&fresh.length-tail>start&&old.at(-tail-1)===fresh.at(-tail-1))tail++;
 // Do not split an emoji or another supplementary character across DOM nodes.
 if(start>0&&/[\uDC00-\uDFFF]/.test(old[start]||fresh[start]||''))start--;
 if(tail>0&&/[\uDC00-\uDFFF]/.test(old[old.length-tail]||fresh[fresh.length-tail]||''))tail--;
 markRange(left,start,old.length-tail);markRange(right,start,fresh.length-tail);
}
export function showChanges(target,changes,related=[],editable=false){
 for(const c of changes){
  const title=c.section+' · 第 '+c.start+(c.end===c.start?'':'–'+c.end)+' 行 · '+opLabel[c.op];
  const after=c.op==='delete'?literal('刪除此段'):literal(c.after);
  const original=literal(c.before);markDifference(original,after,c.op);
  const group=el('div',{class:'sop-change'},el('p',{},el('strong',{},title)),diff(c.before,after,c.op==='after',original),el('small',{},c.why));
  if(editable&&c.op!=='delete')group.append(details('編輯修訂文字',area(c.after,title+' 新文',v=>{c.after=v;after.replaceChildren(...literal(v).childNodes);original.replaceChildren(...literal(c.before).childNodes);markDifference(original,after,c.op);})));
  target.append(group);
 }
 const extra=el('div');
 for(const r of related){
  if(r.kind==='reference'&&changes.some(c=>c.start<=r.line&&c.end>=r.line))continue;
  const block=el('div',{},el('p',{},el('strong',{},(r.kind==='conflict'?'待決定':'相關條文')+' · '+r.section+' · 第 '+r.line+' 行')),literal(r.excerpt),el('p',{},r.why));
  if(r.kind==='conflict')block.append(editable?field('這個差異要怎麼處理？',area(r.decision||'','衝突處理方式',v=>{r.decision=v;},500)):el('p',{},'處理方式　'+(r.decision||'尚未填寫')));
  if(r.kind==='conflict')target.append(block);else extra.append(block);
 }
 if(extra.childNodes.length)target.append(details('查看相關條文',extra));
}
export function createRevisionChat({api,analyze,classify,container=()=>document.getElementById('chatContainer'),published=()=>{},openPeople=()=>{},noticeUser=()=>{}}){
 let active=null,source=null,pendingSource=null,capabilityBinding=null;
 const cards=new Set();
 const present=()=>globalThis.window?.leavesRevisionPresentation;
 let selected=null,indicator=null;
 function disarm(){
  if(selected){selected.setAttribute('aria-pressed','false');selected.querySelector('span').textContent='修訂 SOP';}
  selected=null;indicator?.remove();indicator=null;
  if(source?.explicit)source=null;
 }
 function resetTools(){disarm();for(const node of container()?.querySelectorAll('.sop-source')||[])node.remove();}
 function broadcast(){globalThis.window?.dispatchEvent(new CustomEvent('leaves:sop-proposals-changed'));}

 const identity=()=>{const p=api.person();return p?JSON.stringify([api.epoch(),p.employeeId,p.environment,p.revision,p.permissions]):'';};
 const alive=c=>!!c&&c.binding===identity()&&c.box.isConnected;
 function check(c){if(!alive(c))fail('STALE_SESSION');}
 function clear(){capabilityBinding=null;for(const c of cards){c.stop?.abort();c.tracker?.stop();c.box.remove();}cards.clear();active=null;source=null;pendingSource=null;resetTools();}
 function newCard(title,host=null){
  const parent=host||container();if(!parent)return null;
  for(const old of cards)if(!alive(old)){old.stop?.abort();old.tracker?.stop();cards.delete(old);}
  const box=el('section',{class:'sop-revision','aria-label':title}),heading=el('h3',{},title),body=el('div'),status=el('p',{class:'sop-message',role:'status','aria-live':'polite'});
  const actions=el('div',{class:'sop-actions'});
  const content=el('div',{class:'markdown-body break-words selectable-text'},heading,body,status,actions);
  box.append(el('div',{class:'flex items-start space-x-3'},el('div',{class:'bg-white text-black w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0'},'AI'),el('div',{class:'ai-answer-shell is-settled glass-card text-neutral-200 p-4 rounded-2xl shadow-xl max-w-[88%] selectable-text'},content)));
  if(host){box.replaceChildren(heading,body,status,actions);box.className='sop-review-detail';}
  parent.append(box);
  const c={box,heading,body,status,actions,binding:identity(),busy:false,admin:!!host};
  cards.add(c);parent.scrollTop=parent.scrollHeight;return c;
 }
 function settle(c){
  if(!c.tracker)return;
  const content=c.tracker.ready();c.tracker=null;c.stopButton?.remove();
  if(content)content.replaceChildren(c.heading,c.body,c.status,c.actions);
 }
 function view(c,title){check(c);settle(c);c.heading.textContent=title;c.body.replaceChildren();c.status.textContent='';c.actions.replaceChildren();}
 function thinking(c,text,stop){
  const ui=present();
  if(ui){
   c.box.replaceChildren();c.tracker=ui.start(c.box,text);
   c.stopButton=button('停止分析',()=>stop.abort(),'sop-stop');c.box.firstElementChild.append(c.stopButton);
  }else c.actions.append(button('停止分析',()=>stop.abort()));
  return (stage,detail)=>{if(!alive(c)||stop.signal.aborted)return;if(c.tracker)c.tracker.stage(stage,detail);else c.status.textContent=detail;};
 }
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
   if(!d.changes?.length){
    c.reference=null;c.body.append(el('p',{},'已讀取 r'+r.sop.revision+'，請重新定位原條文。'));
    action(c,'依新版重新分析',()=>generate(c,c.lastQuestion||c.origin),true);return;
   }
   const box=el('div',{},el('p',{},'目前為 r'+r.sop.revision+'。以下逐項核對原章節與引用文字。'));
   for(const item of d.changes){
    let section='文件開頭';
    const matches=[];
    for(const [i,line] of sourceLines.entries()){
     if(/^#{1,6}\s/.test(line))section=line.replace(/^#{1,6}\s+/,'');
     if(section===item.section&&sourceLines.slice(i,i+item.end-item.start+1).join('\n')===item.before)matches.push(i+1);
    }
    box.append(el('p',{},item.section+' · 舊位置 '+item.start+' · '+(matches.length===1?'現行第 '+matches[0]+' 行':matches.length?'有多個相符位置':'現行內容已變動')),literal(item.before),details('原提議新文',literal(item.after)));
   }
   c.body.append(box);c.actions.replaceChildren();action(c,'依新版重新分析',async()=>{
    const fresh=newCard('依最新版重新分析');fresh.origin=c.origin||c.proposal?.reason||d.topic;fresh.reference=null;active=fresh;
    await run(fresh,()=>generate(fresh,fresh.origin+'\n請在最新原文重新定位這些舊版提議：'+(d.changes||[]).map(v=>v.section+'：'+(v.op==='delete'?'刪除「'+v.before+'」':v.after)).join('\n').slice(0,2000)));
   },true);
  });
 }
 function cancelCard(c){
  c.stop?.abort();if(active===c)active=null;
  view(c,'已結束本次草稿');c.draft=null;c.pending=null;
  c.remember?.('畫面顯示已結束本次草稿。');
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
  const watcher=typeof MutationObserver==='function'?new MutationObserver(()=>{if(!alive(c)){stop.abort();c.tracker?.stop();}}):null;
  watcher?.observe(container(),{childList:true,subtree:false});
  const stage=thinking(c,question,stop);stage('knowledge','比對已發布的 SOP 原文');
  try{
   await capabilities(c);
   const request={protocol:1,origin:c.origin,...(c.reference?{reference:c.reference}:{}),...(previous?{previous:{revision:previous.revision,topic:previous.topic,changes:previous.changes.map(({start,end,after,op})=>({start,end,after,op}))}}:{})};
   const result=await analyze(question,request,stop.signal,state=>stage('routing',state?(present()?.queueLabel(state)||'正在等待模型服務，稍後自動繼續'):'正在分析修訂方向與相關條文'));check(c);
   stage('draft','整理修訂前後的差異');
   if(stop.signal.aborted)fail('AI_CANCELLED');
   const draft=result?.sopDraft;
   if(!draft||!Number.isInteger(draft.revision)||!Array.isArray(draft.changes)||!Array.isArray(draft.related))fail('SOP_PROTOCOL');
   c.draft=draft;c.followup=!draft.changes.length;c.pending=null;
   if(draft.changes.length)c.reference={revision:draft.revision,lines:draft.changes.slice(0,12).map(x=>x.start)};
   else if(c.reference?.revision!==draft.revision)c.reference=null;
   active=c;
   c.remember?.(draft.changes.length?'畫面已顯示原文和修訂後差異。目前是草稿，尚待使用者確認送出。':'畫面顯示需要補充修訂位置或內容。這次尚無可送審的差異。');
   renderDraft(c);
  }catch(e){check(c);if(previous){c.draft=previous;renderDraft(c);}else{view(c,'SOP 修訂尚未完成');action(c,'取消草稿',()=>cancelCard(c));}
   c.remember?.(previous?'這次分析未完成。畫面仍顯示上一份未送審的草稿。':'這次分析未完成。畫面可重新分析，尚未送審。');
   action(c,'重新分析',()=>generate(c,question));throw e;
  }finally{watcher?.disconnect();if(!alive(c))c.tracker?.stop();if(c.stop===stop)c.stop=null;}
 }
 function renderDraft(c){
  const d=c.draft;view(c,d.topic);c.body.append(el('p',{},d.summary),el('p',{class:'sop-context'},'草稿 · 依據已發布 SOP r'+d.revision+' · 本次比對 '+d.shown+' / '+d.sections+' 個可讀章節'));
  showChanges(c.body,d.changes,d.related,true);
  if(!d.changes.length&&d.choices?.length){
   c.body.append(el('p',{},'可選擇一個原文位置繼續'));
   const choices=el('div',{class:'sop-choices'});
   for(const opt of d.choices){const b=button(opt.section+' · 第 '+opt.line+' 行',()=>run(c,()=>{c.reference={revision:d.revision,lines:[opt.line]};return generate(c,'請以我選擇的〈'+opt.section+'〉第 '+opt.line+' 行為主要位置，繼續原提議。');}));b.title=opt.text;choices.append(b);}
   c.body.append(choices);
  }
  if(d.changes.length)c.sendButton=action(c,'確認差異，送出提案',()=>submit(c),true);
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
   if(!record.status||record.proposal?.id!==request.id||record.proposal.base_revision!==request.baseRevision||record.proposal.author_id!==api.person()?.employeeId||!sameData(record.proposal.change_set,request.changeSet))fail('READBACK_PENDING');
   c.pending=null;c.proposal=record.proposal;c.pid=request.id;c.draft=null;
   const state=states[record.status]||record.status;
   c.remember?.('已從後端讀回提案，畫面顯示「已送出 · '+state+'」。');
   view(c,record.proposal.topic);
   c.body.append(el('p',{},record.proposal.reason),el('p',{class:'sop-context'},'提案 '+request.id+' · 原文 r'+request.baseRevision));
   const receipt=c.sendButton||el('button',{type:'button'});
   receipt.disabled=true;receipt.className='sop-receipt';receipt.replaceChildren(el('span',{'aria-hidden':'true'},'✓'),' 已送出 · '+state);c.actions.append(receipt);
   broadcast();
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
   c.remember?.('提案的送出結果仍待核對。畫面可讀回同一筆紀錄。');
   action(c,'重新核對',verify,true);action(c,'用同一編號重送',()=>submit(c));fail('READBACK_PENDING');
  }
 }
 function review(c,record){
  const p=record.proposal;c.proposal=p;c.pid=p.id;c.plan=null;c.draft=null;
  view(c,p.topic+' · '+(states[record.status]||record.status));
  c.body.append(el('p',{class:'sop-context'},'提案 '+p.id+' · 原文 r'+p.base_revision+(record.publishedRevision?' · 發布 r'+record.publishedRevision:'')),el('p',{},p.reason));
  if(record.authorName)c.body.append(el('p',{class:'sop-context'},'提出人　'+record.authorName+(p.created_at?' · '+new Date(p.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'')));
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
  c.plan=r;c.planInput={op,reason,sourceRevision};c.body.append(el('p',{},'本次操作依據 r'+args.expectedRevision+'。'+reason));
  if(op==='approve'||op==='restore'){
   if(c.proposal?.change_set)showChanges(c.body,c.proposal.change_set.changes,c.proposal.change_set.related);
   c.body.append(fullComparison(r.preview.before,r.preview.after,c.proposal?.change_set?.changes||[]));
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
    published(current.sop);resetTools();source=null;pendingSource=null;
    view(c,'已核對發布原文');c.body.append(el('p',{},'此次'+(op==='restore'?'還原':'發布')+'為 r'+revision+'，目前問答讀取 r'+current.sop.revision+'。'));
   }else review(c,got);
   broadcast();
   c.plan=null;
  };
  let receipt;
  try{receipt=await samePlan();check(c);if(receipt?.planId!==plan.planId||receipt?.operation!==op)fail('READBACK_PENDING');await verify(receipt);}
  catch(e){
   check(c);
   if((e.code||e.message)==='PLAN_STALE'){
    c.plan=null;
    if(c.pid){const latest=await api.workspace('sop.proposal',{proposalId:c.pid});check(c);if(latest.status!=='pending'){review(c,latest);return;}}
    const saved=c.planInput;
    view(c,'重新產生審核預覽');
    await planAgain(c,saved);return;
   }
   if(['REVISION_CONFLICT','SOP_REBASE_REQUIRED','FORBIDDEN','PROPOSAL_RESOLVED'].includes(e.code||e.message)){c.plan=null;view(c,'請重新核對審核狀態');action(c,'重新讀取',()=>c.pid?loadProposal(c,c.pid):history(c));throw e;}
   try{await verify(receipt);return;}catch{/* An idempotent retry uses only the original plan. */}
   view(c,'正在核對審核結果');action(c,'重新核對',()=>commit(c,op,plan),true);fail('READBACK_PENDING');
  }
 }
 async function planAgain(c,{op,reason,sourceRevision}){
  await plan(c,op,reason,sourceRevision);
  c.status.textContent='前次比較已到期。已重新讀取，請核對這次的差異後再確認。';
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
  pendingSource=Number.isInteger(reference?.revision)&&Array.isArray(reference.lines)&&reference.lines.length&&typeof answer==='string'?{reference,binding:identity(),anchor:answer.trim()}:null;
 }
 function bindSource(node,answer){
  if(!node||!pendingSource||pendingSource.binding!==identity()||!answer.includes(pendingSource.anchor))return;
  const ref=pendingSource.reference,binding=identity();pendingSource=null;
  const report=node.querySelector('button[onclick^="reportErrorLog"],button[data-answer-action="report"]');
  if(!report||!api.can('sop.view')||!api.can('ai.use')||!api.can('sop.propose'))return;
  if(!report.previousElementSibling?.classList.contains('sop-source')){
   const b=button('修訂 SOP',()=>{
    if(binding!==identity()||!b.isConnected||!api.can('sop.propose'))return;
    const on=selected!==b;disarm();
    source={reference:ref,node:b,binding,explicit:on};
    if(on){
     active=null;selected=b;b.setAttribute('aria-pressed','true');label.textContent='修訂已啟用';
     const input=document.getElementById('userInput');
     indicator=button('修訂 SOP 已啟用 ×',()=>disarm(),'sop-indicator');input?.parentElement?.insertBefore(indicator,input);input?.focus();
    }else source=null;
   },'leaves-answer-action sop-source');
   const label=el('span',{},'修訂 SOP');
   b.replaceChildren(el('i',{class:'fa-solid fa-file-pen','aria-hidden':'true'}),label);
   b.setAttribute('aria-pressed','false');b.title='以這則回答引用的條文提出修訂';report.before(b);
   if(!selected)source={reference:ref,node:b,binding};
  }
 }
 function handle(text,echo=noticeUser,resolved=null){
  if(active&&!alive(active))active=null;
  if(source&&(!source.node.isConnected||source.binding!==identity())){disarm();source=null;}
  let type=resolved||revisionIntent(text,{source:!!source,draft:!!active,armed:!!source?.explicit||!!active?.followup});
  if(type==='interpret'){
   const binding=identity();
   if(!classify||!api.can('ai.use')||!api.can('sop.view')||!api.can('sop.propose'))type='normal';
   else{
    const original=active,reference=source;
    const pending=newCard('正在理解修訂需求');const stop=new AbortController();pending.stop=stop;
    const stage=thinking(pending,text,stop);stage('understand','理解這次是否要修訂 SOP');
    return capabilities().then(()=>classify(text,{hasSource:!!source,hasDraft:!!active},stop.signal,state=>stage('routing',state?(present()?.queueLabel(state)||'等待服務恢復'):'正在理解修訂需求'))).catch(()=>'clarify').then(intent=>{
     const stillHere=alive(pending);pending.tracker?.stop();pending.box.remove();cards.delete(pending);if(!stillHere||stop.signal.aborted)return true;
     if(binding!==identity()||original!==active||reference!==source)return true;
     const choice={revise:'edit',question:'normal',account:'normal',clarify:'clarify'}[intent]||'clarify';
     return handle(text,echo,choice);
    });
   }
  }
  if(!resolved&&type==='normal'&&active?.followup&&/^(?:請把|請將|再補|加上|改為|換成|新文[：:])/.test(text)&&!/查詢|請問|帳號|通行碼|月報|報表|時數|工時|專案進度|回答|回覆|[?？]/.test(text))type='edit';
  if(!resolved&&type==='normal'&&source?.explicit&&/^(?:請把|請將|改為|換成|加上|應為|調整為|補充|新文[：:])/.test(text)&&!/帳號|報表|工時|通行碼|回答|回覆/.test(text))type='edit';
  const ref=source?.explicit||usesRevisionReference(text)?source?.reference:null;
  disarm();source=null;pendingSource=null;
  if(type==='normal'){active=null;return false;}
  if(!container()||!identity())return false;
  echo(text);
  if(type==='cancel'){if(active&&!active.busy)cancelCard(active);else active?.stop?.abort();return true;}
  if(type==='edit'&&active?.busy){active.status.textContent=messages.SOP_BUSY;return true;}
  const c=type==='edit'&&active?active:newCard('SOP 修訂');
  c.remember=present()?.remember?.(text,'使用者已進入 SOP 修訂流程，尚未送出提案。');
  if(type==='inbox'||type==='history'){active=null;void run(c,()=>type==='inbox'?inbox(c):history(c));return true;}
  c.followup=false;c.origin||=text;if(ref&&!c.draft)c.reference=ref;
  if(type==='clarify'){
   c.remember?.('畫面詢問是否需要比對 SOP 原文。尚未產生草稿。');
   active=null;view(c,'這段要列入 SOP 修訂嗎？');c.body.append(el('p',{},'可以先比對現行條文，確認差異後再送審。'));
   action(c,'比對 SOP 原文',()=>{active=c;return generate(c,c.origin);},true);
   action(c,'結束這次提議',()=>cancelCard(c));
  }else if(type==='ambiguous'){
   c.remember?.('畫面請使用者選擇修改 SOP 文字或走人員管理流程。尚未送出提案。');
   active=null;view(c,'要更新哪一份資料？');c.body.append(el('p',{},'修改 SOP 名單會產生條文差異。人員的登入資格與職務權限由通行碼管理處理。'));
   action(c,'修改 SOP 文字',()=>{active=c;return generate(c,c.origin);},true);
   if(api.can('people.manage'))action(c,'開啟人員管理',openPeople);
   else action(c,'查看帳號處理方式',()=>{c.status.textContent='請聯絡具人員管理權限的主管開立或異動帳號。';});
  }else{active=c;void run(c,()=>generate(c,text));}
  return true;
 }
 function openReview(host,record){
  const c=newCard('SOP 修訂提案',host);review(c,record);
  return ()=>{c.stop?.abort();c.box.remove();cards.delete(c);};
 }
 return {handle,clear,noteSource,bindSource,openReview,conversationKind:sopConversationKind};
}
