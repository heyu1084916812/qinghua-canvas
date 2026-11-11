import type { BatchData, GenerationData, PromptData, NodeSnapshot } from '../model/node'
import { GENERATION_ASSET_MIME } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec, RunContext, RunRequest } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { directUpstream } from '../graph/upstreamOf'
import { indexNodes } from '../model/graph'
import { batchItemsOf } from './batch'
import { generationParams } from './params'
import { presetPromptSuffix } from '../layout/presets'
import { nodeContentUsable } from '../execution/disabledNode'

function contextAssetInputs(data: GenerationData): NodeInput[] {
  return (data.contextAssets ?? []).flatMap((asset) => {
    const hash = asset.hash.trim()
    if (!hash || !asset.mime.startsWith('image/')) return []
    return [{
      kind: 'asset' as const,
      nodeId: `context-kit:${hash}`,
      assetHash: hash,
      mime: asset.mime,
    }]
  })
}

function contextAssetPrompt(data: GenerationData): string {
  const assets = (data.contextAssets ?? []).filter(
    (asset) => asset.hash.trim() && asset.mime.startsWith('image/'),
  )
  if (assets.length === 0) return ''
  const logoIndex = assets.findIndex((asset) => asset.role === 'logo')
  const lines = [
    '品牌素材约束：',
    logoIndex >= 0
      ? `第 ${logoIndex + 1} 张随附图片是品牌 Logo${
          assets[logoIndex]!.name.trim() ? `「${assets[logoIndex]!.name.trim()}」` : ''
        }，必须按原图保留字形、比例、颜色和标志结构，不得重画或改成相似字样。`
      : '随附品牌素材中的标志必须按原图使用，不得重画或改成相似字样。',
    '其余随附品牌素材用于核对颜色、字体气质、版式语言和画面规范，不要照抄无关内容。',
  ]
  return lines.join('\n')
}

/**
 * 生成节点规格。
 *
 * M0-11 补齐 `collectInputs` 与 `toRunRequest`：把「上游提示词 → 本节点请求」这段
 * 链路放进规格，执行引擎因此不需要认识任何具体节点类型（架构 §4.5 / §5.5）。
 */
export const generationSpec: NodeSpec<GenerationData> = {
  type: 'generation',
  label: '生成',
  sizing: { min: NODE_MINIMUMS.generation },
  ports: { input: true, output: true },
  // M1 模板「图生视频」需要 图片生成 → 视频生成 的连线；故 generation 也接受 generation 上游。
  // 仅扩展 accepts，不引入新节点类型；执行期多模态输入（图→视频）的收集属 M2 范围。
  // M3-3：接受 batch 上游（§6.12「作为上游：集合卡」）——下游遍历集合内每项各生成一次。
  /**
   * `loop` 必须在内（§6.22）：循环节点正是通过"被下游连接"来把本轮输入交出去的，
   * 少了它，「循环 → 生成」这条主链路直接连不上（实测报「不接受来自 loop 的输入」）。
   */
  /** `fusion` 一并接受（§6.23）：融合产物是一张普通图片，能当参考图喂给下游模型 */
  accepts: { upstream: ['prompt', 'generation', 'batch', 'loop', 'fusion'] },
  createDefaultData(): GenerationData {
    return {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      thumbOrder: [],
      upstreamHidden: [],
    }
  },

  /** 上游提示词节点的文本；被「隐藏上游」勾选的不参与 */
  collectInputs({ node, graph }: InputContext<GenerationData>): NodeInput[] {
    const index = indexNodes(graph.nodes)
    const hidden = new Set(node.data.upstreamHidden ?? [])
    let inputs: NodeInput[] = []
    const seenAssetHashes = new Set<string>()
    /**
     * 套件素材必须是生图请求的真实图片输入，并排在用户上游素材之前：
     * Logo 正确性不能只靠文字描述，否则模型会照着名字重画一个近似标志。
     */
    for (const input of contextAssetInputs(node.data)) {
      if (input.kind !== 'asset' || seenAssetHashes.has(input.assetHash)) continue
      seenAssetHashes.add(input.assetHash)
      inputs.push(input)
    }
    for (const id of directUpstream(node.id, graph.edges)) {
      if (hidden.has(id)) continue
      const upstream = index.get(id)
      if (!upstream) continue
      /** 禁用节点的内容不参与（对账 #515 修订）：连它的图也不喂给下游 */
      if (!nodeContentUsable(upstream)) continue
      // 批量节点作为上游 → 集合卡（§6.12）：下游遍历集合内每项各生成一次，
      // 因此这里包成一个 collection 项，展开发生在执行计划阶段（domain/execution）。
      if (upstream.type === 'batch') {
        const items = batchItemsOf(upstream as NodeSnapshot<BatchData>, graph)
        if (items.length > 0) inputs.push({ kind: 'collection', nodeId: upstream.id, items })
        continue
      }
      if (upstream.type === 'prompt') {
        inputs.push({ kind: 'text', nodeId: upstream.id, text: (upstream.data as PromptData).text })
        continue
      }
      /**
       * 循环节点作为上游 → 取**本轮**的提示词与素材（用户 2026-09-23）。
       *
       * 循环节点不产图，它把「第 N 轮该用哪条提示词、哪几张图」交给下游。
       * 此前这里不认 `loop`（`accepts.upstream` 早就含它，但只连了线、没收输入），
       * 于是「循环 → 生成」这条主链路**连上了却不生效**——
       * 下游拿不到提示词，`toRunRequest` 因 `!prompt` 返回 null，
       * 循环节点的一键运行直接报「无法构建请求」。
       *
       * 两个字段都由执行侧在每轮开始时**临时写入**循环节点的 data：
       *  - `__roundPrompt`：本轮提示词（已做过变量替换）
       *  - `__roundAssets`：本轮的素材 hash 列表
       * 双下划线前缀表示「运行期瞬时态」，不参与持久化的字段约定。
       */
      if (upstream.type === 'loop') {
        const round = upstream.data as { __roundPrompt?: string; __roundAssets?: string[] }
        if (round.__roundPrompt) {
          inputs.push({ kind: 'text', nodeId: upstream.id, text: round.__roundPrompt })
        }
        for (const hash of round.__roundAssets ?? []) {
          if (seenAssetHashes.has(hash)) continue
          seenAssetHashes.add(hash)
          inputs.push({ kind: 'asset', nodeId: upstream.id, assetHash: hash, mime: GENERATION_ASSET_MIME })
        }
        continue
      }
      // 生成节点作为上游 → 它的产物就是本次的**图像输入**（M6-12：图生图 / 图生视频）。
      // `accepts.upstream` 早就含 'generation'，但此前只连了线、没收进 inputs，
      // 于是渠道拿到的永远只有提示词——图生图在数据模型里「接好了」却从未生效。
      // 这里补上后，上游重生成会改变 assetHash → 下游指纹随之变化 → 自动判定陈旧。
      const upData = upstream.data as GenerationData
      const hash = upData.assetHash
      if (hash) {
        if (seenAssetHashes.has(hash)) continue
        seenAssetHashes.add(hash)
        inputs.push({
          kind: 'asset',
          nodeId: upstream.id,
          assetHash: hash,
          mime:
            upData.assetMime ??
            (upData.mode === 'video' ? 'video/mp4' : GENERATION_ASSET_MIME),
          /**
           * 带上素材的**原始像素**（用户 2026-09-24）。
           *
           * 「跟随素材」比例要在执行期按参考图 1 的真实比例定尺寸，而它读的就是
           * 这个字段。此前只给 `batch` 上游带（批量套图是当时唯一的使用场景），
           * 生成节点当上游时**丢掉了它** —— 于是普通图生图选「跟随素材」永远拿不到
           * 比例，只能退化成「不指定」（老数据解不出尺寸时也一样）。
           *
           * 只补 `naturalSize`，**不动 `prompt`**：那是「素材自带描述要不要参与拼
           * 提示词」的另一件事，改它会让既有的图生图请求文案变样，不在本次范围内。
           */
          ...(upData.naturalSize ? { naturalSize: upData.naturalSize } : {}),
        })
      }
    }
    /**
     * 循环节点可能同时把上游提示词和本轮变量带进 `__roundPrompt`，而同一个
     * 上游提示词节点又可能直连生图节点。这里按**最终文本**去掉重复：
     * - 循环文本已包含某条直连提示词时，直连那条不再重复发送；
     * - 完全相同的文本只保留一次。
     *
     * 不能只按 nodeId 去重：循环节点的 nodeId 与提示词节点不同，但它们产出的
     * 是同一段上下文。
     */
    const loopTexts = inputs
      .filter((input): input is Extract<NodeInput, { kind: 'text' }> => input.kind === 'text')
      .filter((input) => index.get(input.nodeId)?.type === 'loop')
      .map((input) => input.text.trim())
      .filter(Boolean)
    const seenTexts = new Set<string>()
    const orderedTexts: string[] = []
    const textInputs = inputs.filter(
      (input): input is Extract<NodeInput, { kind: 'text' }> => input.kind === 'text',
    )
    for (const input of textInputs) {
      if (index.get(input.nodeId)?.type === 'loop') continue
      const text = input.text.trim()
      if (!text || seenTexts.has(text) || loopTexts.some((loopText) => loopText.includes(text))) {
        continue
      }
      seenTexts.add(text)
      orderedTexts.push(text)
    }
    for (const text of loopTexts) {
      if (seenTexts.has(text)) continue
      seenTexts.add(text)
      orderedTexts.push(text)
    }
    const emittedTexts = new Set<string>()
    inputs = inputs.filter((input) => {
      if (input.kind !== 'text') return true
      const text = input.text.trim()
      if (!text) return false
      if (!orderedTexts.includes(text) || emittedTexts.has(text)) return false
      emittedTexts.add(text)
      return true
    })
    return inputs
  },

  /** 渠道或模型未配置时返回 null——由 buildRunPlan 过滤掉，不进执行计划 */
  toRunRequest({ node, inputs }: RunContext<GenerationData>): RunRequest | null {
    const data = node.data
    if (!data.channelId || !data.model) return null

    const upstreamText = [
      ...new Set(
        inputs
          .filter((i): i is Extract<NodeInput, { kind: 'text' }> => i.kind === 'text')
          .map((i) => i.text.trim())
          .filter(Boolean),
      ),
    ].join('\n')
    /**
     * 「预设 / 情绪」（用户 2026-10-05 第 14 条）拼在提示词**后面**：
     * 先描述画面，再给输出规格 —— 与批量节点「统一要求在尾部」同一条读法。
     * 拼接规则只有 `presets.ts` 一处，三种生成节点类型共用。
     */
    const prompt = [
      data.prompt.trim() || upstreamText.trim(),
      presetPromptSuffix(data),
      contextAssetPrompt(data),
    ]
      .filter(Boolean)
      .join('\n')
    if (!prompt) return null

    return {
      kind: data.mode,
      channelId: data.channelId,
      model: data.model,
      prompt,
      inputs,
      params: generationParams(data),
    }
  },
}
