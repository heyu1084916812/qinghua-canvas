import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

// Opt-in fixture: locally installed Windows wallpaper files; never copy them into Git.
export async function knifePhotoBench(page,pid,out) {
  await page.setViewportSize({width:2400,height:1500}); const nodes=[], hashes=new Set(), files=[]
  for(let n=20;n<36;n++) files.push(join(process.env.SystemRoot,'Web','Wallpaper','Theme'+'ABCD'[Math.floor((n-20)/4)],`img${n}.jpg`))
  const edgeCount=Number(process.env.KNIFE_EDGE_COUNT ?? 50); assert([50,200,500].includes(edgeCount))
  const tracing=process.env.KNIFE_TRACE==='1'; if(tracing) await (await import('./knifeTrace.mjs')).installKnifeTrace(page)
  const canvasUrl=page.url(); await page.goto(new URL('/projects',canvasUrl).href)
  for(const [i,file] of files.entries()){
    const bytes=readFileSync(file), hash=createHash('sha1').update(bytes).digest('hex'); hashes.add(hash)
    const id=`${pid}-photo-${i}`; nodes.push(id)
    await page.evaluate(async ({b64,hash,id,i,pid})=>{
      const {createSharedStorage}=await import('/src/platform/web/sharedStorage.ts');const db=createSharedStorage()
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)), image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}))
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.round(640*image.height/image.width)
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height)
      const thumb=new Uint8Array(await (await new Promise(ok=>canvas.toBlob(ok,'image/webp',0.86))).arrayBuffer())
      const h=hash.slice(0,16),size={width:image.width,height:image.height};image.close()
      await db.put('assets',{id:h,hash:h,projectId:pid,mime:'image/jpeg',thumbMime:'image/webp',...size,bytesLength:bytes.length,thumbLength:thumb.length,contentSha1:hash,bytes,thumb,createdAt:Date.now(),updatedAt:Date.now()})
      await db.put('nodes',{id,projectId:pid,type:'generation',parentId:null,x:[200,620,1220,1640][Math.floor(i/4)],y:130+(i%4)*270,w:320,h:200,title:`photo ${i}`,disabled:false,data:{mode:'image',prompt:'',channelId:'',model:'',linkedPromptNodeIds:[],assetHash:h,assetMime:'image/jpeg',naturalSize:size,thumbOrder:[h],upstreamHidden:[]}})
    },{b64:bytes.toString('base64'),hash,id,i,pid})
  }
  assert.equal(hashes.size,16)
  await page.evaluate(async ({nodes,pid,edgeCount})=>{
    const {createSharedStorage}=await import('/src/platform/web/sharedStorage.ts');const db=createSharedStorage()
    for(const e of await db.query('edges',{projectId:pid}))await db.delete('edges',e.id)
    for(const n of await db.query('nodes',{projectId:pid}))if(!nodes.includes(n.id)) await db.delete('nodes',n.id)
    const left=nodes.slice(0,8),right=nodes.slice(8)
    // 23x23 unique directed pairs; all cross the same clear centre corridor.
    if(edgeCount>50) for(let i=0;i<15;i++) for(const [side,bank,x] of [['left',left,8],['right',right,2020]]){
      const id=`${pid}-${side}-${i}`;bank.push(id)
      await db.put('nodes',{id,projectId:pid,type:'prompt',parentId:null,x,y:150+i*65,w:100,h:50,title:side+i,disabled:false,data:{text:'test'}})
    }
    for(let j=0;j<edgeCount;j++)await db.put('edges',{projectId:pid,id:`${pid}-bench-${j}`,source:left[j%left.length],target:right[(Math.floor(j/left.length)+j%left.length)%right.length]})
  },{nodes,pid,edgeCount}); await page.goto(canvasUrl); await page.locator(`[data-edge="${pid}-bench-${edgeCount-1}"]`).waitFor({state:'attached'})
  await page.waitForFunction(nodes=>nodes.every(id=>{const i=document.querySelector(`[data-node-id="${id}"] img`);return i?.complete&&i.naturalWidth>0}),nodes)
  const evidence=await page.evaluate(nodes=>nodes.map(id=>{const i=document.querySelector(`[data-node-id="${id}"] img`),r=i.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:i.naturalWidth,height:i.naturalHeight,visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-node-id]')?.dataset.nodeId===id}}),nodes)
  assert(evidence.every(i=>i.visible),JSON.stringify(evidence));const ids=()=>page.locator('[data-edge]').evaluateAll(es=>es.map(e=>e.dataset.edge).sort());const baseline=await ids();assert.equal(baseline.length,edgeCount)
  const b=await page.locator('[data-edge]').evaluateAll(es=>{const rs=es.map(e=>e.getBoundingClientRect());return {x:(Math.max(...rs.map(r=>r.left))+Math.min(...rs.map(r=>r.right)))/2,top:Math.min(...rs.map(r=>r.top)),bottom:Math.max(...rs.map(r=>r.bottom))}})
  // Diagnostic control only: same hit tests, graph and FX, skip rasterizing the severed-line SVG.
  const hideCutPreview=process.env.KNIFE_NO_PREVIEW_PAINT==='1'
  if(hideCutPreview) await page.addStyleTag({content:'svg[data-edge-cut]{display:none!important}'})
  const report={hideCutPreview,timing:"from before pointerdown through two post-pointerup animation frames",edgeCount,sourceHashes:[...hashes],evidence,b,rounds:[]};const save=()=>writeFileSync(out,JSON.stringify(report,null,2))
  for(let round=1;round<=3;round++)for(const mode of ['miss','hit']){
    if(tracing) await page.evaluate(()=>{window.knifeMoves=[];window.pointerTrace=[];window.knifeListener=e=>window.pointerTrace.push([e.type,e.clientX,e.clientY,e.buttons]); for(const name of ['pointerdown','pointermove','pointerup']) window.addEventListener(name,window.knifeListener,true)})
    const x=b.x,y=b.top-20;await page.mouse.move(x,y);await page.keyboard.down('Space');await page.locator('[data-knife-cursor]').waitFor({state:'attached'})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(t=>{
      window.samples=[];window.knifePhase={start:t,events:[]};let last=t
      window.phaseListener=e=>window.knifePhase.events.push({type:e.type,t:performance.now()})
      for(const name of ['pointerdown','pointermove','pointerup']) window.addEventListener(name,window.phaseListener,true)
      const tick=n=>{window.samples.push(n-last);last=n;window.frame=requestAnimationFrame(tick)}
      window.frame=requestAnimationFrame(tick);resolve()
    })))
    const stopProfile=round===2 && mode==='hit' && process.env.KNIFE_PROFILE ? await (await import('./knifeProfile.mjs')).startKnifeProfile(page,process.env.KNIFE_PROFILE) : null
    if(stopProfile) await page.evaluate(()=>performance.mark('knife-profile-start'))
    await page.mouse.down();await page.mouse.move(mode==='miss'?x+120:x,mode==='miss'?y:b.bottom+20,{steps:48});await page.mouse.up()
    const {ms,phase}=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      cancelAnimationFrame(window.frame)
      for(const name of ['pointerdown','pointermove','pointerup']) window.removeEventListener(name,window.phaseListener,true)
      resolve({ms:window.samples,phase:window.knifePhase})
    }))));if(stopProfile){await page.evaluate(()=>performance.mark('knife-profile-end'));await stopProfile()}await page.keyboard.up('Space');await page.waitForTimeout(300)
    const after=await ids(),sorted=[...ms].sort((a,b)=>a-b);report.rounds.push({round,mode,ms,phase,p95:sorted[Math.ceil(.95*ms.length)-1],max:sorted.at(-1),remaining:after});if(tracing){
      const trace=await page.evaluate(()=>{for(const name of ['pointerdown','pointermove','pointerup'])window.removeEventListener(name,window.knifeListener,true);return {moves:window.knifeMoves,pointer:window.pointerTrace}})
      assert(trace.moves.length>0,'instrumented module not active');report.rounds.at(-1).trace=trace
    }save();assert(ms.length>=10);if(mode==='miss') assert.deepEqual(after,baseline)
    if(mode==='hit'){await page.keyboard.press('Control+z');await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline)}
  }
  assert(report.rounds.every(r=>r.mode!=='hit'||r.remaining.length===0),'挥刀后仍有预期命中边残留，见报告')
  console.log('real-photo benchmark',report.rounds.map(({mode,p95,max})=>({mode,p95,max})))
}
