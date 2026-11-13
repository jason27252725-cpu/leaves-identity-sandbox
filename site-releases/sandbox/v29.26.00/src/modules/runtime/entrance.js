(function(){
 'use strict';
 const style=document.createElement('style');style.textContent=`
 .le-boot{position:fixed;inset:0;z-index:2147483647;background:#161615;color:#e8e5df;display:grid;place-items:center;font-family:system-ui,"Microsoft JhengHei",sans-serif}
 .le-brand{width:min(280px,72vw);text-align:center}.le-brand strong{display:block;font-size:16px;font-weight:400;letter-spacing:.38em;white-space:nowrap}.le-brand small{display:block;margin:12px 0 48px;color:#96938d;font-size:12px;letter-spacing:.35em}
 .le-track{height:2px;background:#454440;overflow:hidden}.le-fill{height:100%;width:100%;background:#e8e5df;transform:scaleX(0);transform-origin:left}.le-percent{display:block;margin-top:16px;font-size:11px;letter-spacing:.25em;color:#bbb7af;font-variant-numeric:tabular-nums}
 .le-boot{transition:opacity .25s}.le-boot.le-out{opacity:0;pointer-events:none}.le-retry{display:block;margin:22px auto 0;background:none;color:#ddd;border:1px solid #555;border-radius:6px;padding:8px 18px}
 .le-spin{display:inline-block;width:18px;height:18px;border:2px solid #17171735;border-top-color:#171717;border-radius:50%;animation:le-spin .8s linear infinite;vertical-align:middle;margin-right:10px}
 @keyframes le-spin{to{transform:rotate(360deg)}}
 body.le-login-pending #authModal{display:flex!important;opacity:1!important;visibility:visible!important}body.le-login-pending #authCard{display:block!important}
 
 #enterSystemBtn.le-login-complete{display:flex;align-items:center;justify-content:center;height:52px;min-height:52px;padding-top:0;padding-bottom:0;overflow:hidden}
 #enterSystemBtn.le-login-complete leaves-success{display:inline-flex;width:44px;height:44px;flex:none}
 body.le-login-pending #authModal.le-auth-exit{opacity:0!important;transition:opacity .6s ease!important;pointer-events:none!important}
 .le-exit-label{font-size:11px;color:#96938d;margin-top:14px;letter-spacing:.12em}
 @media(prefers-reduced-motion:reduce){body.le-login-pending #authModal.le-auth-exit{transition:opacity .1s!important}}
 #authLoginProgressWrapper{display:none!important}
 @media(prefers-reduced-motion:reduce){.le-spin{animation-duration:2s}.le-boot{transition:none}}
 `;document.head.append(style);
 let boot,frame,shown=0,done=false,failed=false,busy=false,buttonNode,meterResolve;
 const key='leaves-boot-start';let started=Date.now();try{const saved=Number(sessionStorage.getItem(key));if(saved&&Date.now()-saved<60000)started=saved;sessionStorage.removeItem(key);}catch{}
 function startBoot(label="",exiting=false){
  cancelAnimationFrame(frame);boot?.remove();shown=0;done=false;failed=false;if(exiting)started=Date.now();
  boot=document.createElement('div');boot.className='le-boot';boot.setAttribute('role','status');boot.setAttribute('aria-label','正在載入拾葉設計');
  boot.innerHTML='<div class="le-brand"><strong>LEAVES DESIGN</strong><small>拾葉設計</small><div class="le-track" role="progressbar" aria-label="網站載入進度" aria-valuemin="0" aria-valuemax="100"><div class="le-fill"></div></div><span class="le-percent">0%</span></div>';document.body.append(boot);if(label){const status=document.createElement('div');status.className='le-exit-label';status.textContent=label;boot.querySelector('.le-brand').append(status);}
  let last=performance.now();const tick=now=>{const dt=Math.min(64,now-last);last=now;const target=done?100:Math.min(94,94*(1-Math.exp(-(Date.now()-started)/2000)));shown=Math.max(shown,Math.min(target,shown+Math.max(.15,(target-shown)*dt/100)));
   boot.querySelector('.le-fill').style.transform='scaleX('+shown/100+')';boot.querySelector('.le-percent').textContent=Math.floor(shown)+'%';boot.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(Math.floor(shown)));
   if(done&&shown>=99.8){boot.querySelector('.le-percent').textContent='100%';boot.querySelector('.le-fill').style.transform='scaleX(1)';boot.querySelector('[role=progressbar]').setAttribute('aria-valuenow','100');setTimeout(()=>{boot.classList.add('le-out');setTimeout(()=>{boot.remove();meterResolve?.();meterResolve=null;},260);},120);return;}if(!failed)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
 }
 function bootError(){failed=true;cancelAnimationFrame(frame);if(!boot)return;const text=boot.querySelector('.le-percent');text.textContent='載入未完成';const b=document.createElement('button');b.className='le-retry';b.textContent='重新載入';b.onclick=()=>location.reload();boot.querySelector('.le-brand').append(b);}
 function begin(button){buttonNode=button;busy=true;document.body.classList.add('le-login-pending');button.setAttribute('aria-busy','true');button.innerHTML='<span class="le-spin" aria-hidden="true"></span>登入中';window.LeavesSuccess?.unlockAudio().catch(()=>{});}
 async function success(){
  const button=buttonNode||document.getElementById('enterSystemBtn');
  button.setAttribute('aria-label','登入成功');button.classList.add('le-login-complete');
  const widget=document.createElement('leaves-success');widget.setAttribute('color','#191919');widget.setAttribute('size','44');
  button.replaceChildren(widget);
  if(widget.play)await widget.play({sound:true,volume:.4});
  else{button.textContent='✓';await new Promise(r=>setTimeout(r,300));}
  const modal=document.getElementById('authModal');
  if(modal){modal.classList.add('le-auth-exit');await new Promise(r=>setTimeout(r,window.matchMedia('(prefers-reduced-motion: reduce)').matches?100:600));}
 }
 function end(){busy=false;document.body.classList.remove('le-login-pending');document.getElementById('authModal')?.classList.remove('le-auth-exit');buttonNode?.classList.remove('le-login-complete');buttonNode=null;document.getElementById('enterSystemBtn')?.removeAttribute('aria-busy');document.getElementById('enterSystemBtn')?.removeAttribute('aria-label');}
 function startExit(){startBoot('正在退出工作區',true);}
 function finishExit(){return new Promise(resolve=>{meterResolve=resolve;done=true;});}

 window.LeavesEntrance={startBoot,startExit,finishExit,finishBoot(){done=true;},bootError,begin,success,end,get busy(){return busy;}};
})();
