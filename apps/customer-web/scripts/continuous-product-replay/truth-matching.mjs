const order = (a,b) => a.timeMs-b.timeMs || a.id.localeCompare(b.id);
export const percentile = (values,q) => values.length ? [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(q*values.length)-1)] : null;

/** Independent chronological dynamic programming, never imported by production. */
export function matchTruth(truth, observations) {
  const pairs = [];
  for (const pitch of [...new Set(truth.map(n=>n.pitch))].sort((a,b)=>a-b)) {
    const a=truth.filter(n=>n.pitch===pitch).sort(order), b=observations.filter(n=>n.pitch===pitch).sort(order);
    const table=Array.from({length:a.length+1},()=>Array(b.length+1));
    const better=(x,y)=>!y || x.count>y.count || x.count===y.count && (x.error<y.error || x.error===y.error && x.key<y.key);
    table[0][0]={count:0,error:0,key:'',pairs:[]};
    for(let i=0;i<=a.length;i++) for(let j=0;j<=b.length;j++) {
      const state=table[i][j]; if(!state)continue;
      const put=(x,y,v)=>{if(better(v,table[x][y]))table[x][y]=v;};
      if(i<a.length)put(i+1,j,state); if(j<b.length)put(i,j+1,state);
      if(i<a.length&&j<b.length&&Math.abs(a[i].timeMs-b[j].timeMs)<=250) {
        const pair={truthId:a[i].id,observationId:b[j].id,pitch,errorMs:b[j].timeMs-a[i].timeMs};
        put(i+1,j+1,{count:state.count+1,error:state.error+Math.abs(pair.errorMs),key:state.key+'|'+a[i].id+':'+b[j].id,pairs:[...state.pairs,pair]});
      }
    }
    pairs.push(...table[a.length][b.length].pairs);
  }
  const matchedTruth=new Set(pairs.map(p=>p.truthId)), matchedObs=new Set(pairs.map(p=>p.observationId));
  const signed=pairs.map(p=>p.errorMs), absolute=signed.map(Math.abs);
  return {truthCount:truth.length,observationCount:observations.length,matchedCount:pairs.length,
    missedCount:truth.length-pairs.length,unmatchedCount:observations.length-pairs.length,
    precision:observations.length?pairs.length/observations.length:null,recall:truth.length?pairs.length/truth.length:null,
    signedTiming:{median:percentile(signed,.5),p95:percentile(signed,.95),min:signed.length?Math.min(...signed):null,max:signed.length?Math.max(...signed):null},
    absoluteTiming:{median:percentile(absolute,.5),p95:percentile(absolute,.95),max:absolute.length?Math.max(...absolute):null},
    pairs,missedIds:truth.filter(n=>!matchedTruth.has(n.id)).map(n=>n.id),unmatchedIds:observations.filter(n=>!matchedObs.has(n.id)).map(n=>n.id)};
}
