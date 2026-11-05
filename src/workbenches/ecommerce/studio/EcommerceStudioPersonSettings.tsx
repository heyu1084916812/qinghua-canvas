import {
  AGE_OPTIONS,
  BODY_OPTIONS,
  ETHNICITY_OPTIONS,
  GENDER_OPTIONS,
  modeOptionString,
} from '../../../domain/ecommerce/modeOptions'
import type { EcommerceModeOptions } from '../../../domain/ecommerce/types'
import { EcommerceSelect } from '../EcommerceSelect'
import { styles } from './studioStyles'
import { textOptions } from './studioSharedViews'
export function PersonSettings({
  options,
  setOption,
}: {
  options: EcommerceModeOptions
  setOption: (key: string, value: string | string[] | Record<string, number>) => void
}) {
  const source = modeOptionString(options, 'modelSource', 'ai')
  return (
    <div className={styles.personSettings}>
      <span className={styles.fieldLabel}>模特形象</span>
      <div className={styles.segments} role="radiogroup" aria-label="模特来源">
        {[
          ['ai', 'AI 生成'],
          ['upload', '自行上传'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={source === id}
            className={
              source === id ? `${styles.seg} ${styles.segOn}` : styles.seg
            }
            data-ecommerce-option={`model-source-${id}`}
            onClick={() => setOption('modelSource', id)}
          >
            {label}
          </button>
        ))}
      </div>
      {source === 'upload' ? (
        <span className={styles.hint}>请在上方参考素材中上传模特照片</span>
      ) : (
        <div className={styles.personGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>性别</span>
            <EcommerceSelect
              ariaLabel="模特性别"
              name="model-gender"
              value={modeOptionString(options, 'modelGender', 'female')}
              onChange={(value) => setOption('modelGender', value)}
              options={textOptions(GENDER_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-gender' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>年龄</span>
            <EcommerceSelect
              ariaLabel="模特年龄"
              name="model-age"
              value={modeOptionString(options, 'modelAge', 'young')}
              onChange={(value) => setOption('modelAge', value)}
              options={textOptions(AGE_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-age' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>族裔</span>
            <EcommerceSelect
              ariaLabel="模特族裔"
              name="model-ethnicity"
              value={modeOptionString(options, 'modelEthnicity', 'asian')}
              onChange={(value) => setOption('modelEthnicity', value)}
              options={textOptions(ETHNICITY_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-ethnicity' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>体型</span>
            <EcommerceSelect
              ariaLabel="模特体型"
              name="model-body"
              value={modeOptionString(options, 'modelBody', 'standard')}
              onChange={(value) => setOption('modelBody', value)}
              options={textOptions(BODY_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-body' }}
            />
          </div>
        </div>
      )}
      <input
        className={styles.input}
        value={modeOptionString(options, 'modelDetails')}
        placeholder="补充细节（选填）：发型、妆容偏好等"
        data-ecommerce-option="model-details"
        onChange={(e) => setOption('modelDetails', e.target.value)}
      />
    </div>
  )
}
