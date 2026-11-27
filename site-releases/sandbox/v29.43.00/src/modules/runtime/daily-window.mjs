import {openProjectCatalog} from '../workforce/work-admin.mjs';
import {createTeamFeed,teamCardOrder,teamPositionKey} from './team-feed.mjs';
import {el,button,field,select,dialog,busy,errorText,localDate,hours,roles} from '../shared/dom.mjs';
import {workFields} from '../workforce/work-fields.mjs';
import {hoursToMinutes,workTimes} from '../workforce/model.mjs';
import {mountLeaves} from '../workforce/monthly.mjs';
import {leaveKinds,leaveStates} from '../workforce/monthly.mjs';
export function dayBudget(values,scheduled=480,leave=0){const total=values.reduce((n,v)=>n+(String(v).trim()===''?0:hoursToMinutes(v)),0);if(total>1440)throw Error('當日安排合計不可超過 24 小時');const available=Math.max(0,scheduled-leave);return{total,available,remaining:Math.max(0,available-total),overtime:Math.max(0,total-available)};}
export function shiftDate(day,offset){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export async function openDailyWindow(api,{date:initialDate=localDate(),entryId=null,newEntry=null}={}){
 const at=api.epoch(),person=api.person();if(!person||!api.can('progress.view'))throw Error('目前身分沒有每日進度權限');
 const active=document.querySelector('.li-daily-window[open]');
 if(active?._epoch===at && active._employee===person.employeeId && active._date?.value===initialDate){
   if(!active._locate&&(entryId||newEntry)){active.close();return openDailyWindow(api,{date:initialDate,entryId,newEntry});}active._locate?.(entryId,newEntry);window.LeavesWindowStack?.raise(active);if(!active.contains(document.activeElement))active.focus();return active._handle;
 }
 const d=dialog('每日進度與補填',{modal:false,width:650,height:565,close:()=>window.LeavesWindowStack?.unregister(d.box)});
 d.box._handle=d;d.box._epoch=at;d.box._employee=person.employeeId;
 window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 d.box.classList.add('li-daily-window');const date=field('填寫日期','date',initialDate,{max:localDate()}),panel=el('div');d.box._date=date.input;let seq=0,saveCurrent=async()=>{},loading=false;
 const check=()=>{if(!d.box.isConnected||api.epoch()!==at||api.person()?.employeeId!==person.employeeId)throw Error('登入已變更，請重新開啟');};
 const choose=async day=>{if(loading)return;try{await saveCurrent();date.input.value=day;await load();}catch(e){d.status.textContent=errorText(e);}};
 d.content.append(el('p',{class:'li-daily-person'},person.name,el('span',{class:'li-role','data-role':person.role},roles[person.role])),el('div',{class:'li-toolbar'},date.node,button('今天',()=>choose(localDate())),button('昨天',()=>choose(shiftDate(localDate(),-1)))),panel);date.input.onchange=()=>choose(date.input.value);
 async function load(){const s=++seq,day=date.input.value;if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>localDate())throw Error('請選擇今天或之前的日期');loading=true;date.input.disabled=true;panel.replaceChildren();d.status.textContent='讀取 '+day+'…';saveCurrent=async()=>{};
 try{const [review,pr,reference]=await Promise.all([api.progress('day.view',{employeeId:person.employeeId,date:day}),api.progress('projects.list',{assignedOnly:true}),(api.can('project.create')||api.can('project.manage'))?api.progress('projects.candidates').catch(()=>null):null]);check();if(s!==seq)return;
 const locked=review.closed||!api.can('progress.edit'),existing=review.entries,rows=[],list=el('div',{class:'li-daily-rows'}),budget=el('div',{class:'li-day-budget'}),leaveBox=el('div'),draftKey='daily-hours-v1:'+person.employeeId+':'+day;let dirty=false;
 let draftQueue=Promise.resolve();
 async function withWrite(fn){
  if(d.box.dataset.writing==='true')return;
  d.box.dataset.writing='true';panel.inert=true;date.input.disabled=true;loading=true;
  try{return await fn();}catch(e){
   if(e.verificationRequired||e.code==='REVISION_CONFLICT'){
    d.box.querySelector('.li-read-current')?.remove();
    const server=button('核對伺服器現況',()=>busy(server,d.status,async()=>{await saveCurrent();await load();}));
    server.classList.add('li-read-current');d.status.after(server);server.addEventListener('click',()=>server.remove(),{once:true});
   }
   throw e;
  }finally{d.box.dataset.writing='false';panel.inert=false;date.input.disabled=false;loading=false;}
 }
 const snapshot=()=>rows.map(r=>({id:r.id,revision:r.revision,...r.fields.values(),hours:r.time.input.value,actualHours:r.actual.input.value}));
 saveCurrent=async()=>{if(dirty&&!locked){const value={unit:'hours',rows:snapshot()};draftQueue=draftQueue.catch(()=>{}).then(()=>{
  if(api.epoch()!==at||api.person()?.employeeId!==person.employeeId)throw Error('登入已變更，舊草稿已停止寫入。');
  return api.drafts.save(draftKey,value);
 });await draftQueue;}};
 const changed=()=>{dirty=true;paint();saveCurrent().catch(e=>d.status.textContent=errorText(e));};
 function paint(){try{const leave=review.leaves.filter(x=>x.status==='approved').reduce((n,l)=>n+l.minutes,0),b=dayBudget(rows.map(r=>r.time.input.value),review.scheduledMinutes,leave);budget.replaceChildren(el('div',{},'班表',el('strong',{},hours(review.scheduledMinutes)+'h')),el('div',{},'已確認請假',el('strong',{},hours(leave)+'h')),el('div',{},'工作安排',el('strong',{},hours(b.total)+'h')),el('div',{},'尚可安排',el('strong',{},hours(b.remaining)+'h')),...(b.overtime?[el('p',{class:'li-note'},'超出正常可安排 '+hours(b.overtime)+'h，請核對加班或請假重疊。')]:[]));}catch(e){budget.textContent=e.message;}}
 function add(e={}){
  const r={id:e.id||crypto.randomUUID(),revision:e.revision||0};
  const manage=api.can('project.create')||api.can('project.manage');
  const inspect=manage?async query=>{
   try{
    check();const staff=await api.progress('staff.list');check();
    await openProjectCatalog(api,staff.staff,async()=>{
     check();if(s!==seq)return;
     const fresh=await api.progress('projects.list',{assignedOnly:true});check();if(s!==seq)return;
     pr.projects=fresh.projects;for(const row of rows)row.fields.refreshProjects(fresh.projects);
    },query);
   }catch(error){d.status.textContent=errorText(error);}
  }:null;
  r.fields=workFields({inspect,candidates:reference?.candidates||[],projects:pr.projects,entry:e,style:review.reportStyle,disabled:locked,onChange:changed,
    storageKey:(person.environment||window.LEAVES_IDENTITY_CONFIG?.environment||location.pathname.split('/')[1])+':'+person.employeeId});
  r.time=field('預計小時','number',e.hours??(e.planned_minutes==null?'':e.planned_minutes/60),{min:0,max:24,step:'any'});
  r.actual=field('實際小時（空白待確認）','number',e.actualHours??(e.actual_minutes==null?'':e.actual_minutes/60),{min:0,max:24,step:'any'});
  const remove=button('移除',()=>{rows.splice(rows.indexOf(r),1);node.remove();changed();});
  remove.hidden=existing.some(x=>x.id===r.id);remove.disabled=locked||remove.hidden;
  remove.title=remove.disabled?'已保存項目請更正內容或時數，保留歷程':'移除未保存項目';
  const node=el('section',{class:'li-daily-row'},
   r.fields.search,r.fields.header,r.fields.hint,
   el('div',{class:'li-grid li-daily-inputs'},r.fields.description.node,r.time.node,r.actual.node),r.fields.details,remove);
  r.payload=()=>({id:r.id,date:day,employeeId:person.employeeId,expectedRevision:r.revision,...r.fields.payload(),...workTimes(r.time.input.value,r.actual.input.value)});
  const saveOne=button('僅保存這筆工作',()=>busy(saveOne,d.status,()=>withWrite(async()=>{
   const payload=r.payload();const pending=snapshot().filter(x=>x.id!==r.id);
   await saveCurrent();const result=await api.progress('entry.save',payload,true);check();
   if(!result.entry?.revision)throw Error('尚未取得保存回執，請重新核對。');
   const next=result.entry;const index=existing.findIndex(x=>x.id===r.id);
   if(index<0)existing.push(next);else existing[index]=next;
   r.revision=next.revision;remove.hidden=remove.disabled=true;
   const hasOtherChanges=pending.some(x=>{const row=existing.find(i=>i.id===x.id);return !row||x.description!==row.description||x.workType!==row.work_type||x.business!==row.business||(x.projectId||null)!==row.project_id||String(x.hours)!==String(row.planned_minutes/60)||String(x.actualHours)!==String(row.actual_minutes==null?'':row.actual_minutes/60);});
   dirty=hasOtherChanges;
   if(dirty){await saveCurrent();}else{await api.drafts.remove(draftKey);await load();}
   window.dispatchEvent(new CustomEvent('leaves:daily-saved',{detail:{date:day,employeeId:person.employeeId}}));
   d.status.textContent=day+' 已保存此筆。'+(review.submittedAt?'團隊可查看更正。':'請按送出，團隊才會看到當日進度。');
  })));
  const savedRow=existing.find(x=>x.id===r.id);
  if(savedRow&&!locked&&review.workflowRevision>=37){
   const undo=button('撤銷已存工作',()=>{
    if(dirty){d.status.textContent='本頁還有編輯中的工作，請先送出或重新開啟並核對草稿。';return;}
    const confirmBox=dialog('撤銷已存工作'),reason=field('撤銷原因','text','',{manualReason:true,maxLength:500});
    confirmBox.content.append(el('p',{},day+' · '+savedRow.description+'。撤銷後會從工時合計移除，原值與原因保留。'),reason.node);
    const confirm=button('確認撤銷此筆',()=>busy(confirm,confirmBox.status,async()=>{
     check();const why=reason.input.value.trim();if(why.length<3)throw Error('請填寫至少 3 個字。');
     const response=await api.progress('entry.save',{id:r.id,date:day,employeeId:person.employeeId,expectedRevision:r.revision,operation:'withdraw',confirm:'WITHDRAW_WORK_ENTRY',reason:why},true);
     if(!response.withdrawn)throw Error('撤銷結果尚未確認，請重新讀取。');
     check();confirmBox.close();window.dispatchEvent(new CustomEvent('leaves:daily-saved',{detail:{employeeId:person.employeeId,date:day}}));await load();
    }));confirmBox.content.append(confirm);
   });node.append(undo);
  }
  if(!locked){
   const quick=el('details',{},el('summary',{},'更多操作'),saveOne,el('span',{},'填入實際小時'));
   for(const value of [.5,1,2,4,8])quick.append(button(value+' h',()=>{r.actual.input.value=String(value);changed();}));
   quick.append(button('同案新增一筆',()=>{const v=r.fields.values();const next=add({projectId:v.projectId,business:v.business});next.fields.description.input.focus();changed();}));node.append(quick);
  }
  r.node=node;
  for(const f of [r.time,r.actual]){f.input.disabled=locked;f.input.oninput=changed;}
  rows.push(r);list.append(node);paint();return r;
 }
 existing.forEach(add);
 let pendingFocus=null;
 const locate=(id,defaults)=>{
  let row=id?rows.find(x=>x.id===id):null;
  if(defaults&&!locked){row=add(defaults);}
  if(id&&!row){d.status.textContent='此筆工作已變更，請重新核對當日明細。';}if(row){const focus=()=>{row.node.scrollIntoView?.({block:'nearest'});(id?row.actual.input:row.fields.description.input).focus();};if(row.node.isConnected)focus();else pendingFocus=focus;}
 };
 d.box._locate=locate;
 if(entryId||newEntry){locate(entryId,newEntry);entryId=null;newEntry=null;}
 if(!rows.length&&!review.leaves.some(l=>['pending','approved'].includes(l.status)))add();
 const save=button(day===localDate()?'送出今日進度':'送出 '+day+' 補填',()=>busy(save,d.status,()=>withWrite(async()=>{check();dayBudget(rows.map(r=>r.time.input.value),review.scheduledMinutes);const entries=rows.map(r=>r.payload());
 const fingerprint=JSON.stringify(entries);if(save.dataset.fingerprint!==fingerprint){save.dataset.fingerprint=fingerprint;save.dataset.requestId=crypto.randomUUID();}await saveCurrent();const receipt=await api.progress('daily.submit',{date:day,entries,requestId:save.dataset.requestId},true);check();if(!receipt.submittedAt)throw Error('未取得送出回執，請重新核對日期。');dirty=false;await api.drafts.remove(draftKey);window.dispatchEvent(new CustomEvent('leaves:daily-saved',{detail:{date:day,employeeId:person.employeeId}}));panel.replaceChildren(el('h3',{},day+' 已送出團隊'),el('p',{},entries.length+' 筆工作 · 待補實際 '+entries.filter(x=>x.actualMinutes===null).length+' 筆'),button('繼續查看當日',load),button('查看本月',async()=>{d.close();await api.openMonth(day);}));d.box._locate=null;d.status.textContent='已送出';})),'li-primary');save.disabled=locked;
 const discard=button('放棄本機草稿',()=>{const c=dialog('放棄本機草稿');c.content.append(el('p',{},day+' 的尚未送出內容將清除。'),button('確認放棄草稿',async()=>{await draftQueue;await api.drafts.remove(draftKey);dirty=false;c.close();await load();}));});discard.hidden=true;
 const restore=button('恢復未送出的草稿',()=>busy(restore,d.status,async()=>{const saved=await api.drafts.load(draftKey);check();if(saved?.unit!=='hours')throw Error('沒有可恢復的草稿');if(!Array.isArray(saved.rows)||review.entries.some(e=>!saved.rows.some(row=>row.id===e.id))||saved.rows.some(r=>r.revision!==(review.entries.find(e=>e.id===r.id)?.revision||0)))throw Error('草稿基準已改變，請先核對每日明細');rows.length=0;list.replaceChildren();saved.rows.forEach(add);dirty=true;d.status.textContent='已恢復，尚未送出';}));restore.disabled=locked;restore.hidden=true;
 panel.append(el('p',{class:'li-note'},(day===localDate()?'今天填寫':'補填日期：'+day)+(locked?' · 已核定或僅可查看':'')),el('p',{class:'li-note'},'已保存 '+existing.length+' 筆 · '+(review.submittedAt?'團隊已提交':review.workflowRevision>=37?'團隊尚未提交':'團隊狀態請至團隊進度核對')+'。只補實際時，預計可留空並按 0 小時計。'),budget,list,el('div',{class:'li-actions'},Object.assign(button('＋ 新增工作',()=>{add();changed();}),{disabled:locked}),restore,discard,save),leaveBox);
 pendingFocus?.();
 mountLeaves(leaveBox,api,{date:day,employeeId:person.employeeId,data:review,reload:async()=>{await saveCurrent();await load();}});d.status.textContent='';
 const saved=await api.drafts.load(draftKey);check();restore.hidden=discard.hidden=!saved||locked;if(saved)d.status.textContent=(Date.now()-Date.parse(saved._draftSavedAt||'')>30*86400000?'此草稿已超過 30 天，請核對後送出或自行處理。':'此日期有未送出草稿，可按「恢復」。')+'切換日期會保留草稿。';
 }catch(e){d.status.textContent=errorText(e);}finally{loading=false;date.input.disabled=false;}}
 await load();return d;
}
export async function openTeamDay(api){
 const person=api.person(),at=api.epoch();if(!person||!api.can('progress.view')||!['owner','boss','supervisor'].includes(person.role))throw Error('目前身分沒有團隊進度權限');
 const existing=document.querySelector('.li-team-window[open]');if(existing){if(existing._teamEpoch===at){window.LeavesWindowStack?.raise(existing);existing.focus();return existing._teamHandle;}existing.close();}
 let feed,closed=false;
 const d=dialog('團隊今日進度',{modal:false,width:960,height:620,close:()=>{closed=true;feed?.dispose();window.removeEventListener('leaves:daily-saved',localSaved);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.LeavesWindowStack?.unregister(d.box);}});
 d.box.classList.add('li-team-window');d.box._teamEpoch=at;d.box._teamHandle=d;window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 const date=field('日期','date',localDate()),role=select('職務',[['','全部職務'],...Object.entries(roles)],''),cards=el('div',{class:'li-team-cards'}),count=el('span',{class:'li-team-count'}),missing=el('details',{class:'li-team-missing'}),leaveSummary=el('details',{class:'li-team-leaves'}),empty=el('p',{class:'li-team-empty'},'尚無同仁提交此日期的進度。');
 const nodes=new Map(),seen=new Set();let cache=[],scheduled=0;
 const valid=()=>!closed&&d.box.isConnected&&at===api.epoch()&&api.person()?.employeeId===person.employeeId&&api.can('progress.view')&&['owner','boss','supervisor'].includes(api.person()?.role);
 const fullLeave=x=>scheduled>0&&x.leaves.filter(l=>l.status==='approved').reduce((n,l)=>n+l.minutes,0)>=scheduled;
 const time=value=>new Date(value).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
 function card(x){const {p,rows,leaves,submittedAt}=x,first=x.firstSubmittedAt||submittedAt,planned=rows.reduce((n,r)=>n+r.planned_minutes,0),known=rows.filter(r=>r.actual_minutes!==null),actual=known.reduce((n,r)=>n+r.actual_minutes,0);
  return el('article',{class:'li-team-card','data-employee':p.employeeId,'data-position':teamPositionKey(p)},
   el('header',{},el('h3',{},p.name),el('span',{class:'li-role','data-role':p.role},p.position||roles[p.role])),
   el('ul',{},rows.map(r=>el('li',{},el('span',{},r.projectName||'內部事務'),el('p',{},r.description),el('small',{},'預計 '+hours(r.planned_minutes)+'h'+(r.actual_minutes!==null?' · 已登錄實際 '+hours(r.actual_minutes)+'h':' · 實際待確認'))))),
   ...leaves.map(l=>el('p',{class:'li-team-leave-line'},(leaveKinds.find(k=>k[0]===l.leave_kind)?.[1]||l.leave_kind)+' '+hours(l.minutes)+'h · '+leaveStates[l.status])),
   el('footer',{},el('span',{},'安排 '+hours(planned)+'h'+(known.length?' · 已登錄實際 '+hours(actual)+'h':'')),el('time',{},'首次 '+time(first)+(submittedAt!==first?' · 更新 '+time(submittedAt):''))),
   el('details',{class:'li-team-card-meta'},el('summary',{},'詳細資料'),el('span',{},'固定 ID '+p.employeeId)));
 }
 function paint(){if(!valid()){d.close();return;}const visible=cache.filter(x=>!role.input.value||x.p.role===role.input.value),submitted=teamCardOrder(visible),unsubmitted=visible.filter(x=>!x.submittedAt&&!fullLeave(x)),onLeave=visible.filter(x=>x.leaves.length);
  count.textContent='已提交 '+submitted.length+' / '+visible.length+' 人 · 全日已確認請假 '+visible.filter(fullLeave).length+' 人';
  missing.replaceChildren(el('summary',{},'尚未提交 '+unsubmitted.length+' 人'),el('p',{},unsubmitted.map(x=>x.p.name).join('、')||'此範圍沒有尚待提交的人員。'));
  leaveSummary.replaceChildren(el('summary',{},'請假資訊 '+onLeave.length+' 人'),...onLeave.map(x=>el('p',{},x.p.name+' · '+x.leaves.map(l=>(leaveKinds.find(k=>k[0]===l.leave_kind)?.[1]||l.leave_kind)+' '+hours(l.minutes)+'h · '+leaveStates[l.status]).join('、'))));
  empty.remove();let entering=0;const wanted=new Set(submitted.map(x=>x.p.employeeId));for(const [id,value]of nodes)if(!wanted.has(id)){value.node.remove();nodes.delete(id);}
  for(let i=0;i<submitted.length;i++){const x=submitted[i],id=x.p.employeeId,stamp=JSON.stringify(x),old=nodes.get(id);let node=old?.node;
   if(!old||old.stamp!==stamp){const opened=old?.node.querySelector('details')?.open;node=card(x);if(opened)node.querySelector('details').open=true;if(!seen.has(id)){node.classList.add('li-team-card-enter');node.style.animationDelay=Math.min(entering++,6)*50+'ms';node.style.animationFillMode='both';seen.add(id);}if(old)old.node.replaceWith(node);nodes.set(id,{node,stamp});}
   if(cards.children[i]!==node)cards.insertBefore(node,cards.children[i]||null);
  }
  if(!submitted.length)cards.append(empty);
 }
 const status=(state,error)=>{if(!valid()){d.close();return;}if(state==='error'){d.status.textContent=errorText(error);if(['AUTH_REQUIRED','AUTH_REVOKED','FORBIDDEN'].includes(error?.code))d.close();}else if(state==='fallback')d.status.textContent='即時通知暫停，重新連線後自動補讀，也可按重新讀取。';else if(state==='syncing')d.status.textContent='正在同步變更…';else d.status.textContent=(state==='connected'?'即時通知已連線':'已同步')+' · '+new Date().toLocaleTimeString('zh-TW');};
 feed=createTeamFeed({read:(a,p,signal)=>api.progress(a,p,false,{signal}),watch:(day,options)=>api.watchTeamDay(day,options),environment:person.environment,onData:r=>{if(!valid())return d.close();cache=r.people;scheduled=r.scheduledMinutes;paint();},onState:status});
 const refresh=button('重新讀取',()=>feed.refresh()),ask=button('詢問 AI',()=>{if(valid())api.openTeamChat(date.input.value,role.input.value);});
 function focus(){feed?.focus();}function localSaved(){feed?.notify();}
 date.input.onchange=()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date.input.value))return;cache=[];nodes.clear();seen.clear();cards.replaceChildren();count.textContent='讀取中…';missing.replaceChildren();leaveSummary.replaceChildren();feed.setDate(date.input.value);};role.input.onchange=paint;
 window.addEventListener('leaves:daily-saved',localSaved);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 d.content.append(el('div',{class:'li-toolbar'},date.node,role.node,refresh,ask,count),el('div',{class:'li-team-notes'},missing,leaveSummary),cards);feed.setDate(date.input.value);return d;
}
