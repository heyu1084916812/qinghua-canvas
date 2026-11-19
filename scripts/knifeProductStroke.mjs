import assert from 'node:assert/strict'

/** Exercise the product renderer; no drawing hooks or replacement markup. */
export async function verifyProductStroke(page,b,ids,baseline,out,expected){
  const picked=await page.evaluate(({x,top,bottom})=>{for(let y=bottom-5;y>(top+bottom)/2+40;y-=3){const hit=document.elementFromPoint(x,y)?.closest('[data-edge-hit]');if(hit)return {x,y,id:hit.dataset.edgeHit}}},b)
  assert(picked);await page.mouse.click(picked.x,picked.y)
  const button=page.locator(`[data-edge-delete="${picked.id}"]`);await button.waitFor({state:'visible'})
  await page.mouse.move(b.x,b.top-20);await page.keyboard.down('Space');await page.locator('[data-knife-cursor]').waitFor({state:'attached'});await page.mouse.down();await page.mouse.move(b.x,(b.top+b.bottom)/2,{steps:24})
  const active=await page.locator('[data-knife-edge-overlay]').count(),pending=await page.locator('[data-edge][data-knife-pending]').evaluateAll(es=>es.map(e=>e.dataset.edge));if(active!==Number(expected)){console.log('stroke diagnostics',await page.evaluate(()=>({pending:document.querySelectorAll('[data-knife-pending]').length,edges:document.querySelectorAll('[data-edge]').length,layers:document.querySelectorAll('.react-flow__edges').length,matrices:[...new Set([...document.querySelectorAll('[data-edge]')].map(p=>String(p.getScreenCTM())))],activations:window.productKnifeActivations})));}assert.equal(active,Number(expected));assert(pending.length && !pending.includes(picked.id));assert(await button.isVisible())
  await page.screenshot({path:out.replace(/\.json$/, '-partial.png')});await page.mouse.up();await page.keyboard.up('Space');await page.waitForTimeout(400)
  assert.deepEqual(await ids(),baseline.filter(id=>!pending.includes(id)));assert(await button.isVisible());assert.equal(await page.locator('[data-knife-edge-overlay],[data-knife-gpu]').count(),0)
  await page.keyboard.press('Control+z');await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline);if(baseline.length<200)return {picked:picked.id,active,cut:pending.length,restored:baseline.length,deleteTest:'covered by dense fixtures'};await button.click();await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline.filter(id=>id!==picked.id));await page.keyboard.press('Control+z');await page.waitForTimeout(400);assert.deepEqual(await ids(),baseline)
  return {picked:picked.id,active,cut:pending.length,restored:baseline.length}
}
