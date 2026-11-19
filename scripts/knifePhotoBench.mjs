import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

// Opt-in fixture: locally installed Windows wallpaper files; never copy them into Git.
export async function knifePhotoBench(page,pid,out,releasePut=null) {
  await page.setViewportSize({width:2400,height:1500}); const nodes=[], hashes=new Set(), files=[]
  for(let n=20;n<36;n++) files.push(join(process.env.SystemRoot,'Web','Wallpaper','Theme'+'ABCD'[Math.floor((n-20)/4)],`img${n}.jpg`))
  const edgeCount=Number(process.env.KNIFE_EDGE_COUNT ?? 50); assert([50,200,500].includes(edgeCount))
  const tracing=process.env.KNIFE_TRACE==='1'; if(tracing) await (await import('./knifeTrace.mjs')).installKnifeTrace(page)
  if(releasePut) await page.exposeFunction('knifeFixturePut',releasePut)
  const canvasUrl=page.url(); await page.goto(new URL('/projects',canvasUrl).href)
  for(const [i,file] of files.entries()){
    const bytes=readFileSync(file), hash=createHash('sha1').update(bytes).digest('hex'); hashes.add(hash)
    const id=`${pid}-photo-${i}`; nodes.push(id)
    await page.evaluate(async ({b64,hash,id,i,pid})=>{
      const db=window.knifeFixturePut ? {put:window.knifeFixturePut} : (await import('/src/platform/web/sharedStorage.ts')).createSharedStorage()
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)), image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}))
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.round(640*image.height/image.width)
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height)
      const thumb=new Uint8Array(await (await new Promise(ok=>canvas.toBlob(ok,'image/webp',0.86))).arrayBuffer())
      const h=hash.slice(0,16),size={width:image.width,height:image.height};image.close()
      await db.put('assets',{id:h,hash:h,projectId:pid,mime:'image/jpeg',thumbMime:'image/webp',...size,bytesLength:bytes.length,thumbLength:thumb.length,contentSha1:hash,bytes:window.knifeFixturePut?{__qhType:'u8',base64:b64}:bytes,thumb:window.knifeFixturePut?{__qhType:'u8',base64:btoa(Array.from(thumb,c=>String.fromCharCode(c)).join(''))}:thumb,createdAt:Date.now(),updatedAt:Date.now()})
      await db.put('nodes',{id,projectId:pid,type:'generation',parentId:null,x:[200,620,1220,1640][Math.floor(i/4)],y:130+(i%4)*270,w:320,h:200,title:`photo ${i}`,disabled:false,data:{mode:'image',prompt:'',channelId:'',model:'',linkedPromptNodeIds:[],assetHash:h,assetMime:'image/jpeg',naturalSize:size,thumbOrder:[h],upstreamHidden:[]}})
    },{b64:bytes.toString('base64'),hash,id,i,pid})
  }
  assert.equal(hashes.size,16)
  await page.evaluate(async ({nodes,pid,edgeCount})=>{
    const db=window.knifeFixturePut ? {put:window.knifeFixturePut} : (await import('/src/platform/web/sharedStorage.ts')).createSharedStorage()
    if(!window.knifeFixturePut) for(const e of await db.query('edges',{projectId:pid}))await db.delete('edges',e.id)
    if(!window.knifeFixturePut) for(const n of await db.query('nodes',{projectId:pid}))if(!nodes.includes(n.id)) await db.delete('nodes',n.id)
    const left=nodes.slice(0,8),right=nodes.slice(8)
    // 23x23 unique directed pairs; all cross the same clear centre corridor.
    if(edgeCount>50) for(let i=0;i<15;i++) for(const [side,bank,x] of [['left',left,8],['right',right,2020]]){
      const id=`${pid}-${side}-${i}`;bank.push(id)
      await db.put('nodes',{id,projectId:pid,type:'prompt',parentId:null,x,y:150+i*65,w:100,h:50,title:side+i,disabled:false,data:{text:'test'}})
    }
    for(let j=0;j<edgeCount;j++)await db.put('edges',{projectId:pid,id:`${pid}-bench-${j}`,source:left[j%left.length],target:right[(Math.floor(j/left.length)+j%left.length)%right.length]})
  },{nodes,pid,edgeCount}); await page.goto(canvasUrl); await page.locator(`[data-edge="${pid}-bench-${edgeCount-1}"]`).waitFor({state:'attached'})
  await page.waitForFunction(nodes=>nodes.every(id=>{const i=document.querySelector(`[data-node-id="${id}"] img`);return i?.complete&&i.naturalWidth>0}),nodes)
  const zoomProbe=process.env.KNIFE_GPU_ZOOM==='1';let zoomEvidence
  if(zoomProbe){const scale=()=>page.locator('.react-flow__viewport').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);const before=await scale();await page.mouse.move(1160,710);await page.mouse.wheel(0,180);await page.waitForTimeout(500);const after=await scale();assert(after<before);zoomEvidence={before,after}}
  const evidence=await page.evaluate(nodes=>nodes.map(id=>{const i=document.querySelector(`[data-node-id="${id}"] img`),r=i.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:i.naturalWidth,height:i.naturalHeight,visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-node-id]')?.dataset.nodeId===id}}),nodes)
  assert(evidence.every(i=>i.visible),JSON.stringify(evidence));const ids=()=>page.locator('[data-edge]').evaluateAll(es=>es.map(e=>e.dataset.edge).sort());const baseline=await ids();assert.equal(baseline.length,edgeCount)
  const b=await page.locator('[data-edge]').evaluateAll(es=>{const rs=es.map(e=>e.getBoundingClientRect());return {x:(Math.max(...rs.map(r=>r.left))+Math.min(...rs.map(r=>r.right)))/2,top:Math.min(...rs.map(r=>r.top)),bottom:Math.max(...rs.map(r=>r.bottom))}})
  // Diagnostic control only: same hit tests, graph and FX, skip rasterizing the severed-line SVG.
  const hideCutPreview=process.env.KNIFE_NO_PREVIEW_PAINT==='1'
  if(hideCutPreview) await page.addStyleTag({content:'svg[data-edge-cut]{display:none!important}'})
  const hideBaseEdges=process.env.KNIFE_NO_BASE_PAINT==='1'
  if(hideBaseEdges) await page.addStyleTag({content:'.react-flow__edges{visibility:hidden!important}'} )
  const skipEdgeHit=process.env.KNIFE_SKIP_EDGE_HIT==='1'
  if(skipEdgeHit) await page.addStyleTag({content:'.react-flow__edges,.react-flow__edges *{pointer-events:none!important}'})
  if(skipEdgeHit) assert.equal(await page.locator('.react-flow__edges [data-edge]').evaluateAll(es=>es.filter(e=>getComputedStyle(e).pointerEvents==='none' && getComputedStyle(e).visibility==='visible').length),edgeCount)
  const omitHitPaths=process.env.KNIFE_OMIT_HIT_PATHS==='1'
  if(omitHitPaths){
    await page.addStyleTag({content:'[data-edge-hit]{display:none!important}'})
    assert.equal(await page.locator('[data-edge-hit]').evaluateAll(es=>es.filter(e=>getComputedStyle(e).display==='none').length),edgeCount)
  }
  const batchBase=process.env.KNIFE_BATCH_BASE==='1'
  const batchSize=Number(process.env.KNIFE_BATCH_SIZE??edgeCount);assert(Number.isInteger(batchSize)&&batchSize>0)
  const lazy=process.env.KNIFE_BATCH_LAZY==='1'
  const spatial=process.env.KNIFE_BATCH_SPATIAL==='1'
  const startTiming=process.env.KNIFE_START_TIMING==='1';if(startTiming)await page.evaluate((await import('./knifeStartTiming.mjs')).installKnifeStartTiming)
  const gpuFallback=process.env.KNIFE_GPU_FALLBACK==='1'
  const raster=process.env.KNIFE_RASTER==='1';if(raster && process.env.KNIFE_GPU==='1'){await page.evaluate((await import('./knifeGpuProbe.mjs')).installKnifeGpuProbe,gpuFallback)} else if(raster){assert(batchBase && lazy);await page.evaluate((await import('./knifeRasterProbe.mjs')).installKnifeRasterProbe)}
  else if(batchBase) await page.evaluate((await import('./knifeBatchProbe.mjs')).installKnifeBatchProbe,{chunkSize:batchSize,lazy,spatial})
  const dirtyClear=process.env.KNIFE_DIRTY_CLEAR==='1';if(dirtyClear) await page.evaluate((await import('./knifeDirtyClear.mjs')).installKnifeDirtyClear)
  const report={zoomEvidence,gpuFallback,gpu:process.env.KNIFE_GPU==='1',raster,dirtyClear,spatial,lazy,batchSize,batchBase,omitHitPaths,skipEdgeHit,hideBaseEdges,hideCutPreview,timing:"from before pointerdown through two post-pointerup animation frames",edgeCount,sourceHashes:[...hashes],evidence,b,rounds:[]};const save=()=>writeFileSync(out,JSON.stringify(report,null,2))
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
    }if(batchBase){report.batchEvidence=await page.evaluate(()=>window.knifeBatchEvidence);report.url=page.url()}save();assert(ms.length>=10);if(mode==='miss') assert.deepEqual(after,baseline)
    if(mode==='hit'){await page.keyboard.press('Control+z');await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline)}
  }
  assert(report.rounds.every(r=>r.mode!=='hit'||r.remaining.length===0),'挥刀后仍有预期命中边残留，见报告')
  if(batchBase){report.batchEvidence=await page.evaluate(()=>window.knifeBatchEvidence);save();assert.equal(report.batchEvidence.length,6);assert(report.batchEvidence.every((r,i)=>(!lazy || (gpuFallback ? !r.activated && (i%2===0||!!r.fallback) : r.activated===Boolean(i%2))) && r.visible && r.initial===edgeCount && r.minimum===(i%2?0:edgeCount)))}
  if(batchBase && process.env.KNIFE_BATCH_CANCEL==='1'){
    if(report.gpu) await page.evaluate(()=>window.knifeCheckPixels=true)
    await page.mouse.move(b.x,b.top-20);await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(b.x,(b.top+b.bottom)/2,{steps:24})
    const pending=await page.locator('[data-edge][data-knife-pending]').evaluateAll(es=>es.map(e=>e.dataset.edge))
    assert(pending.length>0 && pending.length<edgeCount)
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true})));await page.mouse.up();await page.keyboard.up('Space');await page.waitForTimeout(400)
    const survivors=baseline.filter(id=>!pending.includes(id));assert.deepEqual(await ids(),survivors)
    assert.equal(await page.locator('[data-edge]').evaluateAll(es=>es.filter(e=>getComputedStyle(e).visibility==='visible').length),survivors.length)
    const end=await page.evaluate(()=>window.knifeBatchEvidence.at(-1).end);assert.equal(end,'pointercancel')
    await page.keyboard.press('Control+z');await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline);report.cancel={pending,survivors,end,undo:baseline.length};if(report.gpu && !gpuFallback){report.cancel.pixel=await page.evaluate(()=>window.knifeBatchEvidence.at(-1).pixelCheck);assert(report.cancel.pixel?.maxAlpha>0)}save()
  }
  if(startTiming){report.startTiming=await page.evaluate(()=>window.knifeStartTiming);save()}
  console.log('real-photo benchmark',report.rounds.map(({mode,p95,max})=>({mode,p95,max})))
}
