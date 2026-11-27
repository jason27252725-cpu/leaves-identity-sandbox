import {openReportImport,openBalanceEditor} from './report-import.mjs';
import {settlementDocument} from './settlement.mjs';
import {mountCompanyPreview} from './company-preview.mjs';
import {companyWorkbook} from './company-form.mjs';
import {buildMonthly,monthlyWorkbook,styles,unrecordedWorkdays} from './monthly.mjs';
import {mountLeaves} from './monthly.mjs';
import {mountHistory} from './history.mjs';
import {mountReportQuestion} from './report-ai.mjs';
import {el,button,field,select,table,dialog,busy,errorText,localDate,hours} from './shared/dom.mjs';
import {workTimes,hoursToMinutes,hoursInputValue,hourDraftValues,periodStart,summarizeReport,reportCSV} from './model.mjs';
import {reportWorkbook} from './xlsx.mjs';
import {businessOptions as business,workFields} from './work-fields.mjs';
import {openProjectCatalog,openProjectMilestones,openReportNote} from './work-admin.mjs';
function download(name,blob){const url=URL.createObjectURL(blob),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function mountWorkforce(root,api){let disposed=false,epoch=0,tab='daily',staff=[],selected=api.person().employeeId;const status=el('p',{class:'li-status','aria-live':'polite'}),body=el('div'),tabs=el('div',{class:'li-tabs',role:'tablist'}),person=select('查閱人員',[[selected,api.person().name]],selected),date=field('日期','date',localDate());
 const settlementView={kind:null,state:{}};
 const reportFilter={scope:'employee',year:date.input.value.slice(0,4),period:'year',projectId:'',queried:false};
 let returnReport=null;
 async function navigate(route){
  if(!['daily','monthly','month','reports'].includes(route.tab))return;
  if(route.own!==false){selected=api.person().employeeId;person.input.value=selected;}
  if(route.date)date.input.value=route.date;
  tab=route.tab;await load();
 }
 const check=at=>{if(disposed||at!==epoch)throw Object.assign(Error('畫面已切換'),{code:'STALE_SESSION'});};
 const progress=(action,payload={},write=false)=>api.progress(action,{employeeId:selected,...payload},write);
 const read=async(action,payload,at)=>{const r=await progress(action,payload);check(at);return r;};
 const toolsMenu=el('details',{},el('summary',{},'更多功能'));
 for(const [key,label] of [['daily','每日工作'],['monthly','月報彙整'],['reports','年度／專案報表'],['month','出勤與月結'],['plans','週／月計畫'],...(api.person().permissions['reports.export']==='company'?[['history','歷史來源報表']]:[])]){
  if(key==='reports'&&!api.can('reports.export'))continue;
  const b=button(label,()=>{tab=key;load();});b.dataset.tab=key;
  (['plans','history'].includes(key)?toolsMenu:tabs).append(b);
 }
 tabs.append(toolsMenu);

 const createProject=button('專案管理',()=>openProjectCatalog(api,staff,load));
 createProject.hidden=!api.can('project.manage')&&!api.can('project.create');
 const sync=button('重新讀取',()=>load()),previewState={};
 person.input.addEventListener('change',()=>{selected=person.input.value;load();});
 date.input.addEventListener('change',()=>{reportFilter.year=date.input.value.slice(0,4);load();});

 root.replaceChildren(el('div',{class:'li-eyebrow'},'WORK & REPORTS'),el('h1',{},'進度與工時'),el('p',{class:'li-note'},'計畫與實際分開記錄。核定報表採用已確認的月結版本，保留離職同仁的歷史貢獻。'),el('div',{class:'li-toolbar'},person.node,date.node,sync,createProject),tabs,status,body);
 async function load(){const at=++epoch;body.replaceChildren();date.node.hidden=tab==='reports';status.textContent='讀取中…';for(const b of tabs.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===tab));try{if(!date.input.value)throw Error('請選擇日期');if(returnReport&&tab==='monthly')body.append(button('返回剛才的工時查詢',()=>{const old=returnReport;returnReport=null;selected=old.person;person.input.value=selected;date.input.value=old.date;tab='reports';load();}));if(tab==='daily')await daily(at);if(tab==='monthly')await monthly(at);if(tab==='plans')await plans(at);if(tab==='month')await month(at);if(tab==='reports')await reports(at);if(tab==='history')await mountHistory(body,api,()=>check(at));check(at);status.textContent='已同步';}catch(e){if(!disposed&&at===epoch)status.textContent=errorText(e);}}
 async function daily(at){const [review,projects]=await Promise.all([read('day.view',{date:date.input.value},at),read('projects.list',{assignedOnly:true},at)]);const entries=review.entries.filter(e=>e.work_date===date.input.value),isOwn=selected===api.person().employeeId;
 body.append(el('div',{class:'li-kpis'},el('div',{class:'li-kpi'},'當日已填實際',el('strong',{},entries.length&&entries.every(e=>e.actual_minutes===null)?'待確認':hours(entries.reduce((n,e)=>n+(e.actual_minutes||0),0))+' 小時')),el('div',{class:'li-kpi'},'待確認',el('strong',{},entries.filter(e=>e.actual_minutes===null).length+' 筆')),el('div',{class:'li-kpi'},'月結',el('strong',{},review.closed?'已核定':'未核定'))));
 body.append(el('p',{class:'li-note'},'已保存 '+entries.length+' 筆 · '+(review.submittedAt?'團隊已提交':review.workflowRevision>=37?'團隊尚未提交':'請至團隊進度確認提交狀態')));
 const edit=e=>entryForm(e,projects.projects,review.closed,{style:review.reportStyle});const create=button('新增每日工作',()=>edit(null),'li-primary');create.disabled=!isOwn||!api.can('progress.edit')||review.closed;body.append(el('div',{class:'li-actions'},create),table(['工作','分類／專案','預計小時','實際小時','操作'],entries.map(e=>[el('div',{},e.work_type,el('div',{class:'li-note'},e.description)),(business.find(b=>b[0]===e.business)?.[1]||e.business)+' / '+(projects.projects.find(p=>p.project_id===e.project_id)?.name||(e.project_id?'既有專案':'公司內部')),hours(e.planned_minutes),hours(e.actual_minutes),button('查看／編輯',()=>edit(e))])));
 const leaves=el('section');body.append(leaves);mountLeaves(leaves,api,{date:date.input.value,employeeId:selected,data:review,reload:load});
 }
 function entryForm(entry,projects,locked,defaults={}){
  const employee=selected,actor=api.person().employeeId;
  const writable=!locked&&employee===actor&&api.can('progress.edit');
  if(writable&&api.openDaily){
   if(entry)return api.openDaily({date:entry.work_date,entryId:entry.id});
   if(defaults.minDate&&defaults.maxDate){
    const picker=dialog('選擇補填日期'),max=defaults.maxDate<localDate()?defaults.maxDate:localDate();
    const day=field('工作日期','date',defaults.date||defaults.minDate,{min:defaults.minDate,max});
    const go=button('開啟每日填寫',()=>busy(go,picker.status,async()=>{
     if(!day.input.value||day.input.value<defaults.minDate||day.input.value>max)throw Error('請選此週內已到的日期。');
     picker.close();await api.openDaily({date:day.input.value,newEntry:defaults});
    }));picker.content.append(day.node,go);return;
   }
   return api.openDaily({date:defaults.date||date.input.value,newEntry:{}});
  }
  const d=dialog(entry?(writable?'編輯每日工作':'查看每日工作'):'新增每日工作');
  let id=entry?.id||crypto.randomUUID(),expected=entry?.revision||0;
  const min=defaults.minDate||'',max=defaults.maxDate&&defaults.maxDate<localDate()?defaults.maxDate:localDate();
  const day=field('工作日期','date',entry?.work_date||defaults.date||date.input.value,
    {min,max,disabled:!!entry||!writable,required:true});
  const draftName='entry:'+employee+':'+day.input.value+':'+(entry?.id||'new');
  const fields=workFields({entry:entry||defaults,projects,style:defaults.style,disabled:!writable,
    storageKey:(api.person().environment||location.pathname.split('/')[1])+':'+actor,onChange:saveDraft});
  const planned=field('預計小時','number',hoursInputValue(entry?.planned_minutes??0),{min:0,max:24,step:'any',disabled:!writable});
  const actual=field('實際小時（空白待確認）','number',hoursInputValue(entry?.actual_minutes),{min:0,max:24,step:'any',disabled:!writable});
  const form=el('form',{},day.node,fields.search,fields.header,fields.hint,
    el('div',{class:'li-grid'},fields.description.node,planned.node,actual.node),fields.details);
  const save=el('button',{type:'submit',class:'li-primary',disabled:!writable},'保存每日工作');
  const collect=()=>({id,date:day.input.value,expectedRevision:expected,timeUnit:'hours',work:fields.values(),planned:planned.input.value,actual:actual.input.value});
  function saveDraft(){if(writable)api.drafts.save(draftName,collect()).catch(e=>d.status.textContent=errorText(e));}
  for(const f of [day,planned,actual])f.input.oninput=saveDraft;
  const restore=button('恢復本機草稿',()=>busy(restore,d.status,async()=>{
    const v=await api.drafts.load(draftName);
    if(!v)throw Error('沒有可恢復的草稿');
    if(v.expectedRevision!==expected)throw Error('草稿基準版本已不同，請先核對伺服器資料。');
    if(!entry){id=v.id;if(v.date&&v.date>=min&&v.date<=max)day.input.value=v.date;}
    if(v.work){fields.restore(v.work);planned.input.value=v.planned;actual.input.value=v.actual;}
    else{
      const [projectId,business,workType,description,p,a]=hourDraftValues(v,[4,5]);
      fields.restore({projectId,business,workType,description});planned.input.value=p;actual.input.value=a;
    }
    d.status.textContent='已恢復，尚未保存';
  }));
  const recheck=button('核對伺服器版本',()=>busy(recheck,d.status,async()=>{
    const r=await api.progress('day.view',{employeeId:employee,date:day.input.value});
    const current=r.entries.find(e=>e.id===id);
    d.content.querySelector('.li-entry-check')?.remove();
    const review=el('div',{class:'li-entry-check'},current?table(['版本','內容','已存實際小時'],[[current.revision,current.description,hours(current.actual_minutes)]]):'伺服器尚無此筆紀錄。');
    review.append(button('使用此基準繼續編輯',()=>{expected=current?.revision||0;save.dataset.locked='false';save.disabled=!writable||r.closed;review.remove();saveDraft();}));
    d.content.append(review);
  }));
  form.addEventListener('submit',e=>{
    e.preventDefault();
    busy(save,d.status,async()=>{
      if(!day.input.value||day.input.value<min||day.input.value>max)throw Error('請在所選週與月份內選擇今天或之前的日期。');
      const payload={id,date:day.input.value,employeeId:employee,expectedRevision:expected,...fields.payload(),
        ...workTimes(planned.input.value,actual.input.value)};
      await api.drafts.save(draftName,collect());
      try{
        await api.progress('entry.save',payload,true);
        api.drafts.remove(draftName);
        d.close();
        window.dispatchEvent(new CustomEvent('leaves:daily-saved',{detail:{date:payload.date,employeeId:employee}}));
      }catch(err){
        if(err.verificationRequired||err.code==='REVISION_CONFLICT'){save.dataset.locked='true';save.disabled=true;}
        throw err;
      }
    });
  });
  form.append(el('div',{class:'li-actions'},...(writable?[save,restore,recheck]:[])));
  d.content.append(el('p',{class:'li-note'},locked?'此月已核定，僅供查看。':'保存後同步更新每日工作及月報。'),form);
 }
 async function plans(at){const kind=select('計畫期間',[['week','週計畫'],['month','月計畫']],'week'),panel=el('div');body.append(kind.node,panel);let loadSeq=0;
 async function view(){const request=++loadSeq;const k=kind.input.value,start=periodStart(date.input.value,k),data=await read('plans.view',{periodKind:k,periodStart:start},at);if(request!==loadSeq)return;panel.replaceChildren(el('p',{class:'li-note'},start+' 起；週／月計畫不會新增每日實際工時。'),table(['專案／工作','期間預計','每日預計','實際工時','已核定工時'],data.groups.map(g=>[g.projectName+' / '+g.workType,hours(g.periodPlannedMinutes),hours(g.dailyPlannedMinutes),hours(g.actualMinutes),hours(g.approvedMinutes)])));
 const edit=p=>{if(selected!==api.person().employeeId||!api.can('progress.edit')||data.lockedMonths.length)throw Error('此計畫目前僅能查看');const d=dialog(p?'編輯計畫':'新增計畫'),target=selected;let id=p?.id||crypto.randomUUID(),mutationId=crypto.randomUUID();const project=select('專案',[['','內部事務'],...data.projects.filter(x=>x.canPlan||x.projectId===p?.project_id).map(x=>[x.projectId,x.name])],p?.project_id||''),b=select('業務',business,p?.business||'internal'),type=field('工作類型','text',p?.work_type||'',{required:true,maxLength:100}),desc=field('計畫內容','text',p?.description||'',{required:true,maxLength:2000}),time=field('預計小時','number',hoursInputValue(p?.planned_minutes??0),{min:0,max:k==='week'?168:744,step:'any'}),withdraw=select('狀態',[['false','有效'],['true','撤回']],String(p?.withdrawn||false));const form=el('form',{},el('div',{class:'li-grid'},project.node,b.node,type.node,desc.node,time.node,withdraw.node)),save=el('button',{type:'submit',class:'li-primary'},'保存計畫');const planFields=[project,b,type,desc,time,withdraw],draftName='plan:'+target+':'+k+':'+start+':'+(p?.id||'new'),collect=()=>({id,mutationId,revision:p?.revision||0,timeUnit:'hours',values:planFields.map(f=>f.input.value)});const restore=button('恢復本機草稿',()=>busy(restore,d.status,async()=>{const value=await api.drafts.load(draftName);if(!value){d.status.textContent='沒有可恢復草稿';return;}if(value.revision!==(p?.revision||0))throw Error('草稿基準已變更，請先核對最新計畫');id=value.id;mutationId=value.mutationId;const values=hourDraftValues(value,[4]);planFields.forEach((f,i)=>f.input.value=values[i]);d.status.textContent='草稿已恢復，尚未保存';}));form.append(save,restore);form.addEventListener('submit',e=>{e.preventDefault();busy(save,d.status,async()=>{const payload={id,employeeId:target,periodKind:k,periodStart:start,projectId:project.input.value||null,business:b.input.value,workType:type.input.value.trim(),description:desc.input.value.trim(),plannedMinutes:hoursToMinutes(time.input.value,{max:k==='week'?168:744}),withdrawn:withdraw.input.value==='true',expectedRevision:p?.revision||0,mutationId};if((payload.business==='internal')!==(payload.projectId===null))throw Error('業務分類與專案選擇不符');await api.drafts.save(draftName,collect());try{await api.progress('plans.save',payload,true);api.drafts.remove(draftName);d.close();await view();}catch(e){if(e.verificationRequired){save.textContent='核對狀態後再重試（同一請求）';}throw e;}});});form.addEventListener('input',()=>{mutationId=crypto.randomUUID();api.drafts.save(draftName,collect()).catch(e=>d.status.textContent=errorText(e));});d.content.append(form);};
 const add=button('新增計畫',()=>edit(null),'li-primary');add.disabled=selected!==api.person().employeeId||!api.can('progress.edit')||data.lockedMonths.length>0;panel.append(add,table(['工作','預計小時','狀態','操作'],data.plans.map(p=>[p.work_type+' / '+p.description,hours(p.planned_minutes),p.withdrawn?'已撤回':'有效',el('button',{type:'button',disabled:selected!==api.person().employeeId||!api.can('progress.edit')||data.lockedMonths.length>0,onclick:()=>edit(p)},'編輯')])));if(data.lockedMonths.length)panel.append(el('p',{class:'li-note'},'此期間涵蓋已核定月份，計畫已鎖定。'));}
 kind.input.addEventListener('change',()=>view().catch(e=>status.textContent=errorText(e)));await view();}
 async function month(at){const mon=periodStart(date.input.value,'month'),r=await read('month.review',{month:mon},at);
 const gaps=unrecordedWorkdays(r.reportContext?.calendar||{},r.entries,r.leaves||[],localDate());
 const openDay=day=>navigate({tab:'daily',date:day,own:false});
 if(gaps.length)body.append(el('details',{},el('summary',{},gaps.length+' 個已過工作日缺明細，請核對本月涵蓋範圍'),...gaps.map(day=>button(day,()=>openDay(day)))));
 body.append(el('h3',{},mon.slice(0,7)+' · '+(r.closed?'已核定':'待核定')),table(['日期','實際小時','出勤小時','缺少實際筆數／請假狀態'],r.issues.map(x=>[button(x.date,()=>openDay(x.date)),hours(x.actualMinutes),hours(x.attendanceMinutes),x.reason||x.missingActual])),table(['工作日期','類型','實際小時'],r.entries.map(e=>[e.work_date,e.work_type,hours(e.actual_minutes)])));
 if(api.can('attendance.manage')&&!r.closed){const day=field('出勤日期','date',date.input.value),time=field('核對後出勤小時','number','',{min:0,max:24,step:'any'}),note=field('核對來源','text','',{manualReason:true,required:true,maxLength:500});const save=button('保存出勤核對',()=>busy(save,status,async()=>{if(!note.input.value.trim())throw Error('請填寫出勤核對來源。');if(!day.input.value.startsWith(mon.slice(0,7)))throw Error('出勤日期需在目前月份');const old=r.attendance.find(a=>a.work_date===day.input.value);await progress('attendance.save',{date:day.input.value,minutes:hoursToMinutes(time.input.value),sourceNote:note.input.value,expectedRevision:old?.revision||0},true);await load();}));body.append(el('div',{class:'li-card'},el('h3',{},'出勤核對'),el('div',{class:'li-grid'},day.node,time.node,note.node),save));}
 if(api.can('month.close')&&!r.closed){const note=field('本月資料涵蓋範圍與核對說明','text','',{manualReason:true,required:true,maxLength:500}),coverage=el('input',{type:'checkbox'});const b=button('預覽月結核定',()=>{const d=dialog('核定本月工時'),scope=select('核對範圍',[['partial','部分期間'],['full','完整月份']],gaps.length||mon.slice(0,7)===localDate().slice(0,7)?'partial':'full');
 d.content.append(scope.node,el('p',{},gaps.length?'目前有 '+gaps.length+' 個已過工作日缺明細，請在說明列明本次核定日期。':'請核對班表及本次涵蓋的日期。'),el('p',{},`${mon.slice(0,7)}，${r.entries.length} 筆每日工作，${r.issues.length} 項差異。核定後鎖定本月，報表會採用這份快照。`),note.node,el('label',{},coverage,' 我已核對此月份的完整範圍'));const confirm=button('確認核定',()=>busy(confirm,d.status,async()=>{if(scope.input.value==='full'&&(gaps.length||localDate()<new Date(Date.UTC(Number(mon.slice(0,4)),Number(mon.slice(5,7)),0)).toISOString().slice(0,10)))throw Error('本月仍有未到或缺少明細的工作日，請核對後選擇部分期間。');if(!coverage.checked||!note.input.value.trim())throw Error('請確認涵蓋範圍並填寫說明');await progress('month.close',{month:mon,reviewHash:r.reviewHash,coverageConfirmed:true,coverageNote:(scope.input.value==='full'?'完整月份':'部分期間')+' · '+note.input.value.trim(),confirm:'CONFIRM_MONTH_CLOSE'},true);d.close();await load();}),'li-primary');confirm.disabled=r.issues.length>0||(r.entries.length===0&&!r.leaves?.some(l=>l.status==='approved'));d.content.append(confirm);});body.append(b);}
 if(api.can('month.reopen')&&r.closed){const b=button('撤回核定以更正',()=>{const d=dialog('撤回月結核定'),reason=field('更正原因（至少 3 字）','text','',{manualReason:true,required:true,maxLength:500});d.content.append(el('p',{},'撤回後，這個月份將暫時排除於核定報表；歷史版本保留。'),reason.node);const confirm=button('確認撤回核定',()=>busy(confirm,d.status,async()=>{if(reason.input.value.trim().length<3)throw Error('請填寫至少 3 字原因');await progress('month.reopen',{month:mon,closureId:r.closure.closureId,reason:reason.input.value,confirm:'CONFIRM_MONTH_REOPEN'},true);d.close();await load();}),'li-danger');d.content.append(confirm);});body.append(b);}
 if(api.person().permissions['attendance.manage']==='company'){const c=button('調整所選日期的公司班表',()=>busy(c,status,async()=>{const day=date.input.value,current=await read('day.view',{date:day},at),d=dialog('公司工作日曆'),time=field('正常工作小時','number',current.scheduledMinutes/60,{min:0,max:24,step:'any'}),note=field('班表說明','text','',{maxLength:500});d.content.append(el('p',{},day+'；平日預設 8h、週末 0h。國定假日、補班或其他班表請依公司資料設定。'),time.node,note.node);const save=button('保存班表',()=>busy(save,d.status,async()=>{check(at);await progress('calendar.save',{date:day,minutes:hoursToMinutes(time.input.value),note:note.input.value,expectedRevision:current.calendarRevision},true);d.close();await load();}),'li-primary');d.content.append(save);}));body.append(c);}
 body.append(el('h3',{},'月結歷史'),table(['版本','核定時間','狀態','原因'],r.history.map(h=>[h.version,h.closedAt,h.reopenedAt?'已撤回':'有效',[h.coverageNote,h.reason].filter(Boolean).join(' ／ ')])));
 }
 async function monthly(at){
 const mon=periodStart(date.input.value,'month'),data=await read('monthly.data',{month:mon},at);
 const sourceVersion=r=>JSON.stringify([r.entries,r.closed,r.closure,r.profile,r.reportProjects,r.plans,r.calendar,r.leaves,r.reportNotes,r.projectMilestones,r.reportName]);
 const originalVersion=sourceVersion(data);
 async function verifyMonth(){
  await read('report.projects',{scope:'employee'},at);
  const current=await read('monthly.data',{month:mon},at);
  if(sourceVersion(current)!==originalVersion)throw Error('這份月報的資料已更新，請重新讀取後匯出。');
 }
 const reportPerson=staff.find(p=>p.employeeId===selected)||api.person();
 const importButton=button('匯入 Excel',()=>openReportImport(api,null,undefined,{month:mon,employeeId:selected}));body.append(importButton);
 const legacy=data.importedBalances||[];
 if(legacy.length)body.append(el('section',{class:'li-card'},el('h3',{},'匯入的月結算來源'),table(['案件','期間','時數','計入狀態'],legacy.map(b=>[b.projectName,b.start,hours(b.minutes),b.overlap?'與每日明細重疊，待核對':'歷史結算']))));
 const own=selected===api.person().employeeId,writable=own&&!data.closed&&api.can('progress.edit');
 const choices=own&&!data.closed?(await read('projects.list',{assignedOnly:true},at)).projects:[];
 const byId=new Map(choices.map(p=>[p.project_id,p]));
 for(const p of data.reportProjects||[])byId.set(p.project_id,{...byId.get(p.project_id),...p});
 for(const e of data.entries)e.project_name??=byId.get(e.project_id)?.name;
 const pr={projects:[...byId.values()]};
 const style=select('本月填報版型',styles,data.profile.style),preview=el('div');
 const viewKey=selected+':'+mon;
 if(previewState.key!==viewKey)Object.assign(previewState,{key:viewKey,paperOpen:false,page:0,zoom:'fit',left:0,top:0});

 const noEntries=unrecordedWorkdays(data.calendar,data.entries,data.leaves||[],localDate());
 const expected=Object.values(data.calendar||{}).reduce((n,v)=>n+v,0);
 const coverage=noEntries.length?el('details',{},el('summary',{},'班表中有 '+noEntries.length+' 個已過工作日沒有工作明細，請假亦未涵蓋全天'),...noEntries.map(day=>button(day,()=>own&&writable&&api.openDaily?api.openDaily({date:day}):navigate({tab:'daily',date:day,own:false})))):'';
 let previewSequence=0;
 async function paint(){const seq=++previewSequence;const r=buildMonthly(data,style.input.value,pr.projects);preview.replaceChildren(coverage,data.legacyContext?el('p',{class:'li-note'},'此月在舊版核定，姓名、案名、班表及期間計畫依現有資料顯示。'):'',el('div',{class:'li-actions'},...data.entries.filter(e=>e.actual_minutes==null).map(e=>button('待補實際 · '+e.work_date+' '+e.description,()=>entryForm(e,choices,data.closed,{style:style.input.value}))),...(data.leaves||[]).filter(l=>l.status==='pending').map(l=>button('待審請假 · '+l.work_date,()=>navigate({tab:'daily',date:l.work_date,own:false})))),el('p',{class:'li-note'},(r.closed?'已核定':'工作月報草稿')+' · 實際待確認 '+r.missing+' 筆；請假獨立統計。期間預計與每日預計不相加。'),table(['週起日','日期／專案／類別','每日預計','已填實際','待確認','內容'],r.groups.map(g=>[g.week,g.label,hours(g.planned),hours(g.actual),g.missing,g.details.map(e=>button(e.work_date+' '+e.projectName+' / '+e.description+(e.actual_minutes==null?' · 待補實際':''),()=>entryForm(e,choices,data.closed,{style:style.input.value})))])),el('p',{},'每日預計 '+hours(r.planned)+'h · 已填實際 '+hours(r.actual)+'h · 已確認請假 '+hours(r.leaveTotals.approved)+'h · 待確認請假 '+hours(r.leaveTotals.pending)+'h · 扣除已確認假後本月應工作 '+hours(Math.max(0,expected-r.leaveTotals.approved))+'h'),el('h3',{},'期間計畫（獨立目標）'),table(['起日','類型','內容','期間預計'],r.plans.map(p=>[p.period_start,p.period_kind,p.description,hours(p.planned_minutes)])),el('p',{class:'li-note'},'跨月週保持完整期間目標，不編造每日分配。公司原表依選定月份及班表產生。'));
 const paper=el('section',{class:'li-month-preview'}),sheet=el('details',{},el('summary',{},'公司原表預覽與逐格編輯'),paper);
 preview.append(sheet);let rendered=false;
 async function renderPaper(){if(rendered||!sheet.open)return;rendered=true;try{
 await mountCompanyPreview(paper,data,style.input.value,pr.projects,reportPerson,{
  state:previewState,writable,
  onEntry:(entry,defaults)=>entryForm(entry,choices,data.closed,{...defaults,style:style.input.value}),
  onNote:data.workReportsRevision===1?(target,old)=>openReportNote(api,reportPerson,mon,target,old,writable,load):null,
  onMilestones:data.workReportsRevision===1?(item)=>openProjectMilestones(api,item,data.projectMilestones?.[item.projectId+':'+item.business+':'+item.installment],!data.closed&&api.can('project.manage'),load):null
 });

 }catch(e){rendered=false;paper.textContent=errorText(e);}}
 sheet.addEventListener('toggle',()=>{if(seq===previewSequence){previewState.paperOpen=sheet.open;renderPaper();}});sheet.open=!!previewState.paperOpen;
 if(seq!==previewSequence){paper.remove();return;}check(at);
 const notes=(data.reportNotes||[]).filter(n=>n.note);
 if(notes.length)preview.append(el('details',{},el('summary',{},'本月備註（'+notes.length+'）'),
   table(['位置','備註',''],notes.map(n=>[n.label,el('div',{class:'li-report-note'},n.note),
    button(writable?'編輯':'查看',()=>openReportNote(api,reportPerson,mon,n,n,writable,load))]))));

 }
 style.input.disabled=data.closed;style.input.onchange=()=>{previewState.page=0;previewState.top=0;paint().catch(e=>status.textContent=errorText(e));};
 const save=button('儲存版型並沿用至後續月份',()=>busy(save,status,async()=>{await progress('profile.save',{month:mon,style:style.input.value,expectedRevision:data.profile.revision},true);await load();}));
 save.disabled=data.closed||selected!==api.person().employeeId||!api.can('progress.edit');
 const exportButton=button('匯出公司原表',()=>busy(exportButton,status,async()=>{
  await verifyMonth();
  const person=staff.find(p=>p.employeeId===selected);
  if(!person)throw Error('請重新選取報表人員。');
  const blob=await companyWorkbook(data,style.input.value,pr.projects,person);
  check(at);download('拾葉-'+mon.slice(0,7)+'-'+(data.reportName||person.name)+'-月報.xlsx',blob);
  status.textContent='已匯出公司原表';
 }));
 const detailButton=button('匯出通用明細',()=>busy(detailButton,status,async()=>{
  await verifyMonth();
  download('LEAVES-'+mon.slice(0,7)+'-工時明細.xlsx',monthlyWorkbook(data,style.input.value,pr.projects,data.reportName||staff.find(p=>p.employeeId===selected)?.name||selected));
  status.textContent='已匯出通用明細';
 }));
 detailButton.disabled=!api.can('reports.export');
 exportButton.disabled=!api.can('reports.export');body.append(el('div',{class:'li-toolbar'},style.node,save,exportButton,detailButton),preview);await paint();}

 async function reports(at){
  if(!api.can('reports.export'))throw Object.assign(Error('無報表權限'),{code:'FORBIDDEN'});
  const allowed=api.person().permissions['reports.export'];
  const scope=select('報表範圍',[['employee','選取人員'],
   ...(['managed','company'].includes(allowed)?[['managed','所屬團隊']]:[]),
   ...(allowed==='company'?[['company','全公司']]:[])],reportFilter.scope);
  const period=select('統計期間',[['year','指定年度'],['all','跨年度']],reportFilter.period);
  const year=field('年度','number',reportFilter.year,{min:2000,max:2200});
  const project=select('專案',[['','所有專案']],'');
  year.node.hidden=period.input.value==='all';
  const output=el('div');let selection=0,projectRequest=0,projectList=[];
  async function runQuery(){
   const seq=selection;
   const criteria={scope:scope.input.value,year:period.input.value==='all'?null:Number(year.input.value),projectId:project.input.value||null};
   if(period.input.value==='year'&&(!Number.isInteger(criteria.year)||criteria.year<2000||criteria.year>2200))throw Error('請選擇有效年度。');
   if(!criteria.year&&!criteria.projectId)throw Error('跨年度查詢請先選擇案件。');
   const [r,live]=await Promise.all([read('report.export',criteria,at),read('report.preview',criteria,at)
    .catch(e=>{if(e.code==='UNKNOWN_ACTION')return null;throw e;})]);
   if(seq!==selection)return;
   const viewKey=JSON.stringify([selected,criteria]);if(settlementView.key!==viewKey)Object.assign(settlementView,{key:viewKey,kind:null,state:{}});
   reportFilter.queried=true;
   const s=summarizeReport(r);
   async function latest(){
    const fresh=await read('report.export',criteria,at);
    const signature=x=>JSON.stringify([x.rows,x.excludedMonths,x.balances,x.standardMinutes,x.scope,x.year,x.projectId]);
    if(seq!==selection||signature(r)!==signature(fresh))throw Error('資料或範圍已變更，請重新查詢後下載。');
    return fresh;
   }
   const fileButton=(label,make)=>{const b=button(label,()=>busy(b,status,async()=>make(await latest())));return b;};
   const periodLabel=criteria.year||'跨年度',filePrefix='LEAVES-'+periodLabel+'-'+(projectList.find(p=>p.project_id===criteria.projectId)?.legacy_code||criteria.scope);
   const liveRows=live?.rows||[];
   const liveHours=liveRows.reduce((t,x)=>t+(x.actualMinutes??0),0),notClosed=liveRows.reduce((t,x)=>t+x.unclosedMinutes,0);
   const missing=liveRows.reduce((t,x)=>t+x.missing,0);
   const pending=el('section',{class:'li-card'},el('h3',{},'即時填報'),live?
    el('div',{},el('p',{},'已填實際 '+hours(liveHours)+'h · 其中未核定 '+hours(notClosed)+'h · 實際待確認 '+missing+' 筆'),
     table(['人員','專案','工作階段','預計小時','已填實際','待確認筆數'],
      liveRows.map(x=>[x.name,x.projectName||(x.projectId?'既有專案':'公司內部'),business.find(b=>b[0]===x.business)?.[1],
       hours(x.plannedMinutes),hours(x.actualMinutes),x.missing]))):
    el('p',{class:'li-note'},'即時填報查詢需先更新本環境後端。'));
   const approved=el('section',{class:'li-card'},el('h3',{},'月結核定｜'+hours(s.total)+' 小時'),
    el('p',{class:'li-note'},'下載使用已核定的有效月結版本。歷史匯入請至「歷史來源報表」查看。'),
    table(['人員','專案','工作階段','小時','占本次比例'],s.rows.map(x=>[x.name,x.project,business.find(b=>b[0]===x.business)?.[1],
     hours(x.minutes),(x.ratio*100).toFixed(2)+'%'])),
    el('h3',{},'未納入核定的月份'),table(['員工','月份','狀態'],s.excluded.map(x=>[
     staff.find(p=>p.employeeId===x.employeeId)?.name||x.employeeId,x.month,x.status==='reopened'?'撤回核定':'未核定'])),
    el('div',{class:'li-actions'},
     fileButton('下載核定 Excel',fresh=>download(filePrefix+'-核定工時.xlsx',reportWorkbook(fresh))),
     fileButton('下載核定 CSV',fresh=>download(filePrefix+'-核定工時.csv',new Blob([reportCSV(fresh)],{type:'text/csv;charset=utf-8'})))));
   const forms=el('section',{class:'li-card'}),formPreview=el('div');
   const projectItem=projectList.find(p=>p.project_id===criteria.projectId)||{};
   async function showForm(kind){
    const localSeq=++formSeq;if(settlementView.kind!==kind){settlementView.kind=kind;settlementView.state={};}
    const settings={name:staff.find(x=>x.employeeId===selected)?.name,projectName:projectItem.name,legacyCode:projectItem.legacy_code,standard:r.standardMinutes};
    const noteScope=kind==='case'?{projectId:criteria.projectId}:kind==='personal'?{year:criteria.year,subjectId:selected}:null;
    if(noteScope)settings.notes=(await read('form.read',noteScope,at)).notes;
    const doc=await settlementDocument(r,kind,settings);check(at);if(localSeq!==formSeq||seq!==selection)return;
    const preview=el('div');formPreview.replaceChildren(fileButton('下載 '+doc.title+' Excel',async fresh=>{if(noteScope)settings.notes=(await read('form.read',noteScope,at)).notes;const current=await settlementDocument(fresh,kind,settings);check(at);download(filePrefix+'-'+doc.title+'.xlsx',current.download());}),preview);
    await mountCompanyPreview(preview,{entries:[],month:date.input.value},null,[],api.person(),{state:settlementView.state,documentSource:doc,onCell:target=>{
     if(target.anchor){
      const editor=dialog(target.label),canEdit=kind==='case'?api.can('project.manage'):selected===api.person().employeeId&&api.can('progress.edit');
      const input=el('textarea',{maxLength:500,rows:4,disabled:!canEdit},target.old?.content||'');editor.content.append(input);
      if(canEdit){const save=button('保存',()=>busy(save,editor.status,async()=>{await api.progress('form.save',{...noteScope,anchor:target.anchor,content:input.value,expectedRevision:target.old?.revision||0},true);editor.close();await showForm(kind);}));editor.content.append(save);}return;
     }
     const d=dialog('結算格來源');d.content.append(el('h3',{},target.label),target.records.length?table(['人員','案名','期間','時數','來源與更正'],target.records.map(item=>[item.name,item.projectName,item.period==='day'?item.start:item.start+' ～ '+item.end,hours(item.minutes),
      item.entry?button('查看核定明細',()=>{d.close();returnReport={person:selected,date:date.input.value};selected=item.employeeId;person.input.value=selected;date.input.value=item.start;tab='monthly';load();}):
      button('查看／更正結算',()=>{d.close();openBalanceEditor(api,item,load);})])):el('p',{},'此格目前沒有來源工時。'));
     if(!target.records.length&&target.defaults){
      const item=target.defaults;
      if(item.employeeId===api.person().employeeId||api.can('month.close')){
       const add=button('補登此格的結算時數',()=>busy(add,d.status,async()=>{
        const key=new TextEncoder().encode('manual-settlement:'+crypto.randomUUID());
        const source=[...new Uint8Array(await crypto.subtle.digest('SHA-256',key))].map(n=>n.toString(16).padStart(2,'0')).join('');
        d.close();openBalanceEditor(api,{...item,revision:0,source},load);
       }));d.content.append(add);
      }
     }
     if(!target.records.length)d.content.append(button('從 Excel 比對匯入',()=>{d.close();openReportImport(api,null);}));
    }});
   }
   let formSeq=0;
   const buttons=[];
   if(criteria.projectId&&!criteria.year)buttons.push(['case','跨年度專案 · A4 橫式']);
   if(criteria.year&&criteria.scope==='employee')buttons.push(['personal','個人進度結算 · A4 直式']);
   if(criteria.year&&criteria.scope==='company')buttons.push(['company','公司年度 · 原版 A3'],['a4','公司年度 · 分頁 A4']);
   forms.append(el('h3',{},'公司結算表'),el('p',{class:'li-note'},'時數含核定明細及本次系統已匯入且無重疊的結算。跨年度專案請選單一案件及「跨年度」。個人月欄僅計入有月份的來源。'),
    ...buttons.map(([key,label])=>{const b=button(label,()=>busy(b,status,()=>showForm(key)));return b;}),formPreview);
   const balances=r.balances||[];output.replaceChildren(el('p',{class:'li-note'},[periodLabel,scope.input.selectedOptions?.[0]?.textContent||criteria.scope,criteria.scope==='employee'?(staff.find(p=>p.employeeId===selected)?.name||selected):'',projectItem.legacy_code,projectItem.name||'所有專案','查詢 '+new Date().toLocaleTimeString('zh-TW')].filter(Boolean).join(' · ')),pending,approved,el('p',{},'已採用舊結算 '+hours(balances.filter(b=>!b.overlap).reduce((n,b)=>n+b.minutes,0))+'h · 重疊待核對 '+balances.filter(b=>b.overlap).length+' 筆'),forms);
   if(balances.length)output.append(el('h3',{},'已匯入的結算來源'),table(['期間','人員','案件','小時','計入狀態'],balances.map(b=>[b.period==='lifetime'?'所有年度':b.start,b.name,b.projectName,hours(b.minutes),b.overlap?'重疊待核對':'歷史結算'])));
   if(api.can('ai.use')&&typeof api.chat==='function')mountReportQuestion(output,api,{scope:r.scope,year:r.year,projectId:r.projectId,employeeId:selected},()=>check(at));
   if(buttons.some(([key])=>key===settlementView.kind))await showForm(settlementView.kind);
   status.textContent='已查詢工時';
  }
  const query=button('查詢專案／年度工時',()=>busy(query,status,runQuery),'li-primary');
  async function projects(){
   const request=++projectRequest,old=reportFilter.projectId;selection++;query.dataset.locked='true';query.disabled=true;output.replaceChildren();
   const r=await read('report.projects',{scope:scope.input.value},at);
   if(request!==projectRequest)return;
   query.dataset.locked='false';projectList=r.projects;project.input.replaceChildren(el('option',{value:''},'所有專案'),...r.projects.map(p=>el('option',{value:p.project_id},[p.legacy_code,p.name].filter(Boolean).join(' · ')+(p.active?'':'（歷史）'))));
   project.input.value=r.projects.some(p=>p.project_id===old)?old:'';reportFilter.projectId=project.input.value;query.disabled=false;
  }
  scope.input.addEventListener('change',()=>{reportFilter.scope=scope.input.value;reportFilter.queried=false;projects().catch(e=>status.textContent=errorText(e));});
  const clear=()=>{selection++;reportFilter.projectId=project.input.value;reportFilter.year=year.input.value;reportFilter.period=period.input.value;reportFilter.queried=false;year.node.hidden=period.input.value==='all';output.replaceChildren();};
  period.input.addEventListener('change',clear);
  project.input.addEventListener('change',clear);year.input.addEventListener('change',clear);
  const presets=el('div',{class:'li-actions'});
  function preset(label,targetScope,targetPeriod){
   presets.append(button(label,()=>{scope.input.value=targetScope||scope.input.value;period.input.value=targetPeriod;
    if(targetPeriod==='year'){project.input.value='';year.input.value=date.input.value.slice(0,4);}
    reportFilter.scope=scope.input.value;clear();
    projects().then(()=>{if(targetPeriod==='all')project.input.focus();else query.click();}).catch(e=>status.textContent=errorText(e));
   }));
  }
  preset('所選人員年度','employee','year');preset('單一案件跨年',null,'all');
  if(allowed==='company')preset('公司年度','company','year');
  body.append(presets,el('div',{class:'li-toolbar'},scope.node,period.node,year.node,project.node,query,button('匯入 Excel',()=>openReportImport(api,null,undefined,{employeeId:scope.input.value==='employee'?selected:null,year:period.input.value==='year'?year.input.value:null,projectId:project.input.value,projectCode:projectList.find(p=>p.project_id===project.input.value)?.legacy_code}))),output);await projects();if(reportFilter.queried)await runQuery();
 }
 const imported=()=>{if(!disposed)load();};window.addEventListener('leaves:report-imported',imported);
 const onSaved=event=>{if(!disposed&&event.detail?.employeeId===selected&&event.detail?.date?.slice(0,7)===date.input.value.slice(0,7))load();};window.addEventListener('leaves:daily-saved',onSaved);
 try{const r=await api.progress('staff.list');staff=r.staff;person.input.replaceChildren(...staff.map(p=>el('option',{value:p.employeeId},p.name+(p.state==='departed'?'（離職）':''))));person.input.value=selected;person.node.hidden=true;if(staff.some(p=>p.employeeId!==selected)){const browse=button('查閱其他人員',()=>{person.node.hidden=!person.node.hidden;browse.textContent=person.node.hidden?'查閱其他人員':'收合人員選擇';});person.node.after(browse);}await load();}catch(e){status.textContent=errorText(e);}return{navigate,dispose(){window.removeEventListener('leaves:daily-saved',onSaved);window.removeEventListener('leaves:report-imported',imported);disposed=true;epoch++;root.replaceChildren();},canHotSwap:()=>!document.querySelector('.li-dialog[open]')};
}
