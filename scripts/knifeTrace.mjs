// Test-only instrumentation of the Vite response. Never changes the source file or a release build.
export async function installKnifeTrace(page) {
  await page.route('**/flow/useEdgeCut.ts*', async route => {
    const response = await route.fetch(); let code = await response.text()
    const patch = (needle, value) => {
      if (!code.includes(needle)) throw new Error(`knife trace: missing marker ${needle}`)
      code = code.replace(needle, value)
    }
    if (code.includes('edges: snapshotEdges(surface, rect)')) {
      patch('const hitIds = [];', `const hitIds = []; const trace={from,to, boxes:[],sampled:[],hit:[],deleteMs:0};
        (window.knifeMoves ??= []).push(trace); const start=performance.now();`)
      patch('const hit = segmentHitsPolyline', `trace.sampled.push(id); const hit = segmentHitsPolyline`)
    } else {
    patch('const hitIds = [];', `const hitIds = []; const trace = {from:screenFrom,to:screenTo, boxes:[],sampled:[],hit:[],sampleMs:0,deleteMs:0};
      (window.knifeMoves ??= []).push(trace); const start=performance.now();`)
    patch('const box = path.getBoundingClientRect();', `const box = path.getBoundingClientRect(); trace.boxes.push([id,box.left,box.top,box.right,box.bottom]);`)
    patch('const ctm = path.getScreenCTM();', `const beforeSample=performance.now(); trace.sampled.push(id); const ctm = path.getScreenCTM();`)
    patch('const hit = segmentHitsPolyline', `trace.sampleMs+=performance.now()-beforeSample; const hit = segmentHitsPolyline`)
    }
    patch('if (hitIds.length === 0) return;', `trace.scanMs=performance.now()-start; trace.hit=hitIds; if (hitIds.length === 0) return;`)
    patch('removeEdges(hitIds, session.planId);', `const del=performance.now(); removeEdges(hitIds, session.planId); trace.deleteMs=performance.now()-del;`)
    await route.fulfill({response, body:code})
  })
}
