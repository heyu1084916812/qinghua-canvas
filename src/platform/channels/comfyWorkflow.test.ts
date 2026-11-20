import { describe, expect, it, vi } from 'vitest'
import { parseComfyHistory, parseComfyPromptAccepted, queryComfyHistory, submitComfyPrompt } from './comfyWorkflow'
import type { NetworkPort } from '../ports'
const endpoint = { baseUrl: 'http://127.0.0.1:8188/' }
const response = (body: unknown) => ({ status: 200, headers: {}, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) })
describe('ComfyUI workflow transport', () => {
  it('accepts only a real prompt_id', () => {
    expect(parseComfyPromptAccepted({ prompt_id: 'p-1', number: 4 })).toEqual({ promptId: 'p-1', number: 4, nodeErrors: undefined })
    expect(() => parseComfyPromptAccepted({})).toThrow()
  })
  it('maps history images to safe /view URLs and preserves subfolder/type', () => {
    const result = parseComfyHistory({ 'p-1': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'a b.png', subfolder: 'foo', type: 'output' }] } } } }, 'p-1', endpoint)
    expect(result).toMatchObject({ status: 'success', outputs: [{ filename: 'a b.png', subfolder: 'foo', type: 'output' }] })
    expect(result.outputs[0]?.url).toContain('filename=a+b.png')
    expect(result.outputs[0]?.url).toContain('subfolder=foo')
  })
  it('uses local HTTP endpoints without public-network permission', async () => {
    const request = vi.fn(async () => response({ prompt_id: 'p-2' }))
    const network = { request, stream: vi.fn() } as unknown as NetworkPort
    await submitComfyPrompt(network, endpoint, { prompt: {} }, new AbortController().signal)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:8188/prompt', publicOnly: false }), expect.anything())
    request.mockResolvedValueOnce(response({ 'p-2': { status: { status_str: 'running' }, outputs: {} } }))
    await queryComfyHistory(network, endpoint, 'p-2', new AbortController().signal)
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:8188/history/p-2' }), expect.anything())
  })
})
