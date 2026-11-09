import { useNavigate } from 'react-router-dom'
import { requestNewProjectChoice } from '../../state/ui/newProjectChoice'
import { CatLogo } from '../../app/CatLogo'
import { QinghuaWordmark } from '../../app/QinghuaWordmark'
import styles from './HomePage.module.css'

/**
 * 首页（产品文档 §5.1：`/`）。
 *
 * 2026-09-27 应用壳改版后它**变轻了**：原来那个叫「首页」的页面装着项目网格，
 * 而项目网格已按 §5.1 迁到一级「项目」页（`/projects`）。
 * 这里只留欢迎与快捷入口 —— 首页是「进门第一眼」，不是第二个项目页。
 *
 * 刻意**不画顶栏 / 品牌 / 主题切换**：那些归应用壳（§5.2）。
 */
export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className={styles.page} data-home-page>
      <div className={styles.inner}>
        {/*
          猫画动态 Logo（用户 2026-09-27：「首页的 logo 也同步替换我要的猫画里面的那个动态图标」）。
          与侧栏用**同一个组件**：同一处资源、同一套尺寸口径 ——
          两处各写一份的话，换图标时必然漏掉一个。
        */}
        <CatLogo size={72} className={styles.logo} />
        {/* 文字标换成用户给的 QINGHUA 字形（2026-09-29 第 13 / 14 轮）：
            完整复刻原 SVG 字样（含 Q 斜尾与 A 星形），配色交给 `currentColor`
            跟随主题。`aria-label` 保留「轻画」——字形本身没有可读文本，
            删掉它读屏就没有页名了。 */}
        <h1 className={styles.title} aria-label="轻画">
          <QinghuaWordmark className={styles.wordmark} />
        </h1>
        <p className={styles.subtitle}>给图片与视频生成用的无限画布</p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-home-new
            onClick={requestNewProjectChoice}
          >
            新建项目
          </button>
          {/*
            「我的项目」是次入口：要看/管理已有项目、想从模板开始时走这条。
          */}
          <button
            type="button"
            className={styles.ghost}
            data-home-projects
            onClick={() => navigate('/projects')}
          >
            我的项目
          </button>
        </div>
      </div>
    </div>
  )
}
