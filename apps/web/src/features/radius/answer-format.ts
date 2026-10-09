// Remove redundant machine citation markers only when the evidence ID is known.
// The structured citation links remain visible and the stored draft stays unchanged.
export function readableEvidenceText(text:string,citationIds:string[]){
 const known=new Set(citationIds);
 return text.replace(/\[([0-9a-f-]{36})\]/gi,(marker,id:string)=>known.has(id)?'':marker).replace(/ {2,}/g,' ').trim();
}
