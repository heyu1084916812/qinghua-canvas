import { describe, expect, it } from 'vitest'
import { createComfyUiAdapter } from './comfyui'
import type { NetworkPort, NetworkResponse } from '../ports'
import type { ResolvedChannelConfig } from './registry'

const cfg: ResolvedChannelConfig = { id: 'c', protocol: 'comfyui-local', baseUrl: 'http://127.0.0.1:8188/', credentialRef: null, apiKey: null }
const response = (body: unknown, status = 200, headers: Record<string, string> = {}): NetworkResponse => ({
  status, headers, async text() { return JSON.stringify(body) }, async json<T>() { return body as T }, async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(body)).buffer },
})
function networkOf(fn: (url: string, body: unknown) => NetworkResponse | Promise<NetworkResponse>): NetworkPort {
  return { request: async (req) => fn(req.url, req.body), stream: async function* () {} }
}
const signal = new AbortController().signal
const deps = (network: NetworkPort) => ({ network, assets: { async read() { return null }, async readUrl() { return null } } })

describe('ComfyUI adapter', () => {
  it('verifies /system_stats and does not fabricate a model catalog', async () => {
    const calls: string[] = []
    const adapter = createComfyUiAdapter(cfg, deps(networkOf((url) => { calls.push(url); return response({ system: {} }) })))
    await expect(adapter.verify(cfg, signal)).resolves.toEqual({ ok: true, models: [], note: expect.stringContaining('已连接') })
    await expect(adapter.listModels(cfg, signal)).resolves.toEqual([])
    expect(calls).toEqual(['http://127.0.0.1:8188/system_stats'])
  })

  it('submits a graph, applies exposed fields, polls, and downloads the output', async () => {
    const calls: { url: string; body: unknown }[] = []
    const adapter = createComfyUiAdapter(cfg, deps(networkOf((url, body) => {
      calls.push({ url, body })
      if (url.endsWith('/prompt')) return response({ prompt_id: 'p1' })
      if (url.endsWith('/history/p1')) return calls.filter((x) => x.url.endsWith('/history/p1')).length === 1
        ? response({ p1: { status: { status_str: 'running' }, outputs: {} } })
        : response({ p1: { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'a.png', subfolder: 'sub', type: 'output' }] } } } })
      if (url.includes('/view?')) return { ...response({}), headers: { 'content-type': 'image/png' }, async arrayBuffer() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer } }
      throw new Error(url)
    })), { pollIntervalMs: 0, sleep: async () => {} })
    const assets = await adapter.generateImage({ kind: 'image', channelId: 'c', model: 'workflow:w1', prompt: '', inputs: [], params: { workflowJson: { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }, workflow: [{ nodeId: '1', fieldName: 'seed', fieldValue: '42' }] } }, signal)
    expect(((calls.find((x) => x.url.endsWith('/prompt'))?.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt['1']?.inputs.seed)).toBe('42')
    expect(calls.some((x) => x.url.includes('/view?filename=a.png&subfolder=sub&type=output'))).toBe(true)
    expect(assets).toHaveLength(1)
    expect(assets[0]?.mime).toBe('image/png')
  })

  it('uploads an upstream asset and backfills the workflow field', async () => {
    const calls: { url: string; body: unknown }[] = []
    const adapter = createComfyUiAdapter(cfg, { ...deps(networkOf((url, body) => {
      calls.push({ url, body })
      if (url.endsWith('/upload/image')) return response({ name: 'input.png', subfolder: 'sub', type: 'input' })
      if (url.endsWith('/prompt')) return response({ prompt_id: 'p1' })
      if (url.endsWith('/history/p1')) return response({ p1: { status: { status_str: 'success' }, outputs: {} } })
      throw new Error(url)
    })), assets: { async read() { return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } }, async readUrl() { return null } } }, { pollIntervalMs: 0 })
    await adapter.generateImage({ kind: 'image', channelId: 'c', model: 'workflow:w1', prompt: '', inputs: [{ kind: 'asset', nodeId: 'n', assetHash: 'h', mime: 'image/png' }], params: { workflowJson: { '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } } }, workflow: [{ nodeId: '1', fieldName: 'image', fieldValue: '__upstream__' }] } }, signal)
    expect(calls[0]?.url).toBe('http://127.0.0.1:8188/upload/image')
    const form = calls[0]?.body as FormData
    expect(form.get('type')).toBe('input')
    expect((calls.find((x) => x.url.endsWith('/prompt'))?.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt['1']?.inputs.image).toBe('sub/input.png')
  })

  it('prune-workflow：没有对应上游素材时删除可选媒体输入，skip 保留默认值', async () => {
    const calls: { url: string; body: unknown }[] = []
    const network = networkOf((url, body) => {
      calls.push({ url, body })
      if (url.endsWith('/prompt')) return response({ prompt_id: 'p1' })
      if (url.endsWith('/history/p1')) return response({ p1: { status: { status_str: 'success' }, outputs: {} } })
      throw new Error(url)
    })
    const graph = { '1': { class_type: 'LoadImage', inputs: { image: 'default.png', denoise: 0.5 } } }
    const adapter = createComfyUiAdapter(cfg, deps(network), { pollIntervalMs: 0 })
    await adapter.generateImage({ kind: 'image', channelId: 'c', model: 'workflow:w1', prompt: '', inputs: [], params: { workflowJson: graph, workflow: [{ nodeId: '1', fieldName: 'image', fieldValue: '__upstream__' }], workflowMediaPolicy: 'prune-workflow', workflowOptionalMediaIds: ['1::image'] } }, signal)
    const pruned = (calls.find((x) => x.url.endsWith('/prompt'))?.body as { prompt: typeof graph }).prompt
    expect(pruned['1']?.inputs).toEqual({ denoise: 0.5 })

    calls.length = 0
    await adapter.generateImage({ kind: 'image', channelId: 'c', model: 'workflow:w1', prompt: '', inputs: [], params: { workflowJson: graph, workflow: [{ nodeId: '1', fieldName: 'image', fieldValue: '__upstream__' }], workflowMediaPolicy: 'skip' } }, signal)
    const kept = (calls.find((x) => x.url.endsWith('/prompt'))?.body as { prompt: typeof graph }).prompt
    expect(kept['1']?.inputs).toEqual(graph['1']?.inputs)
  })

})
