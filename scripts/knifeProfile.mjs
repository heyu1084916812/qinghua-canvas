import { gzipSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// Isolated benchmark only. No screenshots, network payloads, or production hooks.
export async function startKnifeProfile(page, out) {
  const cdp = await page.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,toplevel,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler', transferMode: 'ReportEvents' })
  return async () => {
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete',resolve))
    await cdp.send('Tracing.end'); await done; await cdp.detach()
    writeFileSync(out, gzipSync(JSON.stringify({traceEvents:events})))
  }
}
