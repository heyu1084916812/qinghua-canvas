import type { ProtocolDefinition } from './protocol'
import type {
  DeclarativeProtocolCapability,
  DeclarativeProtocolPackage,
  DeclarativeProtocolRecipe,
} from './protocolRecipe'

function declarativeCapabilities(
  capabilities: ProtocolDefinition['capabilities'],
): DeclarativeProtocolCapability[] {
  return capabilities.filter(
    (capability): capability is DeclarativeProtocolCapability =>
      capability === 'chat' || capability === 'image' || capability === 'video',
  )
}

function legacyOpenAiRecipe(
  capabilities: DeclarativeProtocolCapability[],
): DeclarativeProtocolRecipe {
  const recipe: DeclarativeProtocolRecipe = {
    version: 1,
    auth: { type: 'bearer', header: 'Authorization' },
    models: {
      request: { method: 'GET', path: '/models' },
      items: '$.data[*]',
      id: '$.id',
      category: 'unknown',
    },
  }
  if (capabilities.includes('chat')) {
    recipe.chat = {
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
        finishReason: '$.choices[0].finish_reason',
        toolCalls: '$.choices[0].message.tool_calls[*]',
      },
    }
  }
  if (capabilities.includes('image')) {
    recipe.image = {
      request: {
        method: 'POST',
        path: '/images/generations',
        body: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          n: '{{count}}',
          size: '{{size}}',
          image: { $var: 'images' },
        },
      },
      result: ['$.data[*].url', '$.data[*].b64_json'],
    }
  }
  if (capabilities.includes('video')) {
    recipe.video = {
      request: {
        method: 'POST',
        path: '/videos/generations',
        body: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          duration: '{{duration}}',
          size: '{{resolution}}',
        },
      },
      result: ['$.data[*].url', '$.url'],
    }
  }
  return recipe
}

/**
 * Export only user-created protocols. Built-in station protocols contain
 * provider-specific branches that a downloadable declaration cannot recreate,
 * so presenting them as portable recipes would be a lie.
 */
export function protocolPackageForExport(
  definition: ProtocolDefinition,
): DeclarativeProtocolPackage | null {
  if (definition.kind !== 'custom') return null
  const capabilities = declarativeCapabilities(definition.capabilities)
  if (capabilities.length === 0) return null
  const recipe =
    definition.recipe ??
    (definition.family === 'openai-compatible'
      ? legacyOpenAiRecipe(capabilities)
      : null)
  if (!recipe) return null
  return {
    schema: 'qinghua.protocol/v1',
    id: definition.id,
    name: definition.name,
    short: definition.short,
    ...(definition.versionPath ? { versionPath: definition.versionPath } : {}),
    ...(definition.docUrl ? { docUrl: definition.docUrl } : {}),
    capabilities,
    recipe,
  }
}

export function serializeProtocolPackage(value: DeclarativeProtocolPackage): string {
  const document = {
    schema: value.schema,
    ...(value.id ? { id: value.id } : {}),
    name: value.name,
    ...(value.short ? { short: value.short } : {}),
    ...(value.versionPath ? { versionPath: value.versionPath } : {}),
    ...(value.docUrl ? { docUrl: value.docUrl } : {}),
    auth: value.recipe.auth,
    models: value.recipe.models,
    ...(value.recipe.chat ? { chat: value.recipe.chat } : {}),
    ...(value.recipe.image ? { image: value.recipe.image } : {}),
    ...(value.recipe.video ? { video: value.recipe.video } : {}),
  }
  return `${JSON.stringify(document, null, 2)}\n`
}
