import type { EcommerceModeOptions } from '../../../domain/ecommerce/types'
import { ECOMMERCE_COUNT_MAX } from '../../../domain/ecommerce/types'
import {
  DETAIL_HIGHLIGHT_OPTIONS,
  PRODUCT_SET_COUNT_OPTIONS,
  RETOUCH_OPTIONS,
  WHITE_BG_ANGLE_OPTIONS,
  modeOptionCounts,
  modeOptionString,
  modeOptionStrings,
  whiteBgCountsOf,
} from '../../../domain/ecommerce/modeOptions'
import { ColorPickerPopover } from '../../../features/shared/colorPicker/ColorPickerPopover'
import { Check, Icon } from '../../../ui/icon'
import { styles } from './studioStyles'
import { OptionCheck, OptionContent } from './studioSharedViews'

export function ProductModeParameters({
  modeId,
  options,
  setOption,
  toggleOption,
}: {
  modeId: string
  options: EcommerceModeOptions
  setOption: (key: string, value: string | string[] | Record<string, number>) => void
  toggleOption: (key: string, id: string) => void
}) {
  const setCounts = modeOptionCounts(options)
  const updateSetCount = (id: string, delta: number) => {
    const next = Math.min(Math.max((setCounts[id] ?? 0) + delta, 0), ECOMMERCE_COUNT_MAX)
    setOption('setCounts', { ...setCounts, [id]: next })
  }
  const toggleSetCount = (id: string) => {
    const next = (setCounts[id] ?? 0) > 0 ? 0 : 1
    setOption('setCounts', { ...setCounts, [id]: next })
  }
  const selected = (key: string, id: string) => modeOptionStrings(options, key).includes(id)
  if (modeId === 'product-set') {
    const strategy = modeOptionString(options, 'setStrategy', 'smart')
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-set">
        <span className={styles.blockTitle}>套图结构配置</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="套图结构配置">
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'smart'}
            className={
              strategy === 'smart'
                ? `${styles.choiceCard} ${styles.choiceCardOn}`
                : styles.choiceCard
            }
            data-ecommerce-option="set-strategy-smart"
            onClick={() => setOption('setStrategy', 'smart')}
          >
            <span className={styles.choiceRadio} aria-hidden />
            <span>
              <span className={styles.choiceTitle}>智能匹配</span>
              <span className={styles.choiceHint}>AI 智能分析商品图，匹配最佳 Listing 套图</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'custom'}
            className={
              strategy === 'custom'
                ? `${styles.choiceCard} ${styles.choiceCardOn}`
                : styles.choiceCard
            }
            data-ecommerce-option="set-strategy-custom"
            onClick={() => setOption('setStrategy', 'custom')}
          >
            <span className={styles.choiceRadio} aria-hidden />
            <span>
              <span className={styles.choiceTitle}>自定义配置</span>
              <span className={styles.choiceHint}>可自由调整各类型图片数量，至少选择 1 张</span>
            </span>
          </button>
        </div>
        {strategy === 'custom' ? (
          <div className={styles.setCountList} data-ecommerce-set-counts>
            {PRODUCT_SET_COUNT_OPTIONS.map((item) => {
              const count = setCounts[item.id] ?? 0
              return (
                <div
                  key={item.id}
                  className={styles.setCountItem}
                  data-ecommerce-set-item={item.id}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={count > 0}
                    aria-label={`${item.label}${count > 0 ? '已启用' : '未启用'}`}
                    className={
                      count > 0
                        ? `${styles.setCheck} ${styles.setCheckOn}`
                        : styles.setCheck
                    }
                    data-ecommerce-set-enabled={item.id}
                    onClick={() => toggleSetCount(item.id)}
                  >
                    {count > 0 ? (
                      <Icon icon={Check} px={12} />
                    ) : null}
                  </button>
                  <span className={styles.setCountBody}>
                    <span className={styles.setCountTitleRow}>
                      <span className={styles.setCountTitle}>{item.label}</span>
                      {item.id === 'other' ? (
                        <span className={styles.setAiBadge}>AI 智能匹配</span>
                      ) : null}
                    </span>
                    {item.hint ? (
                      <span className={styles.setCountHint}>{item.hint}</span>
                    ) : null}
                  </span>
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      aria-label={`${item.label}减少一张`}
                      data-ecommerce-set-step={`${item.id}:-1`}
                      onClick={() => updateSetCount(item.id, -1)}
                    >
                      -
                    </button>
                    <span data-ecommerce-set-count={item.id}>{count}</span>
                    <button
                      type="button"
                      aria-label={`${item.label}增加一张`}
                      data-ecommerce-set-step={`${item.id}:1`}
                      onClick={() => updateSetCount(item.id, 1)}
                    >
                      +
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </section>
    )
  }

  if (modeId === 'product-detail') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-detail">
        <span className={styles.blockTitle}>快速优化项</span>
        <span className={styles.hint}>选择常用的优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {DETAIL_HIGHLIGHT_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('detailHighlights', item.id)}
              className={
                selected('detailHighlights', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`detail-${item.id}`}
              onClick={() => toggleOption('detailHighlights', item.id)}
            >
              <OptionCheck checked={selected('detailHighlights', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-recreate') {
    const level = modeOptionString(options, 'recreateLevel', 'style')
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-recreate">
        <span className={styles.blockTitle}>复刻程度</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="复刻程度">
          {[
            ['style', '参考风格', '参考整体风格与结构，自动调整色彩和重构场景'],
            ['high', '高度复刻', '参考构图与视觉结构替换产品，场景细节略有差异'],
          ].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={level === id}
              className={
                level === id
                  ? `${styles.choiceCard} ${styles.choiceCardOn}`
                  : styles.choiceCard
              }
              data-ecommerce-option={`recreate-${id}`}
              onClick={() => setOption('recreateLevel', id)}
            >
              <span className={styles.choiceRadio} aria-hidden />
              <span>
                <span className={styles.choiceTitle}>{label}</span>
                <span className={styles.choiceHint}>{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-white') {
    const counts = whiteBgCountsOf(options)
    const total = WHITE_BG_ANGLE_OPTIONS.reduce(
      (sum, item) => sum + Math.max(0, counts[item.id] ?? 0),
      0,
    )
    const setCount = (id: string, next: number) => {
      setOption('whiteBgCounts', {
        ...counts,
        [id]: Math.min(Math.max(next, 0), ECOMMERCE_COUNT_MAX),
      })
    }
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-white">
        <span className={styles.blockTitle}>白底模式</span>
        <div className={styles.segments} role="radiogroup" aria-label="白底模式">
          {[
            ['off', '单张白底'],
            ['on', '批量白底'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={modeOptionString(options, 'whiteBatch', 'off') === id}
              className={
                modeOptionString(options, 'whiteBatch', 'off') === id
                  ? `${styles.seg} ${styles.segOn}`
                  : styles.seg
              }
              data-ecommerce-white-batch={id}
              onClick={() => setOption('whiteBatch', id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>白底角度</span>
          <span className={styles.hint} data-ecommerce-white-total>
            共 {total} 张 · 每个角度独立生成
          </span>
        </div>
        <div className={styles.setCountList} data-ecommerce-white-angles>
          {WHITE_BG_ANGLE_OPTIONS.map((item) => {
            const count = counts[item.id] ?? 0
            return (
              <div className={styles.setCountItem} key={item.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={count > 0}
                  aria-label={`${item.label}${count > 0 ? '已启用' : '未启用'}`}
                  className={
                    count > 0
                      ? `${styles.setCheck} ${styles.setCheckOn}`
                      : styles.setCheck
                  }
                  data-ecommerce-white-enabled={item.id}
                  onClick={() => setCount(item.id, count > 0 ? 0 : 1)}
                >
                  {count > 0 ? (
                    <Icon icon={Check} px={12} />
                  ) : null}
                </button>
                <span className={styles.setCountBody}>
                  <span className={styles.setCountTitle}>{item.label}</span>
                  {item.hint ? (
                    <span className={styles.setCountHint}>{item.hint}</span>
                  ) : null}
                </span>
                <span className={styles.stepper}>
                  <button
                    type="button"
                    aria-label={`${item.label}减少一张`}
                    data-ecommerce-white-step={`${item.id}:-1`}
                    onClick={() => setCount(item.id, count - 1)}
                  >
                    -
                  </button>
                  <span data-ecommerce-white-count={item.id}>{count}</span>
                  <button
                    type="button"
                    aria-label={`${item.label}增加一张`}
                    data-ecommerce-white-step={`${item.id}:1`}
                    onClick={() => setCount(item.id, count + 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  if (modeId === 'product-retouch') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-retouch">
        <span className={styles.blockTitle}>快速优化项</span>
        <span className={styles.hint}>选择常用优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {RETOUCH_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('retouchActions', item.id)}
              className={
                selected('retouchActions', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`retouch-${item.id}`}
              onClick={() => toggleOption('retouchActions', item.id)}
            >
              <OptionCheck checked={selected('retouchActions', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-recolor') {
    const targetColor = modeOptionString(options, 'targetColor', '#ff6b00')
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-recolor">
        <span className={styles.blockTitle}>目标颜色</span>
        <span className={styles.hint}>选择要替换成的目标颜色</span>
        <div className={styles.colorControl}>
          <ColorPickerPopover
            value={targetColor}
            target="ecommerce-recolor"
            label="选择商品替换颜色"
            onCommit={(value) => setOption('targetColor', value)}
            renderTrigger={({ open, toggle }) => (
              <button
                type="button"
                className={styles.colorWell}
                aria-label="选择商品替换颜色"
                aria-haspopup="dialog"
                aria-expanded={open}
                data-ecommerce-color
                onClick={toggle}
              >
                <span style={{ background: targetColor }} aria-hidden />
              </button>
            )}
          />
          <span className={styles.colorValue} data-ecommerce-color-hex>
            {targetColor.toUpperCase()}
          </span>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            颜色容差 {modeOptionString(options, 'colorTolerance', '60')}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={modeOptionString(options, 'colorTolerance', '60')}
            data-ecommerce-color-tolerance
            onChange={(e) => setOption('colorTolerance', e.target.value)}
          />
        </label>
      </section>
    )
  }
  return null
}
