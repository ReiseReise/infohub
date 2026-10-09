import { MODEL, QUESTIONS, validate, type Scene } from './contracts.js';
export function payload(scene:Scene,state:unknown) {return {model:MODEL,state,questions:QUESTIONS[scene]};}
export async function callJev(scene:Scene,state:unknown,key:string,fetcher:typeof fetch=fetch) {
 if(!key)throw Error('missing_credential');
 let response:Response;
 try{response=await fetcher('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload(scene,state)),signal:AbortSignal.timeout(3000),redirect:'error'});}catch{throw Error('request_unknown');}
 if(!response.ok)throw Error(response.status===429?'rate_limited':'provider_failed');
 const text=await response.text();if(text.length>100000)throw Error('invalid_response');
 let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('invalid_response');}
 return validate(raw,scene);
}
