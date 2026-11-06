import type { EcommerceModeOptions, EcommerceLanguage } from '../../../domain/ecommerce/types'
import { ecommerceLanguageOptions, ecommerceRatioOptions } from '../../../domain/ecommerce/types'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import { modeOptionString } from '../../../domain/ecommerce/modeOptions'
import { EcommerceSelect } from '../EcommerceSelect'
import { styles } from './studioStyles'
import type { StudioMode } from './studioContracts'
import type { StudioImageParameterChoice } from './controller/studioFormProjection'

export function EcommerceStudioCommonParameters({
  mode,
  modeOptions,
  platformId,
  orderedPlatforms,
  language,
  ratio,
  resolution,
  quality,
  resolutionChoices,
  qualityChoices,
  showCommonFields,
  showPlatformAndLanguage,
  showLanguageField,
  showRatioField,
  showResolutionField,
  showQualityField,
  setModeOption,
  setPlatformId,
  setLanguage,
  setRatio,
  setResolution,
  setQuality,
}: {
  mode: StudioMode
  modeOptions: EcommerceModeOptions
  platformId: string
  orderedPlatforms: readonly EcommercePlatform[]
  language: EcommerceLanguage
  ratio: string
  resolution: string
  quality: string
  resolutionChoices: readonly StudioImageParameterChoice[]
  qualityChoices: readonly StudioImageParameterChoice[]
  showCommonFields: boolean
  showPlatformAndLanguage: boolean
  showLanguageField: boolean
  showRatioField: boolean
  showResolutionField: boolean
  showQualityField: boolean
  setModeOption: (key: string, value: string | string[] | Record<string, number>) => void
  setPlatformId: (value: string) => void
  setLanguage: (value: EcommerceLanguage) => void
  setRatio: (value: string) => void
  setResolution: (value: string) => void
  setQuality: (value: string) => void
}) {
  if (!showCommonFields) return null
  return (
    <section className={styles.block} data-param-section="common">
      <div className={styles.twoCols}>
        {showPlatformAndLanguage && mode.mediaKind === 'video' ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>市场地区</span>
            <EcommerceSelect
              ariaLabel="市场地区"
              name="market-region"
              value={modeOptionString(modeOptions, 'marketRegion', 'us')}
              onChange={(value) => setModeOption('marketRegion', value)}
              options={[
                { value: 'us', label: '美国' },
                { value: 'uk', label: '英国' },
                { value: 'eu', label: '欧洲' },
                { value: 'sea', label: '东南亚' },
                { value: 'me', label: '中东' },
              ]}
              dataAttributes={{ 'data-ecommerce-market-region': true }}
            />
          </div>
        ) : showPlatformAndLanguage ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>上架平台</span>
            <EcommerceSelect
              ariaLabel="上架平台"
              name="platform"
              value={platformId}
              onChange={setPlatformId}
              options={[
                { value: '', label: '不指定（通用）' },
                ...orderedPlatforms.map((platform) => ({
                  value: platform.id,
                  label: platform.name,
                })),
              ]}
              dataAttributes={{ 'data-ecommerce-platform': true }}
            />
          </div>
        ) : null}
        {showLanguageField ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>语言</span>
            <EcommerceSelect
              ariaLabel="输出语言"
              name="language"
              value={language}
              onChange={(value) => setLanguage(value as EcommerceLanguage)}
              options={ecommerceLanguageOptions(mode.usage)}
              dataAttributes={{ 'data-ecommerce-language': true }}
            />
          </div>
        ) : null}
        {showRatioField ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              {mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
            </span>
            <EcommerceSelect
              ariaLabel={mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
              name="ratio"
              value={ratio}
              onChange={setRatio}
              options={ecommerceRatioOptions(mode.usage, mode.mediaKind)}
              dataAttributes={{ 'data-ecommerce-ratio': true }}
            />
          </div>
        ) : null}
        {showResolutionField ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>分辨率</span>
            <EcommerceSelect
              ariaLabel="图片分辨率"
              name="resolution"
              value={resolution}
              onChange={setResolution}
              options={resolutionChoices}
              dataAttributes={{ 'data-ecommerce-resolution': true }}
            />
          </div>
        ) : null}
        {showQualityField ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>质量</span>
            <EcommerceSelect
              ariaLabel="图片质量"
              name="quality"
              value={quality}
              onChange={setQuality}
              options={qualityChoices}
              dataAttributes={{ 'data-ecommerce-quality': true }}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
