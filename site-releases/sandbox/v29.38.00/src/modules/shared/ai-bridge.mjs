// Adapt the authenticated JSON result to Core's existing chat reader.
export function validateChatResult(result){
 const code=result?.ok!==true||typeof result.text!=='string'?'AI_INVALID_RESPONSE':!result.text.trim()?'AI_EMPTY_RESPONSE':'';
 if(code)throw Object.assign(Error(code),{code});
 return result;
}
export function completionResponse(result){
 validateChatResult(result);
 const chunk={choices:[{index:0,delta:{content:result.text},finish_reason:null}],model:result.model};
 const finish={choices:[{index:0,delta:{},finish_reason:'stop'}],usage:result.usage||{}};
 return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify(finish)+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream','X-Leaves-Provider':['leaves/authorized-report','leaves/authorized-sop','leaves/authorized-month'].includes(result.model)?'leaves':'openrouter','X-Leaves-Model':typeof result.model==='string'&&/^[!-~]{1,200}$/.test(result.model)?result.model:''}});
}
