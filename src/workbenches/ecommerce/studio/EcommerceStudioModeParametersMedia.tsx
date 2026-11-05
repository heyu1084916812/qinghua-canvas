import type { EcommerceModeOptions } from '../../../domain/ecommerce/types'
import {
  VIDEO_TYPE_OPTIONS,
  WEAR_DETAIL_OPTIONS,
  WEAR_TYPE_OPTIONS,
  modeOptionString,
  modeOptionStrings,
} from '../../../domain/ecommerce/modeOptions'
import { EcommerceSelect } from '../EcommerceSelect'
import { styles } from './studioStyles'
import { OptionCheck, OptionContent } from './studioSharedViews'
import { PersonSettings } from './EcommerceStudioPersonSettings'

export function MediaAndWearModeParameters({
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
  const selected = (key: string, id: string) => modeOptionStrings(options, key).includes(id)
  if (modeId === 'video-recreate') {
    const replicate = modeOptionString(options, 'videoReplicateMode', 'full')
    return (
      <section className={styles.block} data-ecommerce-mode-params="video-recreate">
        <span className={styles.blockTitle}>视频复刻模式</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="视频复刻模式">
          {[
            ['full', '完全复刻', '完全复刻视频中的商品、构图、镜头与节奏'],
            ['similar', '相似复刻', '参考镜头结构与风格，允许画面自然变化'],
          ].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={replicate === id}
              className={
                replicate === id
                  ? `${styles.choiceCard} ${styles.choiceCardOn}`
                  : styles.choiceCard
              }
              data-ecommerce-option={`video-replicate-${id}`}
              onClick={() => setOption('videoReplicateMode', id)}
            >
              <span className={styles.choiceRadio} aria-hidden />
              <span>
                <span className={styles.choiceTitle}>{label}</span>
                <span className={styles.choiceHint}>{hint}</span>
              </span>
            </button>
          ))}
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'video-commerce') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="video-commerce">
        <span className={styles.blockTitle}>视频类型</span>
        <span className={styles.hint}>选择常用优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {VIDEO_TYPE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('videoTypes', item.id)}
              className={
                selected('videoTypes', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`video-${item.id}`}
              onClick={() => toggleOption('videoTypes', item.id)}
            >
              <OptionCheck checked={selected('videoTypes', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-set') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-set">
        <span className={styles.blockTitle}>生成类型</span>
        <div className={styles.optionGrid}>
          {WEAR_TYPE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('wearTypes', item.id)}
              className={
                selected('wearTypes', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`wear-${item.id}`}
              onClick={() => toggleOption('wearTypes', item.id)}
            >
              <OptionCheck checked={selected('wearTypes', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>展示面</span>
          <EcommerceSelect
            ariaLabel="展示面"
            name="wear-side"
            value={modeOptionString(options, 'wearSide', 'front')}
            onChange={(value) => setOption('wearSide', value)}
            options={[
              { value: 'front', label: '正面' },
              { value: 'back', label: '背面' },
              { value: 'both', label: '正面与背面' },
            ]}
            dataAttributes={{ 'data-ecommerce-option': 'wear-side' }}
          />
        </div>
      </section>
    )
  }

  if (modeId === 'wear-model') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-model">
        <span className={styles.blockTitle}>模特形象</span>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-tryon') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-tryon">
        <span className={styles.blockTitle}>试穿配置</span>
        <div className={styles.twoCols}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>人物保留</span>
            <EcommerceSelect
              ariaLabel="人物保留"
              name="person-preserve"
              value={modeOptionString(options, 'personPreserve', 'high')}
              onChange={(value) => setOption('personPreserve', value)}
              options={[
                { value: 'high', label: '自然保持' },
                { value: 'strict', label: '严格保持' },
              ]}
              dataAttributes={{ 'data-ecommerce-option': 'person-preserve' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>服装版型</span>
            <EcommerceSelect
              ariaLabel="服装版型"
              name="outfit-preserve"
              value={modeOptionString(options, 'outfitPreserve', 'on')}
              onChange={(value) => setOption('outfitPreserve', value)}
              options={[
                { value: 'on', label: '严格保持' },
                { value: 'off', label: '允许微调' },
              ]}
              dataAttributes={{ 'data-ecommerce-option': 'outfit-preserve' }}
            />
          </div>
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-detail') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-detail">
        <span className={styles.blockTitle}>细节类型</span>
        <div className={styles.optionGrid}>
          {WEAR_DETAIL_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('wearDetails', item.id)}
              className={
                selected('wearDetails', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`wear-detail-${item.id}`}
              onClick={() => toggleOption('wearDetails', item.id)}
            >
              <OptionCheck checked={selected('wearDetails', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  return null
  return null
}
