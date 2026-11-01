import { describe, expect, it } from 'vitest'
import {
  DECLARATIVE_PROTOCOL_TEMPLATE,
  parseDeclarativeProtocol,
} from './protocolRecipe'

const chatImageProtocol = JSON.stringify({
  schema: 'qinghua.protocol/v1',
  name: '示例站点',
  short: '示例',
  versionPath: '/v1',
  auth: { type: 'bearer' },
  models: {
    request: { method: 'GET', path: '/models' },
    items: '$.data[*]',
    id: '$.id',
    category: 'chat',
  },
  chat: {
    request: {
      method: 'POST',
      path: '/chat/completions',
      body: {
        model: '{{model}}',
        messages: { $var: 'messages' },
        tools: { $var: 'tools' },
      },
    },
    response: {
      text: '$.choices[0].message.content',
      reasoning: '$.choices[0].message.reasoning_content',
      toolCalls: '$.choices[0].message.tool_calls[*]',
    },
  },
  image: {
    request: {
      method: 'POST',
      path: '/images/generations',
      body: {
        model: '{{model}}',
        prompt: '{{prompt}}',
        image: { $var: 'images' },
      },
    },
    result: ['$.data[*].url', '$.data[*].b64_json'],
  },
})

describe('declarative protocol package', () => {
  it('parses fenced JSON into a usable package', () => {
    const result = parseDeclarativeProtocol(
      `下面是协议：\n\`\`\`json\n${chatImageProtocol}\n\`\`\``,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      name: '示例站点',
      short: '示例',
      versionPath: '/v1',
      capabilities: ['chat', 'image'],
      recipe: {
        auth: { type: 'bearer', header: 'Authorization' },
        models: { items: '$.data[*]', id: '$.id', category: 'chat' },
      },
    })
  })

  it('normalizes asynchronous polling statuses without treating them as JSON paths', () => {
    const raw = JSON.parse(chatImageProtocol) as Record<string, unknown>
    raw.image = {
      request: {
        method: 'POST',
        path: '/images/tasks',
        body: { model: '{{model}}', prompt: '{{prompt}}' },
      },
      task: {
        id: '$.task_id',
        poll: { method: 'GET', path: '/images/tasks/{{taskId}}' },
        status: '$.status',
        success: ['completed', 'succeeded'],
        failure: ['failed'],
        result: ['$.output[*].url'],
        intervalMs: 1000,
        maxPolls: 20,
        timeoutMs: 30000,
      },
    }
    const result = parseDeclarativeProtocol(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.recipe.image?.task).toMatchObject({
      success: ['COMPLETED', 'SUCCEEDED'],
      failure: ['FAILED'],
      intervalMs: 1000,
      maxPolls: 20,
      timeoutMs: 30000,
    })
  })

  it('rejects arbitrary code, cross-origin paths, and unknown variables', () => {
    const crossOrigin = JSON.parse(chatImageProtocol) as Record<string, unknown>
    ;(crossOrigin.models as { request: { path: string } }).request.path =
      'https://evil.example/models'
    expect(parseDeclarativeProtocol(JSON.stringify(crossOrigin))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('站内相对路径'),
    })

    const unknownVariable = JSON.parse(chatImageProtocol) as Record<string, unknown>
    ;(
      unknownVariable.image as {
        request: { body: Record<string, unknown> }
      }
    ).request.body.prompt = '{{apiKey}}'
    expect(parseDeclarativeProtocol(JSON.stringify(unknownVariable))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('不支持的变量'),
    })
  })

  it('ships a downloadable template that parses as a valid protocol', () => {
    expect(parseDeclarativeProtocol(DECLARATIVE_PROTOCOL_TEMPLATE).ok).toBe(true)
  })
})
