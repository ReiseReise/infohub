export type JevFoldCandidate={target_id:string;peer_id?:string|null;status:string;suggestion?:{action?:string}|null};
/** Only disjoint pairs: no transitive inference and no A/B cycle hiding both. */
export function jevFoldedTargets(rows:JevFoldCandidate[]):Set<string>{
 const hidden=new Set<string>(),anchors=new Set<string>();
 const pairs=rows.filter(r=>r.status==='suggested'&&r.suggestion?.action==='collapse_preview'&&r.peer_id&&r.peer_id!==r.target_id)
  .map(r=>[r.target_id,r.peer_id!].sort()).sort((a,b)=>a.join().localeCompare(b.join()));
 for(const [anchor,peer] of pairs){if(hidden.has(anchor)||anchors.has(peer)||anchors.has(anchor)||hidden.has(peer))continue;anchors.add(anchor);hidden.add(peer);}
 return hidden;
}
