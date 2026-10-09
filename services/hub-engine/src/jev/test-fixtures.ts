import { MODEL,QUESTIONS,type Scene } from './contracts.js';
export function fixture(scene:Scene){
 const answers:Record<string,unknown>={};
 for(const [k,q] of Object.entries(QUESTIONS[scene])){
  if(q.type==='noul'){answers[k]={type:'noul',noul:0.95};continue;}
  const keys=Array.isArray(q.criteria)?q.criteria.map((_,i)=>String(i)):Object.keys(q.criteria!);
  const selected=q.type==='score'?keys.at(-1)!:keys[0];
  answers[k]={type:q.type,confidence:.95,probabilities:Object.fromEntries(keys.map(x=>[x,x===selected?1:0])),...(q.type==='score'?{score:Number(selected)}:{choice:selected})};
 }
 return {model:MODEL,answers,usage:{input_tokens:150,output_tokens:0}};
}
