import { describe, expect, it } from 'vitest'
import {
  CLI_MAX_TIMEOUT_MS,
  CLI_MIN_TIMEOUT_MS,
  buildArgs,
  clampToolTimeout,
  defaultCliTools,
  fillArgs,
  mergeTools,
  modelCapabilitiesOf,
  parseArgs,
  toolPatchOf,
} from './cliTools'

describe('CLI 参数模板', () => {
  it('媒体输入能力由参数模板决定，默认 CLI 不虚报图片 / 视频输入', () => {
    const base = defaultCliTools()[0]!
    expect(modelCapabilitiesOf(base)[0]?.inputTypes).toEqual(['text'])
    expect(
      modelCapabilitiesOf({ ...base, argsTemplate: 'exec {prompt} --input {image}' })[0]
        ?.inputTypes,
    ).toEqual(['text', 'image'])
    expect(
      modelCapabilitiesOf({ ...base, argsTemplate: 'exec {prompt} --video {video}' })[0]
        ?.inputTypes,
    ).toEqual(['text', 'video'])
  })

  it('没有媒体素材时省略可选媒体参数，旧占位符语义不变', () => {
    expect(buildArgs('model run --prompt {prompt} --image {image} --video {video}', {
      prompt: 'text only',
    })).toEqual(['model', 'run', '--prompt', 'text only'])
    expect(fillArgs(['--image', '{image}'], { prompt: 'text only' })).toEqual([])
    expect(fillArgs(['--input={image}'], { prompt: 'text only' })).toEqual([])
    expect(fillArgs(['--model', '{model}'], { prompt: 'text only' })).toEqual([
      '--model',
      '{model}',
    ])
  })

  it('按空格切词，引号里的空格不算分隔', () => {
    expect(parseArgs('exec --prompt a b')).toEqual(['exec', '--prompt', 'a', 'b'])
    expect(parseArgs('generate --prompt "两 个 词" --out x')).toEqual([
      'generate',
      '--prompt',
      '两 个 词',
      '--out',
      'x',
    ])
    expect(parseArgs("--model 'a b'")).toEqual(['--model', 'a b'])
  })

  it('纯空白不产生 token，但显式空引号算一个空 token', () => {
    expect(parseArgs('   ')).toEqual([])
    expect(parseArgs('run ""')).toEqual(['run', ''])
  })

  it('替换占位符；没有值的原样留着（不静默变空串）', () => {
    const tokens = parseArgs('run --prompt {prompt} --out {out} --model {model}')
    expect(fillArgs(tokens, { prompt: '一只猫', out: 'D:/a.png' })).toEqual([
      'run',
      '--prompt',
      '一只猫',
      '--out',
      'D:/a.png',
      '--model',
      '{model}',
    ])
  })

  it('提示词里的 $ 不会被当成替换语法（值原样进去）', () => {
    expect(buildArgs('exec {prompt}', { prompt: '价格 $100 与 $& 符号' })).toEqual([
      'exec',
      '价格 $100 与 $& 符号',
    ])
  })

  it('同一个占位符出现两次都会被替换', () => {
    expect(buildArgs('{prompt} --retry {prompt}', { prompt: 'hi' })).toEqual(['hi', '--retry', 'hi'])
  })
})

describe('CLI 工具配置的归一化', () => {
  it('超时夹在 [1s, 30min]，给不出数字回落默认', () => {
    expect(clampToolTimeout(undefined, 5_000)).toBe(5_000)
    expect(clampToolTimeout('3000', 5_000)).toBe(5_000)
    expect(clampToolTimeout(Number.NaN, 5_000)).toBe(5_000)
    expect(clampToolTimeout(0, 5_000)).toBe(CLI_MIN_TIMEOUT_MS)
    expect(clampToolTimeout(CLI_MAX_TIMEOUT_MS + 1, 5_000)).toBe(CLI_MAX_TIMEOUT_MS)
    expect(clampToolTimeout(12_345.6, 5_000)).toBe(12_346)
  })

  it('默认三个工具都在，且 id 不重复（RunningHub 已于 2026-11-14 删除，#1114）', () => {
    const tools = defaultCliTools()
    expect(tools.map((t) => t.id)).toEqual(['codex', 'jimeng', 'gemini'])
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length)
    // 用户点名的改名：GPT CLI → Codex
    expect(tools.find((t) => t.id === 'codex')?.name).toBe('Codex')
  })

  it('库里只覆盖"用户改得动"的字段，其余跟代码走', () => {
    const tools = mergeTools({
      tools: [{ id: 'codex', program: 'D:/tools/codex.cmd', argsTemplate: 'run {prompt}' }],
    })
    const codex = tools.find((t) => t.id === 'codex')
    expect(codex?.program).toBe('D:/tools/codex.cmd')
    expect(codex?.argsTemplate).toBe('run {prompt}')
    // 没存过的字段：默认值原样
    expect(codex?.timeoutMs).toBe(defaultCliTools()[0]?.timeoutMs)
    expect(codex?.name).toBe('Codex')
    /* 没被改过的其它工具也在（目录以代码为准） */
    expect(tools.find((t) => t.id === 'gemini')?.program).toBe('gemini')
  })

  it('坏值回落默认，认不出的 id 直接丢掉', () => {
    const tools = mergeTools({
      tools: [
        { id: 'codex', program: '   ', argsTemplate: 42, timeoutMs: -5 },
        { id: 'gone-tool', program: 'x' },
        'not-an-object',
      ],
    })
    const codex = tools.find((t) => t.id === 'codex')
    expect(codex?.program).toBe('codex')
    expect(codex?.argsTemplate).toBe('exec {prompt}')
    expect(codex?.timeoutMs).toBe(CLI_MIN_TIMEOUT_MS)
    expect(tools).toHaveLength(defaultCliTools().length)
  })

  /**
   * ★★ 老库里**残留的已删除工具**（`runninghub`）不许把幽灵行带回来。
   *
   * 判据：`mergeTools` 只按当前目录映射 —— 目录里没有的 id 一律忽略，
   * 于是"删掉一个工具"这件事**不需要迁移脚本**，旧补丁自然失效。
   */
  it('★★ 库里残留已删除工具（runninghub）⇒ 直接忽略，不复活', () => {
    const tools = mergeTools({
      tools: [{ id: 'runninghub', program: 'rh', argsTemplate: 'model run --prompt {prompt}' }],
    })
    expect(tools.map((t) => t.id)).toEqual(['codex', 'jimeng', 'gemini'])
    expect(tools.some((t) => t.id === 'runninghub')).toBe(false)
  })

  it('读不懂的行（null / 字符串 / 缺 tools）等价于"全默认"', () => {
    for (const row of [null, undefined, 'nope', {}, { tools: 'x' }]) {
      expect(mergeTools(row)).toEqual(defaultCliTools())
    }
  })

  it('写库只写"用户改得动"的那几个字段（别的不许落盘，免得下一次升级被旧值钉住）', () => {
    const tool = defaultCliTools()[0]!
    expect(Object.keys(toolPatchOf(tool)).sort()).toEqual([
      'argsTemplate',
      'cwd',
      'id',
      'installCommand',
      'keyLoginArgs',
      'loginArgs',
      'program',
      'statusArgs',
      'timeoutMs',
    ])
  })

  it('★★ 「一键安装」的命令：能自动装的给命令，不能的给空串（第 14 批第 3 条）', () => {
    const tools = defaultCliTools()
    /* npm 装得上的两个：命令的第一段是程序名、后面是参数 */
    expect(parseArgs(tools.find((t) => t.id === 'codex')!.installCommand)[0]).toBe('npm')
    expect(parseArgs(tools.find((t) => t.id === 'gemini')!.installCommand)).toEqual([
      'npm',
      'install',
      '-g',
      '@google/gemini-cli',
    ])
    /* 即梦官方没有 CLI ⇒ 空串（面板据此不给「一键安装」按钮） */
    expect(tools.find((t) => t.id === 'jimeng')!.installCommand).toBe('')
    /* "空串合法"这条规则由上面 jimgeng 那句与下一条用例守着 */
  })

  it('★ 安装命令也是"空串合法"：用户清空后不许自己长回默认', () => {
    const tools = mergeTools({ tools: [{ id: 'codex', installCommand: '' }] })
    expect(tools.find((t) => t.id === 'codex')?.installCommand).toBe('')
    /* 没动过的仍是默认 */
    expect(tools.find((t) => t.id === 'gemini')?.installCommand).toContain('@google/gemini-cli')
  })

  it('★★ 空串是合法值：用户把「查状态命令」清空后，不许自己长回默认（对账 #314）', () => {
    /*
     * 这三条字段里空串的语义是"这个工具没有这条命令"。
     * 若按 `str()` 的写法把空串当坏值回落默认，用户**永远关不掉**一条自己不支持的子命令。
     */
    const tools = mergeTools({ tools: [{ id: 'gemini', statusArgs: '', keyLoginArgs: '' }] })
    const gemini = tools.find((t) => t.id === 'gemini')
    expect(gemini?.statusArgs).toBe('')
    expect(gemini?.keyLoginArgs).toBe('')
    // 没动过的字段仍是默认（codex 的查状态命令是实测过的 `login status`）
    expect(defaultCliTools().find((t) => t.id === 'codex')?.statusArgs).toBe('login status')
  })

  it('★ 每个工具都写明"额度去哪儿看"，没有可查命令的要能一眼看出来（对账 #314）', () => {
    for (const tool of defaultCliTools()) {
      expect(tool.quotaWhere.trim().length).toBeGreaterThan(10)
    }
    /** 即梦没有官方 CLI ⇒ 不给「查状态」命令（面板会直说，而不是给个假按钮）。 */
    expect(defaultCliTools().find((t) => t.id === 'jimeng')?.statusArgs).toBe('')
    // Codex 支持密钥登录（官方 help 里写明 `login --with-api-key` 从 stdin 读）
    expect(defaultCliTools().find((t) => t.id === 'codex')?.keyLoginArgs).toContain('--with-api-key')
  })
})
