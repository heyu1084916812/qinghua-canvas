import { WORKBENCHES, WORKBENCH_ORDER, type WorkbenchId } from '../../../domain/shared/workbench'
import styles from './NewProjectChoice.module.css'

export function NewProjectChoice({
  onChoose,
  onClose,
}: {
  onChoose: (workbench: WorkbenchId) => void
  onClose: () => void
}) {
  return (
    <div className={styles.scrim} data-new-project-choice onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="选择新建项目类型"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div>
            <h2>新建项目</h2>
            <p>先选择要进入的工作区。</p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭"
            data-new-project-choice-close
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className={styles.choices}>
          {WORKBENCH_ORDER.map((id) => (
            <button
              type="button"
              key={id}
              className={styles.choice}
              data-new-project-choice={id}
              onClick={() => onChoose(id)}
            >
              <strong>{WORKBENCHES[id].label}</strong>
              <span>
                {id === 'canvas'
                  ? '节点式图片、视频与提示词编排'
                  : id === 'ecommerce'
                    ? '商品套图、详情页与视频任务'
                    : '剧本、分集、分镜与角色资产'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
