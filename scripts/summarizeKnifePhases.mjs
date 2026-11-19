import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

// Phases are capture-event timestamps, not estimates of handler CPU time. Never
// attribute a frame spanning a boundary to one of the adjacent phases alone.
const report=JSON.parse(readFileSync(process.argv[2],'utf8'))
for(const {round,mode,ms,phase:{start,events}} of report.rounds){
  const down=events.find(e=>e.type==='pointerdown')?.t
  const move=events.find(e=>e.type==='pointermove')?.t
  const up=events.find(e=>e.type==='pointerup')?.t
  assert(start<=down && down<=move && move<=up)
  const label=t=>t<down?'before':t<move?'down':t<up?'move':'release'
  let t=start; const groups={}
  for(const dt of ms){const left=label(t);t+=dt;const right=label(t);const key=left===right?left:`${left}→${right}`;(groups[key]??=[]).push(dt)}
  assert(t>=up)
  console.log(round,mode,Object.fromEntries(Object.entries(groups).map(([k,ds])=>[k,{n:ds.length,max:+Math.max(...ds).toFixed(1),over50:ds.filter(d=>d>50).length}])))
}
