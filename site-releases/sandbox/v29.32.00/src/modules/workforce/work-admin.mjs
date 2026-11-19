import {el,field,select,button,dialog,busy,errorText,table} from '../shared/dom.mjs';

export async function openProjectCatalog(api,staff,onSaved) {
  const d=dialog('專案管理');
  const list=el('div'),search=field('搜尋專案','search','',{placeholder:'案名或案號'});
  let projects=[],advanced=true;
  const create=button('新增專案',()=>editProject(null),'li-primary');
  const refresh=button('重新讀取',()=>busy(refresh,d.status,load));
  d.content.append(el('div',{class:'li-toolbar'},search.node,create,refresh),list);
  search.input.oninput=paint;
  function paint() {
    const q=search.input.value.trim().toLowerCase();
    const matches=projects.filter(p=>(p.name+' '+(p.legacy_code||'')).toLowerCase().includes(q));
    const rows=matches.map(p=>[p.legacy_code||'—',p.name,p.active?'啟用':'已結案',
      p.members?.length??'—',advanced?button('編輯專案',()=>editProject(p)):'']);
    list.replaceChildren(rows.length?table(['案號','案名','狀態','成員','操作'],rows):el('p',{class:'li-note'},q?'找不到符合的案件。':'專案清單目前沒有案件。'));
  }
  async function load() {
    try{projects=(await api.progress('projects.manage')).projects;advanced=true;}
    catch(e){
      if(e.code!=='UNKNOWN_ACTION')throw e;
      projects=(await api.progress('projects.list')).projects;advanced=false;
    }
    if(d.box.isConnected)paint();
  }
  function editProject(old) {
    const editor=dialog(old?'編輯專案':'新增專案'),id=old?.project_id||crypto.randomUUID();
    const name=field('專案名稱','text',old?.name||'',{maxLength:120,required:true});
    const code=field('案號','text',old?.legacy_code||'',{maxLength:100,required:advanced,disabled:!!old?.legacy_code});
    const state=select('狀態',[['active','啟用'],['closed','結案（保留歷史）']],old&&!old.active?'closed':'active');
    const people=new Map(staff.filter(x=>x.state==='active').map(x=>[x.employeeId,x.name]));
    for(const p of old?.members||[])if(!people.has(p))people.set(p,'既有成員（已停用或不可見）');
    const selected=new Set(old?.members||[api.person().employeeId]);
    const members=[...people].map(([id,name])=>({id,name,input:el('input',{type:'checkbox',checked:selected.has(id)})}));
    const fields=el('div',{class:'li-grid'},name.node,code.node,...(advanced?[state.node]:[]));
    editor.content.append(fields,el('h3',{},'可填寫的人員'),el('div',{class:'li-project-members'},members.map(p=>el('label',{},p.input,p.name))));
    const save=button('保存專案',()=>busy(save,editor.status,async()=>{
      if(!name.input.value.trim()||advanced&&!code.input.value.trim())throw Error('請填寫案名與案號。');
      const payload={id,name:name.input.value.trim(),legacyCode:code.input.value.trim(),active:state.input.value==='active',
        expectedRevision:old?.revision||0,members:members.filter(p=>p.input.checked).map(p=>p.id)};
      if(!payload.members.length&&payload.active)throw Error('啟用案件至少要指定一位填寫人員。');
      try{await api.progress(advanced?'projects.save':'projects.create',payload,true);}
      catch(e){if(e.verificationRequired)save.dataset.locked='true';throw e;}
      editor.close();
      if(d.box.isConnected)await load();
      await onSaved();
    }),'li-primary');
    editor.content.append(el('div',{class:'li-actions'},save));
  }
  try{await load();}catch(error){d.status.textContent=errorText(error);}
}

export function openProjectMilestones(api,item,current,writable,onSaved) {
  const d=dialog('專案合約進度');
  d.content.append(el('p',{},item.projectName+' · '+(item.business==='design'?'設計階段':'工程階段')+' · '+item.label));
  const value=field('合約進度（%）','number',current?.percent??'',{min:0,max:100,step:1,disabled:!writable});
  const note=el('textarea',{maxLength:500,disabled:!writable},current?.note||'');
  d.content.append(value.node,el('label',{class:'li-field'},el('span',{},'合約進度備註'),note));
  if(!writable)return;
  const save=button('保存合約進度',()=>busy(save,d.status,async()=>{
    const percent=value.input.value===''?null:Number(value.input.value);
    if(percent!==null&&(!Number.isInteger(percent)||percent<0||percent>100))throw Error('進度請填 0 至 100 的整數。');
    try{await api.progress('milestones.save',{projectId:item.projectId,business:item.business,installment:item.installment,percent,note:note.value.trim(),expectedRevision:current?.revision||0},true);}
    catch(e){if(e.verificationRequired)save.dataset.locked='true';throw e;}
    d.close();
    await onSaved();
  }),'li-primary');
  d.content.append(save);
}

export function openReportNote(api,person,month,target,old,writable,onSaved) {
  const d=dialog('月報備註');
  const note=el('textarea',{maxLength:1000,rows:5,disabled:!writable},old?.note||'');
  d.content.append(el('p',{},target.label),el('label',{class:'li-field'},el('span',{},'補充說明（不計工時）'),note));
  if(!writable)return;
  const save=button('保存備註',()=>busy(save,d.status,async()=>{
    const value=note.value.trim();
    if(!old&&!value)throw Error('請填寫備註。');
    try{
      await api.progress('month.note.save',{employeeId:person.employeeId,month,anchor:target.anchor,label:target.label,
        note:value,expectedRevision:old?.revision||0},true);
    }catch(e){if(e.verificationRequired)save.dataset.locked='true';throw e;}
    d.close();
    await onSaved();
  }),'li-primary');
  d.content.append(save);
}
