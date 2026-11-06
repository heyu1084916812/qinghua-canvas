import type {
  CustomProtocolInput,
  CustomProtocolValidation,
  ProtocolCatalog,
  ProtocolDefinition,
} from '../../../domain/project/protocol'
import {
  builtinProtocolReferenceForExport,
  protocolPackageForExport,
  serializeBuiltinProtocolReference,
  serializeProtocolPackage,
} from '../../../domain/project/protocolExport'
import {
  DECLARATIVE_PROTOCOL_TEMPLATE,
  parseDeclarativeProtocol,
  type DeclarativeProtocolPackage,
} from '../../../domain/project/protocolRecipe'
import { protocolById } from '../../../domain/project/protocol'
import { customProtocolIdForName, customProtocolShortForName, protocolVersionForBaseUrl } from '../customProtocolDraft'
import type { ChannelStore } from '../../../state/channel/channelStore'
import type { PlatformKit } from '../../../platform/ports'

export interface ProtocolActionState {
  selectedId: string | null
  protocol: string
  baseUrl: string
  catalog: ProtocolCatalog
  npImportText: string
  npImported: DeclarativeProtocolPackage | null
  newProtoOpen: boolean
}

export interface ProtocolActionPorts {
  channels: ChannelStore
  platform: Pick<PlatformKit, 'files'>
  setCatalogVersion(update: (value: number) => number): void
  setProtocol(value: string): void
  setBaseUrl(value: string): void
  setNpImportText(value: string): void
  setNpImported(value: DeclarativeProtocolPackage | null): void
  setNpError(value: string): void
  setNpNotice(value: string): void
  setProtoRemoveError(value: string): void
  setProtoManageNotice(value: string): void
  setNewProtoOpen(value: boolean): void
}

type CreatedProtocol = Extract<CustomProtocolValidation, { ok: true }>

export type ProtocolActions = ReturnType<typeof createProtocolActions>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 自建协议导入、导出、删除与恢复；目录和文件保存仍由领域/store 端口负责。 */
export function createProtocolActions(ports: ProtocolActionPorts) {
  const createWithUniqueId = async (
    state: ProtocolActionState,
    draft: Omit<CustomProtocolInput, 'id'> & { idHint?: string },
  ): Promise<CustomProtocolValidation> => {
    const existingIds = new Set(state.catalog.all.map((item) => item.id))
    let id = customProtocolIdForName(draft.idHint ?? draft.name, existingIds)
    let result = await ports.channels.createCustomProtocol({ ...draft, id })
    for (
      let attempt = 0;
      !result.ok &&
      result.field === 'id' &&
      result.reason.includes('已被占用') &&
      attempt < 20;
      attempt += 1
    ) {
      existingIds.add(id)
      id = customProtocolIdForName(draft.idHint ?? draft.name, existingIds)
      result = await ports.channels.createCustomProtocol({ ...draft, id })
    }
    return result
  }

  const bindCreatedProtocol = async (state: ProtocolActionState, result: CreatedProtocol): Promise<void> => {
    ports.setCatalogVersion((value) => value + 1)
    ports.setProtocol(result.value.id)
    if (state.selectedId) {
      await ports.channels.update(state.selectedId, {
        protocol: result.value.id,
        baseUrl: state.baseUrl.trim(),
      })
    }
    if (!state.baseUrl.trim() && result.value.defaultBaseUrl) {
      ports.setBaseUrl(result.value.defaultBaseUrl)
    }
  }

  const checkImportedProtocol = (state: ProtocolActionState): DeclarativeProtocolPackage | null => {
    ports.setNpError('')
    ports.setNpNotice('')
    const parsed = parseDeclarativeProtocol(state.npImportText)
    if (!parsed.ok) {
      ports.setNpImported(null)
      ports.setNpError(parsed.reason)
      return null
    }
    ports.setNpImported(parsed.value)
    return parsed.value
  }

  const saveDownload = async (
    content: string,
    filename: string,
  ): Promise<'saved' | 'cancelled'> => {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    try {
      const files = ports.platform.files
      if (files.saveFileWithResult) return await files.saveFileWithResult(filename, blob)
      await files.saveFile(filename, blob)
      return 'saved'
    } catch (error) {
      ports.setProtoRemoveError(errorMessage(error))
      return 'cancelled'
    }
  }

  return {
    createWithUniqueId,
    bindCreatedProtocol,
    checkImportedProtocol,
    handleProtocolChange: (state: ProtocolActionState, id: string) => {
      const previousDefault = protocolById(state.protocol, state.catalog)?.defaultBaseUrl ?? ''
      const nextDefault = protocolById(id, state.catalog)?.defaultBaseUrl ?? ''
      ports.setProtocol(id)
      const current = state.baseUrl.trim()
      const nextBaseUrl =
        nextDefault && (!current || current === previousDefault) ? nextDefault : state.baseUrl
      if (nextBaseUrl !== state.baseUrl) ports.setBaseUrl(nextBaseUrl)
      if (state.selectedId) {
        void ports.channels.update(state.selectedId, {
          protocol: id,
          baseUrl: nextBaseUrl.trim(),
        })
      }
    },
    importProtocolFile: async (file: File | undefined) => {
      if (!file) return
      const text = await file.text()
      ports.setNpImportText(text)
      ports.setNpImported(null)
      ports.setNpError('')
      const parsed = parseDeclarativeProtocol(text)
      if (!parsed.ok) {
        ports.setNpError(parsed.reason)
        return
      }
      ports.setNpImported(parsed.value)
    },
    saveImportedProtocol: async (state: ProtocolActionState) => {
      const imported = state.npImported ?? checkImportedProtocol(state)
      if (!imported) return
      ports.setNpError('')
      ports.setNpNotice('')
      const result = await createWithUniqueId(state, {
        idHint: imported.id ?? imported.name,
        name: imported.name,
        short: imported.short || customProtocolShortForName(imported.name),
        capabilities: imported.capabilities,
        versionPath: imported.versionPath ?? protocolVersionForBaseUrl(state.baseUrl),
        docUrl: imported.docUrl,
        recipe: imported.recipe,
      })
      if (!result.ok) {
        ports.setNpError(result.reason)
        return
      }
      await bindCreatedProtocol(state, result)
      ports.setNpImportText('')
      ports.setNpImported(null)
      ports.setNewProtoOpen(false)
      ports.setNpNotice(`已导入并选中「${result.value.name}」`)
    },
    saveDownload,
    downloadProtocolTemplate: async () => {
      const blob = new Blob([DECLARATIVE_PROTOCOL_TEMPLATE], {
        type: 'text/plain;charset=utf-8',
      })
      ports.setProtoRemoveError('')
      ports.setProtoManageNotice('')
      try {
        const files = ports.platform.files
        if (files.saveFileWithResult) {
          const outcome = await files.saveFileWithResult('轻画-自定义协议模板.txt', blob)
          if (outcome === 'cancelled') return
        } else {
          await files.saveFile('轻画-自定义协议模板.txt', blob)
        }
        ports.setProtoManageNotice('已下载协议模板')
      } catch (error) {
        ports.setProtoRemoveError(errorMessage(error))
      }
    },
    downloadProtocol: async (definition: ProtocolDefinition) => {
      ports.setProtoRemoveError('')
      ports.setProtoManageNotice('')
      if (definition.kind !== 'custom') {
        const reference = builtinProtocolReferenceForExport(definition)
        if (!reference) {
          ports.setProtoRemoveError('这条站点协议没有可导出的说明内容')
          return
        }
        const outcome = await saveDownload(
          serializeBuiltinProtocolReference(reference),
          `${definition.id}.protocol-reference.json`,
        )
        if (outcome === 'cancelled') return
        ports.setProtoManageNotice(`已下载「${definition.name}」协议说明`)
        return
      }
      const pkg = protocolPackageForExport(definition)
      if (!pkg) {
        ports.setProtoRemoveError('这条旧协议没有可导出的声明内容')
        return
      }
      const outcome = await saveDownload(
        serializeProtocolPackage(pkg),
        `${definition.id}.qinghua.json`,
      )
      if (outcome === 'cancelled') return
      ports.setProtoManageNotice(`已下载「${definition.name}」协议文件`)
    },
    toggleNewProtocol: (state: ProtocolActionState) => {
      const next = !state.newProtoOpen
      ports.setNewProtoOpen(next)
      if (next) {
        ports.setNpImportText('')
        ports.setNpImported(null)
        ports.setNpError('')
        ports.setNpNotice('')
      }
    },
    removeProtocol: async (state: ProtocolActionState, definition: ProtocolDefinition) => {
      ports.setProtoRemoveError('')
      ports.setProtoManageNotice('')
      try {
        if (state.selectedId) {
          await ports.channels.update(state.selectedId, {
            protocol: state.protocol,
            baseUrl: state.baseUrl.trim(),
          })
        }
        if (definition.kind === 'custom') {
          await ports.channels.removeCustomProtocol(definition.id)
          ports.setProtoManageNotice(`已删除「${definition.name}」`)
        } else {
          await ports.channels.removeBuiltinProtocol(definition.id)
          ports.setProtoManageNotice(`已移除「${definition.name}」，可从恢复入口找回`)
        }
        ports.setCatalogVersion((value) => value + 1)
      } catch (error) {
        ports.setProtoRemoveError(errorMessage(error))
      }
    },
    restoreBuiltinProtocols: async () => {
      ports.setProtoRemoveError('')
      ports.setProtoManageNotice('')
      try {
        await ports.channels.restoreBuiltinProtocols()
        ports.setCatalogVersion((value) => value + 1)
        ports.setProtoManageNotice('已恢复全部站点协议')
      } catch (error) {
        ports.setProtoRemoveError(errorMessage(error))
      }
    },
  }
}
