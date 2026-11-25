const documentWord=/s\s*o\s*p|作業(?:規章|規範|流程|手冊)|公司(?:規定|規範|手冊|制度)|組織架構|人員名冊|成員名單|公司成員修改|第[一二三四五六七八九十百零\d]+[章節]/i;
const editWord=/修[訂改該正]|更正|改[成為掉]|變更|更新|調整|補[入上充進]|增[列加補訂修]|新增|加入|加[進入上到]|[刪移]除|拿掉|取消這條|列入|應(?:該)?(?:要)?改|寫[進入]|換成|訂為/;
const pointing=/剛[才剛]|這[一個項條段裡句處]|那[一個項條段句裡處]|上(?:一[段條個則]|面)|前一(?:段|條)|原文|名單|漏[了掉]|少了|應該是|才對|要改/;
const personnel=/(?:建[立置]|開通|停用|新增|刪除|修改|調整|變更|給予|開一個).{0,16}(?:帳[號戶]|登入身分|通行碼|管理權限|系統權限)|(?:帳[號戶]|通行碼|系統權限).{0,16}(?:建[立置]|停用|修改|改成|改為|開通)/;
const readOnly=/^(?:請問|我想知道|告訴我|請說明|請解釋)?\s*(?:我要|我們要|同事要|可以)?(?:怎[麼樣]|如何|什麼人|誰(?:可以|能)|哪裡可以)|(?:有沒有|能不能|是否可以|可不可以|可否|可以).{0,12}(?:修改|新增|編輯).{0,18}(?:嗎|呢|[?？])\s*$|(?:有哪些改動|修改了什麼|最後修改|誰修改|何時修改|差在哪|怎麼規定)/;
const responseOnly=/(?:回答|回覆|答案|剛剛那段|上面的說明|這段話).{0,15}(?:寫短|短一點|精簡|白話|改寫|重講|重寫|改成表格|列點|口語)|(?:改寫|簡化|縮短|摘要|重寫|精簡|白話).{0,9}(?:回答|回覆|答案|剛剛那段)|(?:幫我改|改成).{0,3}(?:一句話|白話|表格|條列)/;
const operational=/進度表|工時|時數|月報表|報價單|試算表|專案建檔|建立專案|修改案件|排班|新增案件/;
export function revisionIntent(input,{source=false,draft=false,armed=false}={}) {
 const t=String(input||'').trim().normalize('NFKC');
 if(!t||t.length>4000||t.startsWith('/'))return 'normal';
 if(/^(?:查看|看看|開啟|打開|列出|查詢|我的|有哪些)?\s*(?:(?:SOP\s*)?(?:待審(?:核)?|待處理|我的)(?:的)?\s*(?:SOP\s*)?(?:修訂)?提案|SOP\s*提案(?:清單|列表|進度|狀態))[。?!\s]*$/i.test(t))return 'inbox';
 if(/(?:SOP|手冊).{0,8}(?:修訂歷[程史]|版本紀錄|版本歷史|版本記錄|還原版本)|(?:查看|查詢|還原).{0,6}SOP\s*(?:版本|歷史)/i.test(t))return 'history';
 if(draft&&/^(?:先不改了|取消(?:這個|這次|目前的)?(?:修訂|草稿)?|放棄草稿|結束修訂)[。!\s]*$/.test(t))return 'cancel';
 if(/(?:不要|不用|別|先不|無須)(?:幫我)?(?:修改|更新|修訂|變更|新增)\s*(?:公司)?\s*SOP/i.test(t))return 'normal';
 const doc=documentWord.test(t), edit=editWord.test(t);
 if(readOnly.test(t)&&!/[，,。；;\n]\s*(?:請|麻煩)(?:幫我)?(?:把|將|新增|修正|補上)/.test(t))return 'normal';
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
