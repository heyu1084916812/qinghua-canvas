import { useEffect, useMemo, useState } from 'react'
import { usePlatformOptional } from '../../../../app/providers/PlatformProvider'
import type { ContextKit } from '../../../../domain/shared/context'
import { kitMentionId } from '../../../../domain/shared/kitMention'
import { createContextRepository } from '../../../../state/shared/contextRepository'

const KIND_LABEL: Record<ContextKit['kind'], string> = {
  brand: '品牌',
  product: '产品',
  role: '角色',
  custom: '自定义',
}

export interface KitMentionOption {
  value: string
  label: string
  hint: string
}

/** 套件 → @ 菜单选项；value 里冻结当前版本（`kit:<id>@v<n>`）。 */
export function kitMentionOptions(kits: readonly ContextKit[]): KitMentionOption[] {
  return [...kits]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((kit) => ({
      value: `kit:${kitMentionId(kit.id, kit.currentVersion)}`,
      label: kit.name,
      hint: `${KIND_LABEL[kit.kind] ?? '套件'} · v${kit.currentVersion}`,
    }))
}

/**
 * Agent @ 菜单「套件」分组的数据源：菜单打开时读一次套件库（套件可能刚在弹窗里新建）。
 * 读失败或没有平台 Provider（独立渲染）时只留空列表，不拦住其他分组。
 */
export function useAgentKitMentionOptions(active: boolean): KitMentionOption[] {
  const platform = usePlatformOptional()
  const repo = useMemo(
    () => (platform ? createContextRepository(platform.storage) : null),
    [platform],
  )
  const [kits, setKits] = useState<ContextKit[]>([])
  useEffect(() => {
    if (!active || !repo) return
    let alive = true
    void repo.listKits().then(
      (rows) => {
        if (alive) setKits(rows)
      },
      () => {
        if (alive) setKits([])
      },
    )
    return () => {
      alive = false
    }
  }, [active, repo])
  return useMemo(() => kitMentionOptions(kits), [kits])
}
