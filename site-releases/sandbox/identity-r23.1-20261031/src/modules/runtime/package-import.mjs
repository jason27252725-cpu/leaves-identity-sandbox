// Read only selected ZIP entries locally. No imported JavaScript is evaluated.
export async function readUpdateArchive(file){
 if(file.size>32*1048576)throw Error('更新包超過 32 MB，請使用個別模組包');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!file.name.toLowerCase().endsWith('.zip'))return{packages:[JSON.parse(new TextDecoder().decode(bytes))]};
 const v=new DataView(bytes.buffer),entries=new Map();let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('不支援的 ZIP 結構');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);if(count>2000||count===65535)throw Error('ZIP 項目過多');let p=start;
 for(let i=0;i<count;i++){if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw Error('ZIP 清單損壞');const n=v.getUint16(p+28,true),x=v.getUint16(p+30,true),c=v.getUint16(p+32,true),name=new TextDecoder().decode(bytes.slice(p+46,p+46+n));if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||entries.has(name))throw Error('ZIP 路徑不安全或重複');entries.set(name,{method:v.getUint16(p+10,true),flags:v.getUint16(p+8,true),size:v.getUint32(p+24,true),compressed:v.getUint32(p+20,true),offset:v.getUint32(p+42,true)});p+=46+n+x+c;}
 let expanded=0;
 async function read(name){const e=entries.get(name);if(!e||e.flags&1||e.size>24*1048576||expanded+e.size>64*1048576||![0,8].includes(e.method))throw Error('ZIP 檔案超限或格式不支援');const a=e.offset;if(a+30>start||v.getUint32(a,true)!==0x04034b50)throw Error('ZIP 檔案標頭損壞');const s=a+30+v.getUint16(a+26,true)+v.getUint16(a+28,true);if(s+e.compressed>start)throw Error('ZIP 檔案超出範圍');let data=bytes.slice(s,s+e.compressed);if(e.method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>e.size){await reader.cancel();throw Error('ZIP 解壓大小不符');}parts.push(r.value);}data=new Uint8Array(size);let at=0;for(const b of parts){data.set(b,at);at+=b.length;}}if(data.length!==e.size)throw Error('ZIP 檔案大小不符');expanded+=data.length;return data;}
 const packages=[],decode=b=>JSON.parse(new TextDecoder().decode(b));
 const packagePaths=[...entries.keys()].filter(n=>/(?:^|\/)packages\/(?:identity|workforce|quantity|quotation|assistant)-[^/]+\.json$/.test(n));
 if(packagePaths.length){if(packagePaths.length>10)throw Error('更新包內有過多模組');for(const path of packagePaths)packages.push(decode(await read(path)));}
 else{const receipts=[...entries.keys()].filter(n=>n.endsWith('.leaves-update.json'));if(receipts.length!==1)throw Error('請選完整更新包，或含 .leaves-update.json 的單一模組 ZIP');const receipt=decode(await read(receipts[0])),prefix=receipts[0].slice(0,-'.leaves-update.json'.length),files=[];if(!Array.isArray(receipt.package?.files)||receipt.package.files.length>64)throw Error('模組清單不完整');for(const f of receipt.package.files){const b=await read(prefix+f.path);let binary='';for(let i=0;i<b.length;i+=8192)binary+=String.fromCharCode(...b.subarray(i,i+8192));files.push({path:f.path,base64:btoa(binary)});}packages.push({...receipt,files});}
 const sites=[...entries.keys()].filter(n=>/dist\/site-releases\/sandbox\/[^/]+\/site-manifest.json$/.test(n));
 return{packages,site:sites.length===1?decode(await read(sites[0])):null};
}
