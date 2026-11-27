import {diagnosticStep,safeGatewayTrace,safeTraceId,safeTraceCode,stageNames} from '../x1/diagnostic.mjs';
import {el,button,table,dialog} from '../shared/dom.mjs';
export function legacyLayout(body,bridge){
 const nodes=bridge.legacyBody?.()||[];if(!nodes.length)return null;
 body.replaceChildren(...nodes);body.classList.add('li-legacy-content');body.parentElement.classList.add('li-heritage');
 for(const n of body.querySelectorAll('*'))for(const a of [...n.attributes])if(a.name.startsWith('on')){n.dataset['legacy'+a.name.slice(2)]=a.value;n.removeAttribute(a.name);}
 return{get:id=>body.querySelector('#'+id),set(id,text){const n=body.querySelector('#'+id);if(n)n.textContent=text;},body};
}
export function usageSummary(attempts,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())){
 const day=a=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(a.started_at));
 const current=attempts.filter(a=>day(a)===today),known=current.filter(a=>Number.isFinite(a.total_tokens)),models=new Map();
 for(const a of attempts){const name=a.model||'尚無模型收據',row=models.get(name)||{name,count:0,success:0,failed:0,tokens:0,unknown:0};row.count++;if(a.outcome==='complete'||a.outcome==='succeeded'||a.outcome==='success')row.success++;else if(a.outcome)row.failed++;if(Number.isFinite(a.total_tokens))row.tokens+=a.total_tokens;else row.unknown++;models.set(name,row);}
 return{today,current,knownTokens:known.reduce((s,a)=>s+a.total_tokens,0),unknown:current.length-known.length,models:[...models.values()].sort((a,b)=>b.count-a.count)};
}
export function renderModelMonitor(layout,usage,models,environmentName='獨立測試站'){
 const {get,set,body}=layout,summary=usageSummary(usage.attempts);
 const heading=get('autoFreeHealthStatus').parentElement;heading.querySelector('.text-sm').textContent='伺服器調度 · 免費模型候選順序';heading.querySelector('.text-neutral-500').textContent='保留原調度版面；候選順序以伺服器設定為準，各題派送次數見診斷。實際可用性依供應商回覆。';
 set('autoFreeHealthStatus','已讀取伺服器狀態');set('routingBestCandidate',models[0]||'未提供');set('routingAvailableCount',models.length+' 個已設定');set('routingDegradedCount','依請求結果觀測');set('routingHardBlockCount','未提供');set('lastAssignedNodeText','最近回覆模型：'+(usage.attempts.find(a=>a.model)?.model||'尚無收據'));
 const ranking=get('modelHealthRankingContainer'),filters=get('modelHealthFilters');filters.replaceChildren();let filter='all';
 const rows=models.map(name=>({name,...summary.models.find(m=>m.name===name)}));
 function paint(){ranking.replaceChildren();for(const r of rows.filter(r=>filter==='all'||filter==='success'&&r.success||filter==='failed'&&r.failed||filter==='unknown'&&!r.count)){const card=el('article',{class:'li-ai-row'},el('header',{},el('strong',{},r.name),el('span',{},r.count?'有請求紀錄':'尚無收據')),el('p',{class:'li-note'},'近期 '+(r.count||0)+' 次 · 成功 '+(r.success||0)+' · 其他結果 '+(r.failed||0)),button('詳細狀態',()=>{const d=dialog(r.name);d.content.append(el('p',{},'這是近期請求觀測，不代表供應商目前健康或剩餘額度。'),el('pre',{},JSON.stringify(r,null,2)));}));ranking.append(card);}if(!ranking.children.length)ranking.append(el('p',{class:'li-note'},'此篩選沒有資料。'));for(const b of filters.children)b.classList.toggle('is-active',b.dataset.filter===filter);}
 for(const [id,label]of [['all','全部'],['success','有成功回覆'],['failed','有其他結果'],['unknown','尚無收據']]){const b=button(label,()=>{filter=id;paint();},'model-health-filter-btn');b.dataset.filter=id;filters.append(b);}paint();
 const rankTitle=filters.parentElement.querySelector('.text-neutral-200');if(rankTitle)rankTitle.textContent='候選模型與近期請求觀測';const rankNote=filters.parentElement.querySelector('.text-neutral-600');if(rankNote)rankNote.textContent='不再使用舊瀏覽器健康分數；以新站實際請求收據呈現。';
 set('companyTelemetryEnvironment',environmentName);set('companyTelemetryStatus','已同步最近 '+usage.attempts.length+' 次請求；不是全歷史總量。');const telemetry=body.querySelector('.company-telemetry-shell .text-neutral-600');if(telemetry)telemetry.textContent='從伺服器讀取跨裝置紀錄，不另存一套用量。';set('dispatchStatsSummary','今日可讀 '+summary.current.length+' · 近期 '+usage.attempts.length+' 次');
 get('dispatchStatsContainer').replaceChildren(...summary.models.map(r=>el('div',{class:'li-ai-row'},el('header',{},el('span',{},r.name),el('span',{},r.count+' 次 · '+(r.count/usage.attempts.length*100).toFixed(1)+'%')),el('div',{class:'li-ai-meter'},el('span',{style:'width:'+(r.count/usage.attempts.length*100)+'%'})))));
 get('dispatchLogsTableBody').replaceChildren(...usage.attempts.slice(0,30).map(a=>el('tr',{},[a.started_at,a.model||'尚無收據',a.outcome||'處理中',a.elapsed_ms==null?'未提供':a.elapsed_ms+' ms',a.total_tokens??'未知'].map(s=>el('td',{class:'p-3'},s)))));
}
export function bindAudit(layout,bridge,api){
 for(const b of layout.body.querySelectorAll('[data-audit-tab]'))b.onclick=()=>bridge.auditTab(b.dataset.auditTab,b);
 for(const b of layout.body.querySelectorAll('button[data-legacyclick]')){const action=b.dataset.legacyclick;if(action.includes('refreshAuditCenter'))b.onclick=()=>bridge.renderAudit();else if(action.includes('clearAiAuditLogs')){b.textContent='清除本次問答';b.onclick=()=>bridge.clearAudit();}else if(action.includes('toggleQaDiagnosticMode')){if(api.person()?.role==='owner'&&api.person()?.environment==='sandbox'){b.textContent='開啟 AI 診斷';b.onclick=()=>{if(api.person()?.role==='owner'&&api.person()?.environment==='sandbox')openDiagnostics();};}else b.remove();}}
 layout.get('auditPane_storage')?.replaceChildren(el('p',{class:'li-note'},'問答內容與 X-Ray 只留在本次登入記憶體，登出清除；伺服器保存請求狀態與用量收據。歷史紀錄保留。'));
 bridge.renderAudit();
}

let panel=null,records=[],pending={},active=null,selected=null,paint=null;
export const tracing=()=>Boolean(panel?.box.open);
const blank=()=>({rag:null,front:{},question:'等待下一個 AI 問題…',status:'待命'});
pending=blank();
export function clearDiagnostics(){panel?.close();panel=null;records=[];pending=blank();active=null;selected=null;paint=null;}
window.addEventListener('leaves:diagnostic-start',event=>{
 if(!tracing())return;
 pending={...blank(),question:String(event.detail?.question||'本次問題').slice(0,180),status:'準備知識與 SOP'};
 active=null;selected=null;paint?.();
});
window.addEventListener('leaves:rag-metrics',event=>{
 if(!tracing()||active?.x1)return;
 pending.rag=structuredClone(event.detail);
 if(active)active.rag=pending.rag;
 paint?.();
});
window.addEventListener('leaves:answer-metrics',event=>{
 if(!tracing()||active?.x1)return;
 const target=active||pending;
 if(event.detail.attempt&&active&&event.detail.attempt!==active.attempt)return;
 target.front={...target.front,...event.detail};paint?.();
});
window.addEventListener('leaves:diagnostic-fail',event=>{
 if(!tracing()||active?.x1)return;
 const target=active||pending;target.status='未完成';target.error=String(event.detail?.message||'AI 回答未完成').slice(0,180);paint?.();
});
window.addEventListener('leaves:local-diagnostic',event=>{
 if(tracing())recordAttempt(crypto.randomUUID(),1,{modelCalls:0,queries:0,events:[{ms:0,kind:'本機完成'}]},null,event.detail);
});
export function beginDiagnostic(id,attempt=1,question=''){
 if(!tracing())return;
 let record=records.find(r=>r.id===id&&r.attempt===attempt);
 if(!record){
  record={id,attempt,question:pending.question,rag:pending.rag,front:{...pending.front},status:'派送中',time:Date.now()};
  if(question)record.question=String(question).slice(0,180);
  records.unshift(record);records.length=Math.min(records.length,24);
 }
 active=record;selected=null;paint?.();
}
export function recordAttempt(id,attempt,trace,error,duration){
 if(!tracing())return;
 const previous=active;
 let record=records.find(r=>r.id===id&&r.attempt===attempt);
 if(!record){beginDiagnostic(id,attempt);record=active;}
 Object.assign(record,{trace:trace?structuredClone(trace):null,error,duration,status:error==='排隊中'?'排隊中':error?'未完成':'已完成'});
 if(!previous||previous===record)active=record;
 else active=previous;
 paint?.();
}
function x1Record(id) {
 if(!tracing()||!safeTraceId(id))return null;
 let record=records.find(r=>r.id===id&&r.x1);
 if(!record){
  record={id,attempt:1,question:'LEAVES AI x1',rag:null,front:{},status:'處理中',time:Date.now(),x1:{steps:[],dispatches:new Map()}};
  records.unshift(record);records.length=Math.min(records.length,24);
 }
 active=record;
 return record;
}
export function recordX1Step(event) {
 const step=diagnosticStep(event);
 if(!step)return;
 const r=x1Record(event.id);
 if(!r)return;
 r.x1.steps.push(step);if(r.x1.steps.length>32)r.x1.steps.shift();
 r.duration=Date.now()-r.time;r.status=stageNames[step.stage];r.error=step.code||null;
 paint?.();
}
export function recordX1Dispatch(id,job,trace,error) {
 if(!safeTraceId(job))return;
 const r=x1Record(id);if(!r)return;
 const dispatches=r.x1.dispatches,safe=safeGatewayTrace(trace);
 if(safe)dispatches.set(job,safe);
 if(dispatches.size>12)dispatches.delete(dispatches.keys().next().value);
 const history=[...dispatches.values()];
 const total=key=>history.length&&history.every(x=>typeof x[key]==='number')?history.reduce((n,x)=>n+x[key],0):undefined;
 r.trace={modelCalls:total('modelCalls'),queries:total('queries'),events:history.flatMap(x=>x.events).slice(-60)};
 r.duration=Date.now()-r.time;
 r.status=error==='排隊中'?'排隊中':error?'未完成':'已收到模型回覆';r.error=safeTraceCode(error)||null;
 paint?.();
}
export function forgetX1Diagnostics() {
 if(!records.some(r=>r.x1))return;
 records=records.filter(r=>!r.x1);if(active?.x1)active=null;if(selected?.x1)selected=null;paint?.();
}
const labels={matched:'符合筆數',shown:'本頁明細',page:'頁次',revision:'SOP 版本',candidates:'候選段落',injected:'送入段落',tool:'報表',periods:'期間',status:'狀態',role:'職務',person:'人員範圍',project:'限定專案',action:'查詢',model:'模型',http:'HTTP',error:'原因',duration:'查詢毫秒',headersMs:'收到標頭（毫秒）',tokens:'Token'};
const printable=value=>Array.isArray(value)?value.map(v=>v&&typeof v==='object'?[v.start,v.end].filter(Boolean).join(' ～ '):String(v)).join('、'):String(value??'未取得');
const milliseconds=value=>Number.isFinite(value)?Math.round(value)+' ms':'—';
const number=value=>Number.isFinite(value)?value.toLocaleString('zh-TW'):'—';
const translated=value=>({HIGH:'高',MEDIUM:'中',LOW:'低',YES:'可回答',NO:'無足夠依據',PROCEDURE:'流程說明',GENERAL:'一般問題',INTERNAL_ACCESS:'內部存取',NOT_FOUND:'未命中',MATCH:'符合',EXACT:'精確符合'}[value]||value||'—');
function tone(value){
 if(['已完成','HIGH','YES','MATCH','EXACT'].includes(value))return 'good';
 if(['未完成','NO','NOT_FOUND'].includes(value))return 'bad';
 if(['排隊中','LOW','MEDIUM','派送中','準備知識與 SOP'].includes(value))return 'warn';
 return '';
}
function diagnosticValues(r){
 const rag=r.rag||{},front=r.front||{},trace=r.trace,events=trace?.events||[];
 const models=events.filter(e=>e.kind==='模型回覆');
 const allKnown=models.length&&models.every(e=>Number.isSafeInteger(e.tokens));
 return [
  ['問題類型',translated(rag.intent)],['資料來源',rag.source||'—'],
  ['資料匹配度',translated(rag.match),tone(rag.match)],['資料完整度',translated(rag.coverage),tone(rag.coverage)],
  ['主題匹配',translated(rag.topic),tone(rag.topic)],['據點匹配',translated(rag.site),tone(rag.site)],
  ['欄位匹配',translated(rag.field),tone(rag.field)],['答案可回答性',translated(rag.answerability),tone(rag.answerability)],
  ['SOP 檢索輪次',number(rag.passes)],['Context 縮減',Number.isFinite(rag.savingsPct)?rag.savingsPct+'%':'—'],
  ['SOP Context（估算 Token）',number(rag.contextTokens)],['完整 SOP（估算 Token）',number(rag.fullTokens)],
  ['RAG 檢索耗時',milliseconds(rag.ragMs)],['畫面首段內容時間',milliseconds(front.uiFirstContentMs)],
  ['本次派送耗時',milliseconds(r.duration)],['畫面完成耗時',milliseconds(front.renderMs)],
  ['模型呼叫次數',number(trace?.modelCalls)],['資料查詢次數',number(trace?.queries)],
  ['模型回報 Token',allKnown?number(models.reduce((sum,e)=>sum+e.tokens,0)):'—'],
  ['回答模型',front.model||models.at(-1)?.model||'—']
 ];
}
function makeSection(title,headers){
 const wrapper=table(headers,[]),body=wrapper.querySelector('tbody');
 return {node:el('section',{class:'le-diag-section'},el('h3',{},title),wrapper),body,headers};
}
function fill(section,rows,empty){
 section.body.replaceChildren(...(rows.length?rows.map(row=>el('tr',{},row.map(value=>el('td',{},value)))):[el('tr',{},el('td',{colSpan:section.headers.length,class:'le-diag-empty'},empty))]));
}
export function openDiagnostics(){
 if(tracing()){panel.box.focus();return;}
 const d=dialog('AI 對話診斷',{modal:false,width:940,height:740,close:()=>{if(panel===d){panel=null;records=[];pending=blank();active=null;selected=null;paint=null;}}});
 panel=d;d.box.classList.add('le-diagnostics');window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 const style=el('style',{},`
 .le-diagnostics{color:#ddd;font:14px/1.65 system-ui,"Microsoft JhengHei",sans-serif;background:#141414;container-type:inline-size;backdrop-filter:none!important}
 .le-diagnostics>.li-dialog-body{padding:20px 24px!important;overflow:auto;min-height:0}
 .le-diagnostics>header h2{font-size:18px!important;font-weight:600!important}
 .le-diag-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
 .le-diag-toolbar button,.le-diag-toolbar select{font:inherit!important;padding:7px 12px!important;border:1px solid #3b3b3b!important;border-radius:8px!important;background:#232323!important;color:#ddd!important}
 .le-diag-toolbar label{display:flex;gap:8px;align-items:center;margin-right:auto;min-width:0}
 .le-diag-toolbar select{max-width:280px}
 .le-diag-state{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:#aaa;margin:0 0 12px}
 .le-diag-status{font-weight:600;font-size:14px}.le-diag-status::before{content:'●';margin-right:7px;font-size:10px}.le-diag-error{color:#e3a09c;font-size:13px;overflow-wrap:anywhere;margin:0 0 12px}
 .le-diag-question{padding:13px 15px;background:#1e1e1e;border:1px solid #363636;border-radius:10px;margin-bottom:16px;overflow-wrap:anywhere;white-space:pre-wrap}
 .le-diag-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #363636;border-radius:10px;overflow:hidden;background:#363636;gap:1px}
 .le-diag-cell{background:#1a1a1a;padding:12px 14px;min-width:0}
 .le-diag-label{display:block;color:#a8a8a8;font-size:12px;margin-bottom:5px}
 .le-diag-value{display:block;color:#e5e5e5;font-size:15px;font-weight:550;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
 .le-diagnostics .good{color:#a7d6b4}.le-diagnostics .warn{color:#e4c78e}.le-diagnostics .bad{color:#e3a09c}
 .le-diag-section{margin-top:22px}.le-diag-section h3{font-size:14px;font-weight:600;margin:0 0 10px;color:#ddd}
 .le-diag-section .li-table-wrap{border:1px solid #363636!important;border-radius:9px!important;overflow:auto}
 .le-diag-section table{table-layout:fixed;width:100%;border-collapse:collapse}
 .le-diag-section th{background:#232323;color:#aaa;font-weight:500;text-align:left}
 .le-diag-section th,.le-diag-section td{padding:9px 12px!important;font-size:13px!important;line-height:1.6!important;border-bottom:1px solid #303030;white-space:normal!important;overflow-wrap:anywhere;vertical-align:top}
 .le-diag-section tbody tr:last-child td{border-bottom:0}
 .le-diag-section .le-diag-empty{color:#888;height:44px;vertical-align:middle}
 .le-diag-id{font:12px/1.6 ui-monospace,monospace;color:#999;margin-top:12px;overflow-wrap:anywhere}
 .le-diag-note{color:#929292;font-size:12px;margin:16px 0 0}
 @container(max-width:700px){.le-diag-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
 @media(max-width:700px){.le-diag-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.le-diagnostics>.li-dialog-body{padding:14px!important}.le-diag-toolbar label{flex-wrap:wrap}}
 `);
 const history=el('select',{'aria-label':'選擇診斷紀錄'});
 history.addEventListener('change',()=>{selected=records.find(r=>r.id+'|'+r.attempt===history.value)||null;paint();});
 const status=el('span',{class:'le-diag-status'}),count=el('span'),question=el('div',{class:'le-diag-question'});
 const problem=el('p',{class:'le-diag-error',hidden:true});
 const grid=el('div',{class:'le-diag-grid'}),tracking=el('div',{class:'le-diag-id'});
 const cells=diagnosticValues(pending).map(([label])=>{const value=el('span',{class:'le-diag-value'},'—');grid.append(el('div',{class:'le-diag-cell'},el('span',{class:'le-diag-label'},label),value));return value;});
 const sections=makeSection('命中 SOP 章節',['順序','章節']);
 const source=makeSection('來源與查詢條件',['階段','條件與結果']);
 const dispatch=makeSection('模型派送與排隊紀錄',['經過時間','階段','模型','狀態與耗時']);
 const candidates=makeSection('候選模型排序',['順位','模型','評分／選擇理由']);
 const notes=el('p',{class:'le-diag-note'},'「—」表示尚未觀測或服務未提供。匹配度是檢索指標。本次紀錄保留最近 24 次派送，關閉或登出後清除。');
 const copy=button('複製診斷摘要',async()=>{
  const r=selected||active||pending;
  const lines=['AI 對話診斷',r.status,r.error||'','追蹤編號 '+(r.id||'—'),...diagnosticValues(r).map(([label,value])=>label+'　'+value)];
  for(const s of [sections,source,dispatch,candidates])lines.push(s.node.innerText);
  try{await navigator.clipboard.writeText(lines.join('\n'));d.status.textContent='已複製診斷摘要';}catch{d.status.textContent='瀏覽器未允許複製，請直接選取表格文字。';}
 });
 const clear=button('清除紀錄',()=>{records=[];pending=blank();active=null;selected=null;d.status.textContent='已清除本次診斷';paint();});
 d.content.append(style,el('div',{class:'le-diag-toolbar'},el('label',{},'檢視',history),copy,clear),el('div',{class:'le-diag-state'},status,count),problem,question,grid,tracking,sections.node,source.node,dispatch.node,candidates.node,notes);
 paint=()=>{
  const r=selected||active||pending,events=r.trace?.events||[];
  const options=[['','追蹤目前問題'],...records.map(x=>[x.id+'|'+x.attempt,new Date(x.time).toLocaleTimeString('zh-TW')+' · 第 '+x.attempt+' 次 · '+x.status])];
  const signature=JSON.stringify(options);
  if(history.dataset.options!==signature){history.replaceChildren(...options.map(([value,text])=>el('option',{value},text)));history.dataset.options=signature;}
  history.value=selected?selected.id+'|'+selected.attempt:'';
  status.textContent=r.status;status.className='le-diag-status '+tone(r.status);
  problem.hidden=!r.error;problem.textContent=r.error==='排隊中'?'正在等待可用服務，紀錄將持續更新。':r.error||'';
  count.textContent='沙盒 · 最高管理員 · '+records.length+' / 24 次派送';
  question.textContent=r.question;tracking.textContent='追蹤編號 '+(r.id||'—')+(r.attempt?' · 第 '+r.attempt+' 次派送':'');
  diagnosticValues(r).forEach(([,value,color],i)=>{cells[i].textContent=value;cells[i].className='le-diag-value '+(color||'');});
  fill(sections,(r.rag?.sections||[]).map((s,i)=>[i+1,s]),r.rag?'本次沒有命中章節':'等待 SOP 檢索');
  const sourceKinds=['伺服器 SOP','報表條件','資料查詢'];
  const stepLabels={engineVersion:'引擎版本',revision:'設定版本',offset:'略過項數',items:'項目數',sourceCount:'引用數',sopRevision:'SOP 版本',projects:'專案數',changes:'變更格數',selectedIndex:'選取項次',sourceLines:'原文行號',code:'狀態碼'};
  const steps=(r.x1?.steps||[]).map(step=>['x1 · '+stageNames[step.stage],Object.entries(step).filter(([key,value])=>stepLabels[key]&&value!==undefined).map(([key,value])=>stepLabels[key]+' '+value).join(' · ')||'—']);
  fill(source,[...steps,...events.filter(e=>sourceKinds.includes(e.kind)).map(e=>[e.kind,Object.entries(e).filter(([k])=>labels[k]).map(([k,v])=>labels[k]+' '+printable(v)).join(' · ')])],'等待資料查詢紀錄');
  fill(dispatch,events.filter(e=>!sourceKinds.includes(e.kind)).map(e=>[milliseconds(e.ms),e.kind,e.model||'—',el('span',{class:e.error||e.http>=400?'bad':''},[e.http!=null?'HTTP '+e.http:'',e.error,e.headersMs!=null?'標頭 '+milliseconds(e.headersMs):'',e.tokens!=null?'Token '+e.tokens:''].filter(Boolean).join(' · ')||'—')]),'等待模型派送');
  fill(candidates,[],'伺服器尚未提供候選排序與評分，實際呼叫模型可查看上方派送紀錄。');
 };
 paint();
}
