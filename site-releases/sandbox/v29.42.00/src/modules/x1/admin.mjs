import {el,button,dialog,errorText} from '../shared/dom.mjs';
import {readCurrentPolicy,readPolicyReceipt,samePolicy} from './policy.mjs';

const labels = {
  enabled:'在聊天輸入區顯示 LEAVES AI x1',
  modelReview:'允許依公司 SOP 核對目前開啟的報價',
  diagnosticsEnabled:'在已開啟的 AI 對話檢測中記錄 x1 流程'
};

export function mountX1Settings(host, api, check, onSaved) {
  if (!api.can('technical.settings')) return;
  const environment = api.person().environment;
  const heading = el('h3',{},'LEAVES AI x1');
  function currentVersion() {
    const version=globalThis.window?.leavesIdentityApp?.x1?.getEngineStatus?.().activeVersion;
    return typeof version==='string' && /^\d+\.\d+\.\d+$/.test(version)?' · 引擎 '+version:'';
  }
  const status = el('p',{class:'li-note',role:'status','aria-live':'polite'});
  const box = el('section',{class:'li-card',id:'leavesX1Settings'},heading,status);
  host.append(box);
  let revision = null, sequence = 0, pending = null, busy = false;
  const inputs = {};
  for (const [key, title] of Object.entries(labels)) {
    const input = el('input',{type:'checkbox',disabled:true});
    inputs[key] = input;
    const row = el('label',{style:'display:flex;align-items:baseline;gap:.65em;margin:.45em 0;line-height:1.5'},input,el('span',{},title));
    input.style.cssText = 'width:1em;height:1em;flex:none;accent-color:#aaa';
    box.append(row);
    if (key==='diagnosticsEnabled' && environment!=='sandbox') row.hidden = true;
    input.addEventListener('change',() => {
      if(key==='enabled') {
        inputs.modelReview.checked=input.checked;
        if(!input.checked)inputs.diagnosticsEnabled.checked=false;
      }
      pending=null;draw();
    });
  }
  const save = button('預覽設定', preview);
  const reload = button('重新讀取', () => {if(!busy) load();});
  box.append(el('div',{class:'li-actions'},save,reload));
  const desired = () => Object.fromEntries(Object.entries(inputs).map(([key,input]) => [key,input.checked]));
  function draw() {
    const ready = !!revision && !busy;
    for (const [key,input] of Object.entries(inputs)) input.disabled = !ready || (key!=='enabled' && !inputs.enabled.checked);
    save.disabled = !ready || samePolicy(desired(),revision);
    reload.disabled = busy;
  }
  function accept(value) {
    revision = value;
    for(const [key,input] of Object.entries(inputs)) input.checked=value[key];
    status.textContent = (environment==='sandbox'?'沙盒':'正式站')+' · 設定 r'+value.revision+' · '+(value.enabled?'已開啟':'已關閉')+currentVersion();
    draw();
  }
  async function load() {
    const mine=++sequence;
    busy=true;draw();
    try {
      const value=await readCurrentPolicy(api);
      check();if(mine!==sequence)return;
      accept(value);pending=null;
    } catch(e) {
      if(mine!==sequence||!box.isConnected)return;
      revision=null;
      status.textContent=e.code==='UNKNOWN_ACTION'||e.code==='X1_POLICY_UNAVAILABLE'?'此環境尚未提供 x1 設定服務。':'無法讀取 x1 設定。'+errorText(e);
    } finally {
      if(mine===sequence){busy=false;draw();}
    }
  }
  function preview() {
    if(save.disabled || !revision || !api.can('technical.settings')) return;
    check();
    const expected=revision.revision, content=desired();
    const d=dialog('確認 x1 設定');
    d.content.append(el('p',{},'套用至'+(environment==='sandbox'?'沙盒':'正式站')+'。'));
    for(const key of Object.keys(labels)) {
      if(content[key]!==revision[key])d.content.append(el('p',{},labels[key]+'　'+(revision[key]?'開啟':'關閉')+' → '+(content[key]?'開啟':'關閉')));
    }
    const submit=button('確認儲存',async()=>{
      if(busy || submit.disabled)return;
      check();
      busy=true;submit.disabled=true;draw();
      const requestId=pending?.expected===expected && samePolicy(pending.content,content)?pending.requestId:crypto.randomUUID();
      pending={requestId,expected,content};
      let unknown=false;
      try {
        let result;
        try {
          const receipt=await api.write('x1.settings',{action:'save',requestId,expectedRevision:expected,confirm:'CONFIRM_X1_SETTINGS',content});
          result=readPolicyReceipt(receipt,environment);
        } catch(e) {
          if(!e.verificationRequired && !['SERVICE_UNAVAILABLE','X1_POLICY_UNAVAILABLE'].includes(e.code))throw e;
          unknown=true;
        }
        check();
        // A final independent read also detects a different administrator's intervening change.
        const fresh=await readCurrentPolicy(api);
        check();
        if(fresh.revision<=expected||!samePolicy(fresh,content)||(result&&result.revision!==fresh.revision)) {
          accept(fresh);pending=null;
          status.textContent='已重讀目前設定 r'+fresh.revision+'，請核對後再修改。';
        } else {
          pending=null;accept(fresh);onSaved?.(fresh);
          if(unknown)status.textContent+=' · 已重新讀取確認';
        }
        d.close();
      } catch(e) {
        if(e.code==='STALE_SESSION'||!box.isConnected){d.close();return;}
        if(/CONFLICT|STALE_REVISION|REVISION_CHANGED/.test(e.code||'')){
          d.close();busy=false;await load();status.textContent+=' · 設定已有更新，請重新核對。';return;
        }
        d.status.textContent=unknown||e.verificationRequired?'寫入狀態待核對，可再次確認或重新讀取。':errorText(e);
      } finally {
        busy=false;submit.disabled=false;draw();
      }
    },'li-primary');
    d.content.append(el('div',{class:'li-actions'},submit,button('返回',()=>d.close())));
  }
  draw();void load();
}
