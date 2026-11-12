import { useMemo } from 'react'
import type { UserSkill } from '../../domain/prompt/skill'
import { SkillDetailDialog, type SkillDetailSource } from './SkillDetailDialog'
import { SkillsBrowser, type SkillCardPick } from './SkillsBrowser'
import type { SkillLibraryState } from './useSkillLibraryState'

/**
 * 技能库的浏览视图：来源页签、分类、搜索、卡片与详情弹窗。
 *
 * 技能页（`/skills`）与画布上的 Agent 技能浮层共用它，状态由 `useSkillLibraryState`
 * 持有。`contained` 时详情弹窗收在外层浮层里（不铺满整个窗口）。
 */
export function SkillLibraryView({
  state,
  onNew,
  onOpenPresets,
  onEdit,
  contained = false,
}: {
  state: SkillLibraryState
  onNew: (draft: Omit<UserSkill, 'id' | 'updatedAt' | 'source'>) => void
  onOpenPresets: () => void
  onEdit?: (pick: SkillCardPick) => void
  contained?: boolean
}) {
  const { detail } = state
  const detailSource: SkillDetailSource | null = useMemo(
    () =>
      detail?.kind === 'libtv'
        ? { kind: 'libtv', skill: detail.skill }
        : detail?.kind === 'builtin'
          ? { kind: 'builtin', skill: detail.skill }
          : detail?.kind === 'user'
            ? { kind: 'user', skill: detail.skill }
            : null,
    [detail],
  )
  return (
    <>
      <SkillsBrowser
        source={state.source}
        category={state.category}
        query={state.query}
        favorites={state.favorites}
        onSource={(next) => {
          state.setSource(next)
          state.setQuery('')
        }}
        onCategory={state.setCategory}
        onQuery={state.setQuery}
        onToggleFavorite={(pick) => void state.toggleFavorite(pick)}
        onOpenDetail={state.setDetail}
        onUse={(pick) => void state.addToAgent(pick)}
        onNew={onNew}
        onOpenPresets={onOpenPresets}
      />
      {detail && detailSource ? (
        <SkillDetailDialog
          source={detailSource}
          favorite={state.favorites.includes(detail.skill.id)}
          busy={state.busy}
          contained={contained}
          onClose={state.closeDetail}
          onToggleFavorite={() => void state.toggleFavorite(detail)}
          onAddToAgent={() => void state.addToAgent(detail)}
          onEdit={detail.kind === 'libtv' || !onEdit ? undefined : () => onEdit(detail)}
        />
      ) : null}
    </>
  )
}
