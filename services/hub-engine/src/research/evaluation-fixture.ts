export type FrozenMaterial = {id:string;eventKey?:string;body:string;[key:string]:unknown};
export type FrozenWindow = {date:string;snapshot:{topItems:Array<{id:string}>}};
/** Keep stable keys where possible; only split clusters that cross historical windows. */
export function groupFrozenMaterials(materials:FrozenMaterial[],windows:FrozenWindow[]) {
 const grouped=new Map<string,FrozenMaterial[]>();
 const dates=new Map<string,string>();
 for(const material of materials){
  if(dates.has(material.id))throw new Error('duplicate_material:'+material.id);
  const matches=windows.filter(w=>w.snapshot.topItems.some(item=>item.id===material.id));
  if(matches.length!==1)throw new Error('ambiguous_material_window:'+material.id);
  dates.set(material.id,matches[0].date);
  const key=material.eventKey||material.id;
  grouped.set(key,[...(grouped.get(key)||[]),material]);
 }
 const result=new Map<string,FrozenMaterial[]>();
 for(const [key,rows] of grouped){
  const partitions=new Map<string,FrozenMaterial[]>();
  for(const row of rows){const date=dates.get(row.id)!;partitions.set(date,[...(partitions.get(date)||[]),row]);}
  for(const [date,partition] of partitions){
   const resultKey=partitions.size>1?key+'@'+date:key;
   if(result.has(resultKey))throw new Error('event_key_collision');
   result.set(resultKey,partition);
  }
 }
 return {groups:result,dates};
}
