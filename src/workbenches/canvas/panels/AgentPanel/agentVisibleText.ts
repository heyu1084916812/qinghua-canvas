/**
 * 对话里「给用户看的」文字收口（Agent 实测 Bug A5，2026-11-11）。
 *
 * 真机实测里对话出现了模型的内部指令与推理：「Report concisely. Ask if run.」
 * 「Let me run it.」各两遍。路径是渠道返回的 `reasoning_content`（DeepSeek 等把
 * 原始思考链放在这里）→ 实时过程流 / 时间线过程条目，以及工具调用旁带的英文旁白。
 * 原先只有一份英文前缀黑名单，换个说法就漏。
 *
 * 规则（轻画界面与对话均为中文）：
 * - 过程文字逐句过滤：**不含汉字的句子**视为模型内部独白 / 指令，不显示；
 *   含汉字但以内部指令开头的（残留前缀名单）也不显示；
 * - 最终正文：整段只是工具调用 JSON，或夹着工具协议标记时，剥掉这些，不当正文。
 *
 * 只影响显示：消息本身（含 reasoning）照旧保存，协议层由 agentLoop 负责剥离。
 */

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const INTERNAL_PREFIX =
  /^(?:user approved|run the node|ask (?:the )?user|now applyPlan|applyPlan|call runNode|call runFrom|first,? call|then call|next,? call|let's|let me|we should|report concisely|ask if)/i
/** 句末：中文标点后直接断；英文 .!? 后需跟空白或另一句的大写开头 */
const SENTENCE = /[^。！？；!?;.]*(?:[。！？；]|[!?;.](?=\s|$|[A-Z\u3400-\u9fff])|$)/g

function publicSentence(sentence: string): boolean {
  const text = sentence.trim()
  if (!text) return false
  if (!HAN.test(text)) return false
  return !INTERNAL_PREFIX.test(text.replace(/\s+/g, ' '))
}

/** 过程文字（推理、工具旁白、实时过程流）里只留给用户看的句子。 */
/**
 * 原始字段 / 参数行（如 `Options: "我给你品牌名和口味", …`、`question: …`、`{"questions": …}`）：
 * 模型在推理里起草工具参数时留下的，含汉字也不是给用户看的过程（用户 2026-11-12 截图）。
 */
const RAW_FIELD_LINE = /^\s*(?:[-*]\s*)?(?:[A-Za-z_][\w.]{0,30}\s*[:：=]\s*["“'[{]|[{[]\s*["“])/

export function publicProcessText(text: string): string {
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (RAW_FIELD_LINE.test(line)) continue
    const kept = (line.match(SENTENCE) ?? [])
      .filter(publicSentence)
      .map((sentence) => sentence.trim())
      .join('')
    if (kept) lines.push(kept)
  }
  return lines.join('\n').trim()
}

const PROTOCOL_BLOCKS = [
  /<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g,
  /<｜tool▁call▁begin｜>[\s\S]*?(?:<｜tool▁call▁end｜>|$)/g,
  /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g,
  /<function_calls>[\s\S]*?(?:<\/function_calls>|$)/g,
]

function isToolCallJson(text: string): boolean {
  const body = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  if (!body.startsWith('{') && !body.startsWith('[')) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return false
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return (
    rows.length > 0 &&
    rows.every((row) => {
      if (!row || typeof row !== 'object') return false
      const r = row as Record<string, unknown>
      if (typeof r.tool === 'string') return true
      if (typeof r.name === 'string' && ('args' in r || 'arguments' in r)) return true
      return typeof r.function === 'object' && r.function !== null
    })
  )
}

/** 最终正文去掉工具协议残留；整段只是工具调用 JSON 时返回空串。 */
export function visibleAssistantReply(text: string): string {
  let out = text
  for (const pattern of PROTOCOL_BLOCKS) out = out.replace(pattern, '')
  /* 正文里混入的英文内部指令行（如「Report concisely. Ask if run.」）整行去掉 */
  out = out
    .split('\n')
    .filter((line) => HAN.test(line) || !INTERNAL_PREFIX.test(line.trim()))
    .join('\n')
    .trim()
  return isToolCallJson(out) ? '' : out
}
