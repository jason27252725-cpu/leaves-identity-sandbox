import {el,button,dialog,busy,select,table} from '../shared/dom.mjs';
import {readExcel,parseSheet} from './excel-reader.mjs';
const showMinutes=v=>v==null?'待確認':(v/60).toLocaleString('zh-TW',{maximumFractionDigits:3})+' h';
export async function openReportImport(api,file,onSaved=()=>{},context={}){
 const d=dialog('Excel 報表匯入'),actor=api.person()?.employeeId,epoch=api.epoch?.();
 const check=()=>{if(!d.box.isConnected||actor!==api.person()?.employeeId||epoch!==api.epoch?.())throw Error('工作階段已變更，請重新比對。');};
 const fileInput=el('input',{type:'file',accept:'.xlsx'}),pane=el('div');
 d.content.append(el('label',{class:'li-field'},'選擇月報或結算表',fileInput),pane);
 let seq=0;
 async function load(f){
  const at=++seq;pane.replaceChildren();d.status.textContent='正在讀取工作表…';
  try{
   const book=await readExcel(f);check();if(at!==seq)return;
   const detailSheets=book.sheets.filter(s=>s.name==='工時明細'&&s.get('A1')==='固定 ID');
   let recognized=(detailSheets.length?detailSheets:book.sheets).map(sheet=>{
    try{return {sheet,data:parseSheet(sheet)};}
    catch(e){return {sheet,data:{kind:'invalid',rows:[],issues:[e.message]}};}
   }).filter(x=>x.data&&(x.data.rows.length||x.data.issues.length));
   if(recognized.some(x=>x.data.kind==='import'))recognized=recognized.filter(x=>!x.data.legacyMonth);
   const layouts=recognized.filter(x=>x.data.kind==='balance');
   for(let i=0;i<layouts.length;i++){
    const other=layouts.slice(0,i).find(y=>JSON.stringify(y.data.rows)===JSON.stringify(layouts[i].data.rows));
    if(other)layouts[i].data.issues.push('此頁明細與「'+other.sheet.name+'」重複。請選擇原始工作表。');
   }
   if(recognized.length>1&&recognized.every(x=>/^結算表\d+$/.test(x.sheet.name)&&['balance','invalid'].includes(x.data.kind))){
    const all=recognized.flatMap(x=>x.data.rows);
    recognized.unshift({sheet:{name:'整份結算表（所有分頁）'},data:{kind:'balance',rows:all,issues:recognized.flatMap(x=>x.data.issues)}});
   }
   if(!recognized.length)throw Error('找不到可比對的工時明細或結算表。僅有每週合計的舊月報需提供工時明細或結算來源。');
   const picker=select('來源工作表',recognized.map((x,i)=>[String(i),x.sheet.name+' · '+x.data.rows.length+' 筆']),'0');
   const diff=el('div');let generation=0;
   const preview=async()=>{
    const ticket=++generation;diff.replaceChildren();const data=recognized[Number(picker.input.value)].data;
    const valid=()=>{check();if(ticket!==generation||at!==seq)throw Error('來源已切換');};
    const payload={...data,source:book.source};delete payload.issues;delete payload.kind;delete payload.legacyMonth;
    if(data.issues.length){
     diff.append(...data.issues.map(x=>el('p',{class:'li-status'},x)));d.status.textContent='這張工作表有待核對項目，請更正後再匯入。';return;
    }
    if(data.legacyMonth){
     const assigned=(await api.progress('projects.list',{assignedOnly:true})).projects;valid();
     payload.rows=data.rows.map(row=>{const matches=assigned.filter(p=>p.name===row.projectName);
      return {...row,code:row.code||(matches.length===1?matches[0].legacy_code:'')};});
    }
    if(data.kind==='import')diff.append(el('p',{class:'li-note'},'本次以「工時明細」逐筆比對。請將 Excel 中要匯入的新增或更正填在這張工作表。'));
    d.status.textContent='依目前身分核對中…';
    if(data.kind==='import'&&(actor!==data.employeeId||api.person().name!==data.name))throw Error('此檔案的姓名或固定 ID 與登入人員不符。');
    const result=await api.progress(data.kind+'.preview',payload);valid();
    const counts=result.rows.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
    const warnings=[];
    if(context.employeeId&&(data.employeeId?context.employeeId!==data.employeeId:result.rows.some(x=>!x.employeeId||x.employeeId!==context.employeeId)))warnings.push('請核對檔案人員與畫面所選人員');
    if(context.month&&data.rows.some(x=>(x.date||x.start)?.slice(0,7)!==context.month.slice(0,7)||x.period==='year'||x.period==='lifetime'))warnings.push('資料超出目前月份');
    if(context.year&&data.rows.some(x=>(x.date||x.start)?.slice(0,4)!==String(context.year)||x.period==='lifetime'))warnings.push('資料超出目前年度');
    if(context.projectCode&&data.rows.some(x=>(x.code||'')!==context.projectCode&&(!context.projectId||x.projectId!==context.projectId)))warnings.push('請核對檔案案件與畫面所選案件');
    const accept=el('input',{type:'checkbox'});if(warnings.length)diff.append(el('label',{},accept,' '+warnings.join('、')+'。我已核對以下逐筆範圍。'));
    const blocked=data.issues.length||result.rows.some(r=>!['新增','修改','相同'].includes(r.status));
    const summary=Object.entries(counts).map(([k,n])=>k+' '+n+' 筆').join('、');
    diff.append(el('p',{},summary),...data.issues.map(x=>el('p',{class:'li-status'},x)),table(['狀態','人員／期間','案件／工作內容','原值','Excel 值'],result.rows.map((r,i)=>{
     const a=data.rows[i];return [r.status,r.after?a.date:(a.name+' · '+(a.period==='lifetime'?'所有年度':a.start)),r.after?a.projectName+' · '+a.description:a.code+' '+a.projectName,
     r.after?(r.before?[r.before.business,r.before.workType,r.before.description,'預 '+showMinutes(r.before.plannedMinutes),'實 '+showMinutes(r.before.actualMinutes)].join(' · '):'—'):([r.before==null?'尚未採用':showMinutes(r.before),...(r.history||[]).map(h=>'歷史 '+h.sheet+' · '+showMinutes(h.minutes))].join(' ／ ')),
     r.after?[a.business,a.workType,'預 '+showMinutes(a.plannedMinutes),'實 '+showMinutes(a.actualMinutes)].join(' · '):showMinutes(a.minutes)];})));
    const confirm=button('確認匯入',()=>busy(confirm,d.status,async()=>{
     valid();if(warnings.length&&!accept.checked)throw Error('請先核對檔案與報表範圍。');try{await api.progress(data.kind+'.save',{...payload,signature:result.signature,confirm:'IMPORT'},true);}
     catch(e){confirm.dataset.locked='true';throw e;}
     valid();confirm.dataset.locked='true';d.status.textContent='已完成匯入。';await onSaved();window.dispatchEvent(new CustomEvent('leaves:report-imported',{detail:{employeeId:actor}}));diff.replaceChildren(el('p',{},'已匯入 · '+summary));
     if(data.kind==='import'&&api.openDaily){diff.append(el('p',{},'可逐日查看保存及團隊提交狀態。'),...[...new Set(data.rows.map(x=>x.date))].sort().map(day=>button(day,()=>{d.close();api.openDaily({date:day});})));}
    }),'li-primary');confirm.disabled=!!blocked||!result.rows.some(r=>['新增','修改'].includes(r.status));
    diff.append(confirm);
    if(api.can('ai.use')){
     const analysis=el('p',{class:'li-note'}),ask=button('請 AI 說明差異',()=>busy(ask,d.status,async()=>{
      valid();const reply=await api.chat('請依以下這次 Excel 匯入核對結果，用繁體中文說明會改動哪些資料、哪些需要人工確認。'+JSON.stringify({summary,issues:data.issues,changes:result.rows.slice(0,40).map((r,i)=>({status:r.status,cell:data.rows[i].cell,from:r.after?r.before?.actualMinutes:r.before,to:r.after?r.after.actualMinutes:data.rows[i].minutes}))}));valid();analysis.textContent=reply.text;
     }));diff.append(ask,analysis);
    }
    d.status.textContent=blocked?'有待核對項目，請修正來源或人員／案件對應後重新比對。':'核對完成。';
   };
   const run=()=>{const ticket=generation+1;return preview().catch(e=>{if(at===seq&&ticket===generation&&d.box.isConnected)d.status.textContent=e.message;});};
   picker.input.onchange=run;pane.append(picker.node,button('重新比對',run),diff);await run();
  }catch(e){if(at===seq&&d.box.isConnected)d.status.textContent=e.message;}
 }
 fileInput.onchange=()=>{if(fileInput.files[0])load(fileInput.files[0]);};
 if(file)await load(file);
 return d;
}
export function openBalanceEditor(api,record,onSaved){
 const creating=record.revision===0;const d=dialog(creating?'補登結算來源':'更正結算來源'),value=el('input',{type:'number',min:0,step:'any',value:creating?'':record.minutes/60}),reason=el('input',{type:'text',maxLength:200});
 const line=el('div');d.content.append(el('p',{},record.name+' · '+record.projectName+' · '+record.start+' 至 '+record.end),
  el('label',{class:'li-field'},'更正後小時',value),el('label',{class:'li-field'},'更正原因',reason),line);
 let seq=0;const invalidate=()=>{seq++;line.replaceChildren();};value.oninput=reason.oninput=invalidate;
 const compare=button('核對更正',()=>busy(compare,d.status,async()=>{
  invalidate();const generation=seq;const note=reason.value.trim(),minutes=Number(value.value)*60;
  if(!note||value.value===''||!Number.isSafeInteger(Math.round(minutes))||Math.abs(minutes-Math.round(minutes))>1e-8||minutes<0)throw Error('請核對時數並填寫更正原因。');
  const data={rows:[{employeeCode:record.employeeCode,name:record.name,business:record.business,code:record.legacyCode,projectName:record.projectName,period:record.period,start:record.start,end:record.end,minutes:Math.round(minutes),reason:note}],source:record.source};
  const r=await api.progress('balance.preview',data);if(generation!==seq||!d.box.isConnected)return;
  if(r.rows[0].revision!==record.revision)throw Error('資料已有更新，請重新查詢。');
  if(r.rows[0].status!==(creating?'新增':'修改'))throw Error(r.rows[0].status);
  const confirm=button('確認更正',()=>busy(confirm,d.status,async()=>{
   if(generation!==seq)return;try{await api.progress('balance.save',{...data,signature:r.signature,confirm:'IMPORT'},true);}
   catch(e){confirm.dataset.locked='true';throw e;}d.close();await onSaved();
  }),'li-primary');line.append(el('p',{},(creating?'尚無來源':showMinutes(r.rows[0].before))+' → '+showMinutes(minutes)),confirm);
 }));d.content.append(compare);
}
