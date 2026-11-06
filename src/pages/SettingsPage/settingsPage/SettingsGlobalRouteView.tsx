import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { StrategyPicker } from '../SettingsPicker'
import type { RouteCandidateRow } from '../settingsPageRoutingRules'
import { settingsPageStyles as styles } from './settingsPageStyles'

type RoutingChannelGroup = {
  channelId: string
  channelName: string
  candidates: RouteCandidateRow[]
}

export type SettingsGlobalRouteViewProps = {
  strategy: string
  strategyOptions: { value: string; label: string; hint?: string }[]
  maxAttempts: number
  scopeOpen: boolean
  allowedCandidatesCount: number
  routingCandidatesCount: number
  selectedRoutingCandidateKeys: ReadonlySet<string>
  routingChannelGroups: RoutingChannelGroup[]
  expandedRoutingChannels: ReadonlySet<string>
  onStrategyChange: (value: string) => void
  onMaxAttemptsChange: (value: string) => void
  onToggleScope: () => void
  onResetScope: () => void
  onToggleRoutingChannel: (
    candidates: readonly RouteCandidateRow[],
    checked: boolean,
  ) => void
  onToggleRoutingChannelExpanded: (channelId: string) => void
  onToggleRoutingCandidate: (key: string, checked: boolean) => void
}

export function SettingsGlobalRouteView({
  strategy,
  strategyOptions,
  maxAttempts,
  scopeOpen,
  allowedCandidatesCount,
  routingCandidatesCount,
  selectedRoutingCandidateKeys,
  routingChannelGroups,
  expandedRoutingChannels,
  onStrategyChange,
  onMaxAttemptsChange,
  onToggleScope,
  onResetScope,
  onToggleRoutingChannel,
  onToggleRoutingChannelExpanded,
  onToggleRoutingCandidate,
}: SettingsGlobalRouteViewProps) {
  return (
    <>
      <section className={styles.globalRoute} data-settings-global-route>
        <div className={styles.globalRouteText}>
          <span className={styles.cardTitle}>选路策略</span>
          <span className={styles.cardSub}>
            同一模型可用时，按此规则选择渠道和 Key 分组。
          </span>
        </div>
        <div className={styles.globalRouteControls}>
          <StrategyPicker
            value={strategy}
            options={strategyOptions}
            onChange={onStrategyChange}
          />
          <ChoicePicker
            name="routing-max-attempts"
            value={String(maxAttempts)}
            options={[1, 2, 3, 4, 5].map((count) => ({
              value: String(count),
              label: `最多 ${count} 次`,
            }))}
            ariaLabel="最大尝试次数"
            onChange={onMaxAttemptsChange}
          />
          <button
            type="button"
            className={
              scopeOpen
                ? `${styles.routeScopeButton} ${styles.routeScopeButtonOpen}`
                : styles.routeScopeButton
            }
            data-routing-scope-toggle
            aria-expanded={scopeOpen}
            onClick={onToggleScope}
          >
            路由范围
            <span>
              {selectedRoutingCandidateKeys.size}/{routingCandidatesCount}
            </span>
          </button>
        </div>
      </section>

      {scopeOpen && (
        <section className={styles.routeScopePanel} data-routing-scope>
          <div className={styles.routeScopeHead}>
            <div className={styles.globalRouteText}>
              <span className={styles.cardTitle}>参与路由的 Key 分组</span>
              <span className={styles.cardSub}>
                至少保留一项；未勾选的分组不会被自动回退使用。
              </span>
            </div>
            <button
              type="button"
              className={styles.routeScopeReset}
              disabled={allowedCandidatesCount === 0}
              onClick={onResetScope}
            >
              全部可用
            </button>
          </div>
          {routingCandidatesCount === 0 ? (
            <p className={styles.routeScopeEmpty}>还没有可参与路由的渠道。</p>
          ) : (
            <div className={styles.routeScopeChannels}>
              {routingChannelGroups.map((group) => {
                const checkedCount = group.candidates.filter((candidate) =>
                  selectedRoutingCandidateKeys.has(candidate.key),
                ).length
                const allChecked = checkedCount === group.candidates.length
                const mixed = checkedCount > 0 && !allChecked
                const expanded = expandedRoutingChannels.has(group.channelId)
                return (
                  <article
                    key={group.channelId}
                    className={styles.routeScopeChannel}
                    data-routing-channel={group.channelId}
                    data-routing-channel-groups-count={group.candidates.length}
                    data-routing-channel-checked={
                      allChecked ? 'true' : mixed ? 'mixed' : 'false'
                    }
                  >
                    <div className={styles.routeScopeChannelHead}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={mixed ? 'mixed' : allChecked}
                        aria-label={`${group.channelName} 的 Key 分组`}
                        className={styles.routeScopeChannelCheck}
                        data-routing-channel-toggle={group.channelId}
                        onClick={() =>
                          onToggleRoutingChannel(group.candidates, !allChecked)
                        }
                      >
                        {allChecked ? '✓' : mixed ? '−' : ''}
                      </button>
                      <span className={styles.routeScopeOptionText}>
                        <b>{group.channelName}</b>
                        <small>
                          {checkedCount}/{group.candidates.length} 个 Key 分组参与路由
                        </small>
                      </span>
                      <button
                        type="button"
                        className={styles.routeScopeChannelExpand}
                        aria-expanded={expanded}
                        aria-controls={`routing-groups-${group.channelId}`}
                        data-routing-channel-expand={group.channelId}
                        onClick={() => onToggleRoutingChannelExpanded(group.channelId)}
                      >
                        {group.candidates.length} 个分组
                        <span aria-hidden>{expanded ? '⌃' : '⌄'}</span>
                      </button>
                    </div>
                    {expanded ? (
                      <div
                        id={`routing-groups-${group.channelId}`}
                        className={styles.routeScopeGrid}
                        data-routing-channel-groups={group.channelId}
                      >
                        {group.candidates.map((candidate) => {
                          const checked = selectedRoutingCandidateKeys.has(candidate.key)
                          return (
                            <label
                              key={candidate.key}
                              className={styles.routeScopeOption}
                              data-routing-candidate={candidate.key}
                              data-routing-candidate-checked={checked ? 'true' : 'false'}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  onToggleRoutingCandidate(
                                    candidate.key,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span className={styles.routeScopeOptionText}>
                                <b>{candidate.groupName}</b>
                                <small>
                                  {!candidate.enabled
                                    ? '已停用'
                                    : !candidate.hasToken
                                      ? '未配置 Key'
                                      : '可用于路由'}
                                </small>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}
    </>
  )
}
