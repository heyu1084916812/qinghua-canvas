import {
  IconAuto,
  IconChevronDown,
  IconGridArrange,
  IconImage,
  IconSkill,
} from '../../toolbar/icons'
import styles from './AgentConversationMessages.module.css'

const ACTIONS = [
  {
    id: 'image',
    title: '生成一张图',
    desc: '补全提示词，连接可执行的生图节点',
    prompt: '帮我生成一张图片：',
    icon: IconImage,
  },
  {
    id: 'workflow',
    title: '搭建工作流',
    desc: '把目标拆成节点、连线与执行顺序',
    prompt: '帮我把这个想法搭成画布工作流：',
    icon: IconGridArrange,
  },
  {
    id: 'skill',
    title: '调用 Skill',
    desc: '用已有方法完成策划、拆解或生产任务',
    prompt: '使用一个合适的 Skill，帮我完成：',
    icon: IconSkill,
  },
] as const

export function AgentWelcome({
  skillCount,
  onUseSuggestion,
}: {
  skillCount: number
  onUseSuggestion: (text: string) => void
}) {
  return (
    <section className={styles.welcome} data-agent-welcome>
      <div className={styles.welcomeIntro}>
        <span className={styles.welcomeMark} aria-hidden="true">
          <IconAuto size={18} />
        </span>
        <div>
          <p className={styles.welcomeEyebrow}>Canvas Agent</p>
          <h2 className={styles.welcomeTitle} data-agent-welcome-title>
            从一句话，到一张画布
          </h2>
        </div>
      </div>
      <p className={styles.welcomeLead}>
        描述画面或工作流目标。我会拆解步骤、调用 Skill，并按需要搭建与执行节点。
      </p>
      <div className={styles.welcomeActions}>
        {ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              className={styles.welcomeAction}
              data-agent-welcome-suggestion={action.id}
              onClick={() => onUseSuggestion(action.prompt)}
            >
              <span className={styles.welcomeActionIcon} aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className={styles.welcomeActionBody}>
                <span className={styles.welcomeActionTitle}>{action.title}</span>
                <span className={styles.welcomeActionDesc}>{action.desc}</span>
              </span>
              <span className={styles.welcomeActionArrow} aria-hidden="true">
                <IconChevronDown size={13} />
              </span>
            </button>
          )
        })}
      </div>
      <div className={styles.welcomeMeta} data-agent-welcome-capabilities>
        <span>Skill {skillCount}</span>
        <span>画布节点</span>
        <span>参考素材</span>
        <span>自动执行</span>
      </div>
    </section>
  )
}
