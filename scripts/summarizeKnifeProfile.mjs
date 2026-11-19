import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
const {traceEvents:ev}=JSON.parse(gunzipSync(readFileSync(process.argv[2])))
const start=ev.find(e=>e.name==='knife-profile-start' && e.ts), end=ev.find(e=>e.name==='knife-profile-end' && e.ts)
assert(start && end && end.ts>start.ts)
let lo=start.ts,hi=end.ts,frame
if(process.argv[3]){
  // The profiler runs on the second hit gesture. Map its rAF timestamps to
  // the trace clock with the user-timing event from that same document.
  const bench=JSON.parse(readFileSync(process.argv[3],'utf8'))
  const index=bench.rounds.findIndex(r=>r.round===2 && r.mode==='hit');assert(index>=0)
  const {ms,phase}=bench.rounds[index], moves=phase.events.filter(e=>e.type==='pointermove')
  const up=phase.events.find(e=>e.type==='pointerup').t
  let t=phase.start
  for(const dt of ms){if(t>=moves[0].t && t+dt<=up && (!frame || dt>frame.ms))frame={start:t,end:t+dt,ms:dt};t+=dt}
  assert(frame);const offset=start.ts-start.args.data.startTime*1000
  lo=offset+1000*frame.start;hi=offset+1000*frame.end;assert(lo>=start.ts && hi<=end.ts)
  frame.refreshMs=bench.batchEvidence[index].refreshIntervals.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,frame.end)-Math.max(a,frame.start)),0)
}
const labels=new Map(ev.filter(e=>e.name==='thread_name').map(e=>[`${e.pid}:${e.tid}`,e.args.name]))
const threads=new Map()
for(const e of ev){if(e.ph!=='X'||!e.dur||e.ts>=hi||e.ts+e.dur<=lo)continue
 const id=`${e.pid}:${e.tid}`;if(!threads.has(id))threads.set(id,[])
 threads.get(id).push({name:e.name,a:Math.max(lo,e.ts),b:Math.min(hi,e.ts+e.dur)})}
// Charge each slice once to the innermost complete event, independently per thread.
const rows=[]
for(const [id,items] of threads){ const times=new Map(),stack=[];let last=lo
 const charge=t=>{if(stack.length && t>last){const k=stack.at(-1).name;times.set(k,(times.get(k)??0)+t-last)}last=t}
 for(const it of items.sort((x,y)=>x.a-y.a||y.b-x.b)){while(stack.length&&stack.at(-1).b<=it.a){charge(stack.at(-1).b);stack.pop()}if(stack.length && it.b>stack.at(-1).b)continue;charge(it.a);stack.push(it)}
 while(stack.length){charge(stack.at(-1).b);stack.pop()}
 const top=[...times].sort((a,b)=>b[1]-a[1]); rows.push({id,thread:labels.get(id),totalMs:Math.round(top.reduce((s,t)=>s+t[1],0)/1000),top:top.slice(0,8).map(([k,t])=>[k,Math.round(t/1000)])})
}
console.log(JSON.stringify({frame,wallMs:Math.round((hi-lo)/1000),main:`${start.pid}:${start.tid}`,threads:rows.sort((a,b)=>b.totalMs-a.totalMs).slice(0,14)},null,2))
