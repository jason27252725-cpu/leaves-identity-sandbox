const documentWord=/s\s*o\s*p|作業(?:規章|規範|流程|手冊)|公司(?:規定|規範|手冊|制度)|組織架構|人員名冊|成員名單|公司成員修改|第[一二三四五六七八九十百零\d]+[章節]/i;
const editWord=/修[訂改該正]|更正|改[成為掉]|變更|更新|調整|補[入上充進]|增[列加補訂修]|新增|加入|加[進入上到]|[刪移]除|拿掉|取消這條|列入|應(?:該)?(?:要)?改|寫[進入]|換成|訂為/;
const pointing=/剛[才剛]|這[一個項條段裡句處]|那[一個項條段句裡處]|上(?:一[段條個則]|面)|前一(?:段|條)|原文|名單|漏[了掉]|少了|應該是|才對|要改/;
const personnel=/(?:建[立置]|開通|停用|新增|刪除|修改|調整|變更|給予|開一個).{0,16}(?:帳[號戶]|登入身分|通行碼|管理權限|系統權限)|(?:帳[號戶]|通行碼|系統權限).{0,16}(?:建[立置]|停用|修改|改成|改為|開通)/;
const readOnly=/^(?:請問|我想知道|告訴我|請說明|請解釋)?\s*(?:我要|我們要|同事要|可以)?(?:怎[麼樣]|如何|什麼人|誰(?:可以|能)|哪裡可以)|(?:有沒有|能不能|是否可以|可不可以|可否|可以).{0,12}(?:修改|新增|編輯).{0,18}(?:嗎|呢|[?？])\s*$|(?:有哪些改動|修改了什麼|最後修改|誰修改|何時修改|差在哪|怎麼規定)/;
const responseOnly=/(?:回答|回覆|答案|剛剛那段|上面的說明|這段話).{0,15}(?:寫短|短一點|精簡|白話|改寫|重講|重寫|改成表格|列點|口語)|(?:改寫|簡化|縮短|摘要|重寫|精簡|白話).{0,9}(?:回答|回覆|答案|剛剛那段)|(?:幫我改|改成).{0,3}(?:一句話|白話|表格|條列)/;
const operational=/進度表|工時|時數|月報表|報價單|試算表|專案建檔|建立專案|修改案件|排班|新增案件/;
const revisionNoun='修[訂改該正]|增補|編輯|變更|更新|改版|提案|草稿|送審|審核|採納|發[布佈]|版本|還原';
const sopDocument='(?:s\\s*o\\s*p|(?:作業|公司)手冊)';
const revisionSubject=new RegExp(sopDocument+'\\s*(?:的|要|在網站上|本身)?\\s*(?:(?:要)?(?:怎[麼樣]|如何|能不能|可不可以)\\s*)?(?:改(?:[呢嗎？?]|$)|'+revisionNoun+')|(?:改|'+revisionNoun+')\\s*(?:這份|公司(?:的)?|我們的)?\\s*'+sopDocument,'i');
const workflowQuestion=/怎[麼樣]|如何|為何|為什麼|運作|操作(?:方式|方法|步驟|說明)|流程(?:說明|是什麼|為何|[？?]|$)|方式(?:為何|是什麼|[？?]|$)|教我|教學|誰(?:來|會|能|可以|負責)|哪(?:裡|個窗口)|什麼時候|什麼意思|會(?:發生|直接|自動|不會)|需要(?:誰|審核|主管|確認|經過誰)|有(?:什麼|哪些)步驟|(?:能不能|可不可以|是否可以|可以).*(?:嗎|[？?])$/;
const requestedWording=/(?:改[成為]|換成|訂為|新增[：:]|補(?:入|上|充)[：:]|修改[：:])\s*[^？?。!！\s]|(?:[，,。；;\n]|^)\s*(?:請|麻煩|幫我)(?:幫我)?\s*(?:把|將|在.{1,35}(?:新增|補上)|新增|修正|更新為)\s*\S/;
const feedback=/^(?:(?:但(?:是)?|可是|欸)[，,\s]*)?(?:(?:你|AI)?(?:剛[才剛])?(?:怎麼|為什麼)(?:會)?(?:這樣)?(?:回答|回覆|回我|答)|(?:你(?:的)?|AI(?:的)?|剛[才剛](?:的)?|上[一面](?:則|段)?(?:的)?|這(?:個|則|段))?\s*(?:回答|回覆|答案|答覆).{0,15}(?:怪|奇怪|答非所問|錯|不對|沒回答|怎麼來)|(?:我)?(?:怎麼|怎|總)?(?:感覺|覺得)(?:剛[才剛]|上面|這段|你)?(?:的)?(?:回答|回覆|答案|答覆)?.{0,8}(?:怪|不對|答非所問)|(?:(?:你|剛[才剛]|上面)?(?:說|回|答)的|這段|上面那段).{0,10}(?:怪|不對|答非所問)|(?:你)?(?:答非所問|會錯意)|(?:請)?(?:重新|再)(?:回答|說明|解釋)(?:一遍|一次|剛[才剛]的問題|前一題)?\s*[。！!？?]*$)/i;
function clean(input){return String(input||'').trim().normalize('NFKC');}
export function sopConversationKind(input,previous=null){
 const t=clean(input);
 if(!t||requestedWording.test(t))return null;
 if(feedback.test(t))return 'feedback';
 const relative=previous==='workflow'&&!operational.test(t)&&!/帳號|報表|通行碼|薪資/.test(t)&&/提案|草稿|送(?:審|出)|審核|發[布佈]|還原|看差異/.test(t);
 if((revisionSubject.test(t)||relative)&&(workflowQuestion.test(t)||relative&&/[呢嗎？?][。？?]*$/.test(t)))return 'workflow';
 return null;
}
export function revisionIntent(input,{source=false,draft=false,armed=false}={}) {
 const t=clean(input);
 if(!t||t.length>4000||t.startsWith('/'))return 'normal';
 if(sopConversationKind(t))return 'normal';
 if(/^(?:查看|看看|開啟|打開|列出|查詢|我的|有哪些)?\s*(?:(?:SOP\s*)?(?:待審(?:核)?|待處理|我的)(?:的)?\s*(?:SOP\s*)?(?:修訂)?提案|SOP\s*提案(?:清單|列表|進度|狀態))[。?!\s]*$/i.test(t))return 'inbox';
 if(/(?:SOP|手冊).{0,8}(?:修訂歷[程史]|版本紀錄|版本歷史|版本記錄|還原版本)|(?:查看|查詢|還原).{0,6}SOP\s*(?:版本|歷史)/i.test(t))return 'history';
 if(draft&&/^(?:先不改了|取消(?:這個|這次|目前的)?(?:修訂|草稿)?|放棄草稿|結束修訂)[。!\s]*$/.test(t))return 'cancel';
 if(/(?:不要|不用|別|先不|無須)(?:幫我)?(?:修改|更新|修訂|變更|新增)\s*(?:公司)?\s*SOP/i.test(t))return 'normal';
 const doc=documentWord.test(t), edit=editWord.test(t);
 if((readOnly.test(t)||/怎[麼樣]|如何|為什麼|該(?:填|寫|做|準備)什麼|填什麼|哪(?:個|些)(?:欄位|文件|資料)/.test(t))&&!requestedWording.test(t))return 'normal';
 if(responseOnly.test(t)&&!/(?:正式|寫入|更新|修改|修訂)\s*SOP|SOP\s*(?:原文|條文)/i.test(t))return 'normal';
 if(personnel.test(t))return doc&&edit?'ambiguous':'normal';
 if(doc&&edit)return 'edit';
 if(doc&&/(?:漏了|少了|寫錯|有誤|應該是|才對)/.test(t))return 'edit';
 if(operational.test(t)&&!doc)return 'normal';
 if(source&&((edit&&pointing.test(t))||/漏了|寫錯|有誤|才對|應該(?:是|為)|也(?:要)?加(?:入|上)/.test(t)))return 'edit';
 if(edit&&/設計師|成員|同事|職稱|同仁|主管|員工|工程師|會計/.test(t))return source||draft?'edit':'ambiguous';
 if(draft&&!/^(?:請問|查詢|請查|列出|誰|哪些|幾個|告訴我)|[?？]$/.test(t)&&(/^(?:好[，,、 ]*(?:再|也|還|補)|另外|再|改|保留|只|也|補|同時|應|換|調整|用|放在|第|寫|請把|剛|原來|維持|取消|是指|我指|我的意思)/.test(t)||edit||pointing.test(t)))return 'edit';
 if(edit&&/(?:流程|章節|條文|規範|作業手冊|這條規定)/.test(t))return 'edit';
 // Indirect corrections go to the model with conversation context.
 if(!/[?？]$|誰|哪些|幾個|為什麼|是什麼|想了解|請介紹/.test(t)&&
   (doc||source||draft||/手冊|規則|名冊|這段|那段|作業規定/.test(t))&&
   /跟現況|與現況|已過時|過時了|早就|現行做法|現在(?:都|是|已)|漏寫|漏列|應列|對不上|還停在|已經改|應納入|還沒寫|還少|其實|另外一款|新版規定|這樣才準|不再適用|漏掉了|才是|以後(?:都|要)|從下.{0,4}起/.test(t))return 'interpret';
 if(armed&&!/^(?:請問|為什麼|誰|哪|幾|查詢|列出|回報錯誤)|[?？]$/.test(t))return 'interpret';
 return 'normal';
}
export function usesRevisionReference(input){
 const t=clean(input);
 return /(?:這|那)[一個項條段句處]\s*(?:公司\s*)?SOP/i.test(t)||pointing.test(t)&&!documentWord.test(t);
}
