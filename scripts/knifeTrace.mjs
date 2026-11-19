// Test-only instrumentation of the Vite response. Never changes the source file or a release build.
export async function installKnifeTrace(page) {
  await page.route('**/flow/useEdgeCut.ts*', async route => {
    const response = await route.fetch(); let code = await response.text()
    const patch = (needle, value) => {
      if (!code.includes(needle)) throw new Error(`knife trace: missing marker ${needle}`)
      code = code.replace(needle, value)
    }
    patch('const spawned = [];', `const spawned=[]; const trace={from,to,sampled:[],hit:[],deleteMs:0};
      (window.knifeMoves ??= []).push(trace); const start=performance.now();`)
    patch('const hit = segmentHitsPolyline', `trace.sampled.push(id); const hit = segmentHitsPolyline`)
    patch('session.cut.add(id);', `trace.hit.push(id); session.cut.add(id);`)
    patch('if (spawned.length)', `trace.scanMs=performance.now()-start; if (spawned.length)`)
    patch('removeRef.current([...session.cut], session.planId);', `const del=performance.now(); removeRef.current([...session.cut],session.planId); if(window.knifeMoves?.length) window.knifeMoves.at(-1).deleteMs=performance.now()-del;`)
    await route.fulfill({response, body:code})
  })
}
