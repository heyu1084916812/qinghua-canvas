import { describe, expect, it, vi } from 'vitest'
import { defaultCliTools } from '../../../domain/shared/cliTools'
import type { RunRequest } from '../../../domain/shared/execution/types'
import { routeCliTasks, type CliRouteDeps } from './cliSourceRoute'
import { prepareCanvasRun } from './canvasRunPreflight'

const task = (model: string, kind: RunRequest['kind'] = 'image') => ({
  id: `t-${model}-${kind}`,
  nodeId: 'n1',
  request: { kind, channelId: model, model, prompt: '猫', inputs: [], params: {} } as unknown as RunRequest,
})

const deps = (found: boolean, hasLocalCli = true): CliRouteDeps => ({
  hasLocalCli,
  loadTools: async () => defaultCliTools(),
  which: vi.fn(async (program: string) => (found ? `/bin/${program}` : null)),
})

describe('CLI 来源选路与运行前检查（#1133 逻辑 4）', () => {
  it('可用：改写成合成渠道 cli:jimeng + 这一类的工具模型（图 → jimeng-image，视频 → jimeng-video）', async () => {
    const image = task('cli:jimeng')
    const video = task('cli:jimeng', 'video')
    const out = await routeCliTasks([image, video], deps(true))
    expect(out.failures).toEqual([])
    expect(image.request).toMatchObject({ channelId: 'cli:jimeng', model: 'jimeng-image' })
    expect(video.request).toMatchObject({ channelId: 'cli:jimeng', model: 'jimeng-video' })
    expect(out.channels.get('cli:jimeng')).toMatchObject({ protocol: 'jimeng-cli', enabled: true })
  })

  it('未检测到命令 / 工具不能出这一类 / 工具不存在 / 网页版：各给一句可读原因', async () => {
    expect((await routeCliTasks([task('cli:jimeng')], deps(false))).failures[0]?.message).toContain('本机未检测到「即梦」的命令「jimeng」')
    expect((await routeCliTasks([task('cli:codex')], deps(true))).failures[0]?.message).toContain('「Codex」的本机 CLI 不能出图（它能：对话）')
    expect((await routeCliTasks([task('cli:rh')], deps(true))).failures[0]?.message).toContain('找不到本机 CLI 工具「rh」')
    expect((await routeCliTasks([task('cli:jimeng')], deps(true, false))).failures[0]?.message).toContain('桌面版')
  })

  it('没有 cli: 任务时不读工具表、不跑 which', async () => {
    const d = { ...deps(true), loadTools: vi.fn(async () => defaultCliTools()) }
    await routeCliTasks([task('GPT Image 2')], d)
    expect(d.loadTools).not.toHaveBeenCalled()
    expect(d.which).not.toHaveBeenCalled()
  })

  it('prepareCanvasRun：CLI 任务不进渠道表选路，适配器按合成渠道解析；拦截时整批不起', async () => {
    const plan = { id: 'p', tasks: [task('cli:jimeng')] } as never
    const resolveAdapter = vi.fn(async () => ({}) as never)
    const base = {
      plan, channels: () => [], currentChannels: () => [], routeStrategy: () => 'priority' as const,
      hasLocalCli: true, loadCredential: async () => null, planGenerationRoute: vi.fn(), resolveAdapter,
    }
    const ok = await prepareCanvasRun({ ...base, cli: deps(true) })
    expect(ok.ok).toBe(true)
    expect(base.planGenerationRoute).not.toHaveBeenCalled()
    expect(resolveAdapter).toHaveBeenCalledWith(expect.objectContaining({ channel: expect.objectContaining({ id: 'cli:jimeng' }), model: 'jimeng-image', kind: 'image' }))
    const blocked = await prepareCanvasRun({ ...base, plan: { id: 'q', tasks: [task('cli:jimeng')] } as never, cli: deps(false) })
    expect(blocked.ok).toBe(false)
    expect(blocked.ok ? '' : blocked.failures[0]?.message).toContain('本机未检测到')
  })
})
