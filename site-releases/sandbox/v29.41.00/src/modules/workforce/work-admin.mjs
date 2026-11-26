import {el,field,select,button,dialog,busy,errorText,table} from '../shared/dom.mjs';

export async function openProjectCatalog(api,staff,onSaved,query='') {
  const d=dialog('專案管理');
  const list=el('div'),search=field('搜尋專案','search',query,{placeholder:'案名或案號'});
  const manage=api.can('project.manage');
  let projects=[],candidates=[],assignable=[];
  const create=button('新增專案',()=>editProject(null),'li-primary');
  const refresh=button('重新讀取',()=>busy(refresh,d.status,load));
  d.content.append(el('div',{class:'li-toolbar'},search.node,...(api.can('project.create')?[create]:[]),refresh),list);
  if(manage&&api.person().permissions['people.manage']==='company'){
   const link=button('對應舊員工編號',()=>{const editor=dialog('對應舊員工編號');
    const person=select('系統人員',staff.map(p=>[p.employeeId,p.name+' · '+p.employeeId]),staff[0]?.employeeId);
    const code=field('Excel 舊員工編號','text','',{maxLength:8}),ack=el('input',{type:'checkbox'});
    const save=button('確認對應',()=>busy(save,editor.status,async()=>{if(!ack.checked)throw Error('請先核對姓名、固定 ID 及舊編號。');
     const p=staff.find(x=>x.employeeId===person.input.value);await api.progress('employee-code.save',{employeeId:p.employeeId,name:p.name,code:code.input.value.trim(),confirm:'LINK'},true);editor.close();
    }),'li-primary');editor.content.append(person.node,code.node,el('label',{},ack,' 已依公司名冊核對這兩個編號'),save);});
   d.content.prepend(link);
  }
  search.input.oninput=paint;
  function paint() {
    const norm=s=>s.normalize('NFKC').replace(/\s+/g,'').toUpperCase();
    const q=norm(search.input.value);
    const matches=projects.filter(p=>norm(p.name+' '+(p.legacy_code||'')).includes(q));
    const rows=matches.map(p=>[p.legacy_code||'—',p.name,p.active?(p.members?.includes(api.person().employeeId)?'啟用 · 已指派給你':'啟用'):'已結案',
      p.members?.length??'—',manage?button('編輯專案',()=>editProject(p)):'']);
    const existingCodes=new Set(projects.map(p=>norm(p.legacy_code||'')));
    const pending=candidates.filter(p=>(p.review!=='ready'||!existingCodes.has(norm(p.code)))&&norm(p.code+p.name).includes(q));
    for(const c of pending){
     const ready=c.review==='ready';
     rows.push([c.code,c.name,ready?'待建檔':'案號待核對','—',ready&&api.can('project.create')?button('帶入並建檔',()=>editProject(null,c)):'']);
    }
    list.replaceChildren(rows.length?table(['案號','案名','狀態','成員','操作'],rows):el('p',{class:'li-note'},q?'找不到符合的案件。':'專案清單目前沒有案件。'));
  }
  async function load() {
    const [catalog,reference]=await Promise.all([api.progress(manage?'projects.manage':'projects.list',{assignedOnly:true}),api.progress('projects.candidates')]);
    projects=catalog.projects;candidates=reference.candidates;assignable=reference.assignable;
    if(d.box.isConnected){paint();const held=candidates.filter(x=>x.review==='hold');
     d.content.querySelector('.li-catalog-holds')?.remove();if(held.length)d.content.append(el('details',{class:'li-catalog-holds'},el('summary',{},'待核對案號'),table(['案號','待核對名稱'],held.filter(x=>x.name!=='待核對'||!held.some(y=>y.code===x.code&&y.name!==x.name)).map(x=>[x.code,x.name]))));}
  }
  function editProject(old,candidate=null) {
    const editor=dialog(old?'編輯專案':'新增專案'),id=old?.project_id||crypto.randomUUID();
    const name=field('專案名稱','text',old?.name||candidate?.name||'',{maxLength:120,required:true});
    const code=field('案號','text',old?.legacy_code||candidate?.code||'',{maxLength:100,required:true,disabled:!!old?.legacy_code});
    const state=select('狀態',[['active','啟用'],['closed','結案（保留歷史）']],old&&!old.active?'closed':'active');
    const people=new Map(assignable.filter(x=>x.state==='active').map(x=>[x.employeeId,x.name]));
    for(const p of old?.members||[])if(!people.has(p))people.set(p,'既有成員（已停用或不可見）');
    const selected=new Set(old?.members||[api.person().employeeId]);
    const members=[...people].map(([id,name])=>({id,name,input:el('input',{type:'checkbox',checked:selected.has(id)})}));
    const source=select('從待建案件帶入',[['','自行填寫'],...candidates.filter(p=>p.review==='ready').map(p=>[p.code,p.code+' · '+p.name])],'');
    source.input.onchange=()=>{const p=candidates.find(x=>x.code===source.input.value);if(p){code.input.value=p.code;name.input.value=p.name;}};
    const fields=el('div',{class:'li-grid'},...(!old&&candidates.length?[source.node]:[]),name.node,code.node,...(old?[state.node]:[]));
    editor.content.append(fields,el('h3',{},'可填寫的人員'),el('div',{class:'li-project-members'},members.map(p=>el('label',{},p.input,p.name))));
    const save=button('保存專案',()=>busy(save,editor.status,async()=>{
      if(!name.input.value.trim()||!code.input.value.trim())throw Error('請填寫案名與案號。');
      const payload={id,name:name.input.value.trim(),legacyCode:code.input.value.trim(),active:state.input.value==='active',
        expectedRevision:old?.revision||0,members:members.filter(p=>p.input.checked).map(p=>p.id)};
      if(!payload.members.length&&payload.active)throw Error('啟用案件至少要指定一位填寫人員。');
      try{await api.progress(old?'projects.save':'projects.create',payload,true);}
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
