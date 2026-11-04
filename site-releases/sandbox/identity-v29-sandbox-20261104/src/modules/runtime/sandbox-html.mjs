import {el,button,busy,errorText} from '../shared/dom.mjs';
import {sha256} from './updates.mjs';
import {mountSiteRoute} from './site-route.mjs';
export function mountSandboxHtml(root,api){
 let disposed=false,sequence=0,verifiedUntil=0;
 const epoch=api.epoch();
 const check=()=>{if(disposed||api.epoch()!==epoch||api.person()?.environment!=='sandbox'||!api.can('technical.release'))throw Error('登入或發布權限已變更');};
 const status=el('p',{role:'status'}),progress=el('progress',{max:1,value:0}),password=el('input',{type:'password',autocomplete:'current-password','aria-label':'最高管理員通行碼'}),authStatus=el('p',{},'尚未驗證');
 const input=el('input',{type:'file',accept:'.html',hidden:true});
 async function inspect(file){const at=++sequence;verifiedUntil=0;progress.value=0;try{check();if(!/\.html$/i.test(file.name)||file.size>8*1048576)throw Error('請選擇 8 MB 以內的 HTML');const html=await file.text();check();if(at!==sequence)return;if(!/<!doctype html/i.test(html)||!html.includes("const BUILD_CHANNEL = 'sandbox'"))throw Error('請選擇沙盒版 HTML');const version=html.match(/const BUILD_VERSION\s*=\s*['"]([^'"]+)/)?.[1];if(!version)throw Error('缺少 Core 版本');const hash=await sha256(html);check();if(at!==sequence)return;progress.value=1;status.textContent=`已讀取 ${file.name} · ${version} · SHA-256 ${hash}。整站 HTML 上傳服務尚待接通，目前完成本機格式檢查。`;}catch(e){if(at===sequence)status.textContent=errorText(e);}}
 const drop=button('將 HTML 檔案拖曳至此，或點此選擇 HTML',()=>input.click(),'li-package-drop');
 input.onchange=()=>{if(input.files?.[0])inspect(input.files[0]);input.value='';};
 drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();if(e.dataTransfer.files.length===1)inspect(e.dataTransfer.files[0]);else{sequence++;verifiedUntil=0;status.textContent='請一次選擇一個 HTML';}};
 const verify=button('驗證身分',()=>busy(verify,authStatus,async()=>{check();verifiedUntil=0;const at=sequence,code=password.value;password.value='';await api.reauthenticate(code);check();if(at!==sequence)throw Error('檔案已變更');verifiedUntil=Date.now()+300000;authStatus.textContent='身分已驗證，有效五分鐘';}));
 const upload=button('上傳沙盒（服務待接通）',()=>{}),publish=button('發布正式版（服務待接通）',()=>{});upload.disabled=true;publish.disabled=true;
 root.replaceChildren(el('h1',{},'正式版／沙盒'),el('p',{},'目前為沙盒版 · Core v29.0.0'),el('a',{href:'https://jason27252725-cpu.github.io/leaves-system/',target:'_blank',rel:'noopener'},'開啟正式版'),input,drop,status,progress,el('h2',{},'最高管理員身分驗證'),password,verify,authStatus,el('div',{class:'li-actions'},upload,publish));
 const route=mountSiteRoute(root,api,{authorize:()=>{check();if(Date.now()>verifiedUntil)throw Error('請先驗證最高管理員身分');}});
 return{dispose(){disposed=true;sequence++;password.value='';route.dispose();root.replaceChildren();}};
}
