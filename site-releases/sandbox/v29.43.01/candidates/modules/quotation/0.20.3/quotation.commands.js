const targetPattern = /(?:'((?:[^']|'')+)'|"([^"]+)"|「([^」]+)」|『([^』]+)』|([^\s!！"'：:，,、。；;「」『』【】（）()<>]+))\s*[!！]\s*(\$?[A-Z]{1,3}\$?[1-9]\d{0,5})(?![A-Z0-9_$])/gi;
const barePattern = /(?<![A-Z0-9_$])\$?([A-Z]{1,3})\$?([1-9]\d{0,5})(?![A-Z0-9_$])/gi;
const commandPrefix = /^(?:(?:請|先|再|你|妳|我想要|我想|我要|希望|想要|麻煩|可以|能不能|能否|協助|幫我們|幫我|替我|把|將|針對|檢查|診斷|核對|比對|重新計算|重算|修正|修改|修好|只看|僅看|只查|僅查|只|看一下|看|處理|一下|以及|還有|跟|與|和|及))+/u;

function targetError(code) {
 const message = code === 'X1_TARGET_UNAVAILABLE'
  ? '無法定位到唯一可見的客戶報價儲存格。請核對工作表名稱及位置。'
  : '請指定要核對的工作表與儲存格，例如「報價明細!C7」。多格可用頓號逐一列出。';
 return Object.assign(new Error(message), {code});
}

export function resolveCellTargets(input, {model, visibleSheets, accessible}) {
 const text = String(input ?? '');
 const visible = visibleSheets(model);
 const found = new Map();
 function locate(name, address) {
  const matches = visible.filter(sh => sh.name === name || sh.displayName === name);
  if(matches.length !== 1) throw targetError('X1_TARGET_UNAVAILABLE');
  const sheet = matches[0].name;
  try { accessible(model, sheet, address); }
  catch { throw targetError('X1_TARGET_UNAVAILABLE'); }
  found.set(JSON.stringify([sheet, address]), {sheet, address});
  return sheet;
 }

 // Remember spans so bare references in a mixed list are never lost.
 const masked = text.split('');
 const named = new Set();
 for (const match of text.matchAll(targetPattern)) {
  const [,excelQuoted,doubleQuoted,cornerQuoted,bookQuoted,plain,address] = match;
  let name = excelQuoted?.replace(/''/g, "'") ?? doubleQuoted ?? cornerQuoted ?? bookQuoted ?? plain;
  if (plain) {
   // Preserve real names starting with a verb. Never resolve an arbitrary suffix against a visible sheet.
   const before = text.slice(0, match.index);
   if (/['"「『]\s*$/.test(before)) throw targetError('X1_TARGET_INVALID');
   const end = before + plain;
   // A workbook can contain both "Room" and "Living Room"; choose the entire named sheet.
   const compound = model.sheets.flatMap(sh => [sh.name, sh.displayName])
    .filter(part => typeof part==='string' && /\S\s+\S/.test(part) && end.endsWith(part))
    .sort((a,b) => b.length-a.length)[0];
   const exact = model.sheets.some(sh => sh.name === name || sh.displayName === name);
   if(compound) name=compound;
   else if (!exact) name = name.replace(commandPrefix, '');
  }
  if(!name) throw targetError('X1_TARGET_INVALID');
  const cell = address.replace(/\$/g,'').toUpperCase();
  named.add(locate(name, cell));
  masked.fill(' ', match.index, match.index + match[0].length);
 }
 const remaining = masked.join('');
 const bare = [...remaining.matchAll(barePattern)].filter(match => !/(?:LEAVES(?:\s+AI)?|AI|SOP|模型|版本)\s*$/i.test(remaining.slice(0,match.index)) || !/^[XRV]\d+$/i.test(match[0]));
 const intended = /只(?:看|查|核對|檢查)|僅(?:看|查|核對|檢查)|指定(?:的)?(?:格|欄位|儲存格)/.test(text);
 const wholeSheet = /(?:只|僅)(?:看|查|核對|檢查)\s*(?:(?:目前|這張|此)工作表|(?:所有|全部)(?:可見)?(?:客戶)?工作表)(?:[。！!？?\s]|$)/.test(text);
 // Reject malformed explicit references as one request, including a malformed member in a valid list.
 const unresolved = remaining.replace(/#(?:REF|DIV\/0|VALUE|NUM|NULL)!/gi,'');
 const dangling = /[!！](?=\s*[\w$])|(?:表|明細|['"」』])[!！]\s*(?:$|[，,、；;])/.test(unresolved);
 const badAddress = /(?<![A-Z0-9_$])\$?[A-Z]{1,3}\$?(?:0\d*|\d{7,})(?![A-Z0-9_$])/i.test(remaining);
 const range = /\$?[A-Z]{1,3}\$?[1-9]\d*\s*[:：~～至到]\s*(?:(?:'(?:[^']|'')+'|[^\s!！,:：，、。；;]{1,80})\s*[!！]\s*)?\$?[A-Z]{1,3}\$?[1-9]\d*/i.test(text);
 if(dangling || range || (badAddress && (intended || found.size || bare.length)) || (bare.length && named.size > 1)) {
  throw targetError('X1_TARGET_INVALID');
 }
 const impliedSheet = named.size ? [...named][0] : model.activeSheet;
 for(const match of bare) locate(impliedSheet, (match[1] + match[2]).toUpperCase());
 if(found.size > 100 || (!found.size && intended && !wholeSheet)) throw targetError('X1_TARGET_INVALID');
 return [...found.values()];
}

// A deliberately small grammar for unambiguous cell edits. Other phrasing stays with the AI.
export function parseExplicitCellCommand(raw,{targetsFor,readCell}){
 let text=String(raw||'').trim().replace(/^[@＠](?:助手|assistant)\s*[:：]?/i,'');
 if(/^(?:請)?(?:不要|別|不必)/.test(text)||/(?:如果|假如|例如|比方|怎麼|如何|教我)/.test(text))return null;
 text=text.replace(/^(?:(?:請你|請妳|請|麻煩|幫我|替我|協助|把|將|我想要|我要)\s*)+/,'');
 const m=text.match(/^((?:'(?:[^']|'')+'|[^\s!，,。；;「」【】（）()]+)!\s*\$?[A-Z]{1,3}\$?[1-9]\d{0,5}|\$?[A-Z]{1,3}\$?[1-9]\d{0,5})\s*(?:的(?:項次|數量|單價|備註|內容|值))?\s*(?:由\s*(.+?)\s*)?(?:改成|改為|改到|設成|設為|設定為|調整為|變成)\s*(.+)$/i);
 if(!m)return null;
 let valueText=m[3].trim();
 // Only strip complete, known preview-only suffixes. Never ignore an unknown second instruction.
 valueText=valueText.replace(/(?:[，,；;。]\s*(?:只改這一格|只修改這一格|先預覽|先讓我確認修改(?:前後)?差異|先讓我確認(?:修改)?差異|先給我看(?:修改)?差異|先不要套用|不要直接套用|確認後再改))+[。！!\s]*$/,'').replace(/[。！!]$/,'').trim();
 const quoted=valueText.match(/^(?:「([\s\S]*)」|『([\s\S]*)』|"([^"\n]*)"|'([^'\n]*)')$/);
 const numeric=/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
 let value;
 if(quoted)value=quoted.slice(1).find(x=>x!==undefined);
 else if(numeric.test(valueText))value=Number(valueText.replace(/,/g,''));
 else return{question:'請把要填入的文字加上「引號」，或提供一個明確數字；多個操作請分開提出。尚未建立修改。'};
 const targets=targetsFor(m[1]);if(targets.length!==1)throw Error('請指定唯一工作表與儲存格');
 const target=targets[0],cell=readCell(target);
 if(m[2]!==undefined){const old=m[2].trim().replace(/^[「『"']|[」』"']$/g,'');const expected=numeric.test(old)?Number(old.replace(/,/g,'')):old;if(!Object.is(cell.value,expected)&&String(cell.value)!==old)throw Error('目前值與指令中的原值不一致，請重新核對後預覽');}
 return{version:1,summary:`預覽 ${target.sheet}!${target.address} 的明確修改`,question:'',steps:[{tool:'quotation.cell',args:{...target,value}}]};
}
