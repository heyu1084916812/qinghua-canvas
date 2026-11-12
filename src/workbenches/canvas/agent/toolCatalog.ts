import { AGENT_NODE_TYPES } from '../../../domain/agent/plan'
import type { ToolDeclaration } from '../../../domain/shared/execution/types'
import { agentToolDefinitionOf, type AgentToolName } from '../../../domain/agent/toolRegistry'
import { AGENT_TASK_STEP_STATUSES } from '../../../domain/agent/taskPlan'

/**
 * Agent 的工具集（设计文档 §5 / §5.1）。
 *
 * 两条硬规矩：
 * ① **每个工具都映射到既有命令**，不新开旁路 —— 这样撤销、日志、指纹全都照常；
 * ② **读与写分开**：读类由循环直接调，写 / 花钱类由界面确认后才调（§9）。
 *    两者分别导出两个执行器，从类型上就不给「循环里偷偷写」的机会。
 */

/** 给模型看的工具声明。参数 schema 与设计文档 §5.1 一一对应 */
export const AGENT_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'readCapabilities',
    description:
      '读取 Agent 当前可用的能力目录。当你拿不准能否移动、排列、调整、生成、对比或筛选画布时，先调用它，不要直接回答“做不到”。query 写用户这次要做的动作；匹配到的工具会在本轮继续加载。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '用户这次想完成的能力，例如“移动并排列节点”“对比两张图”。',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'readGraph',
    description: '看当前画布上有什么节点、怎么连的、哪些已经出过图。问「现在有什么」时用它。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'selection'], description: '看全图还是只看选中' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'readAsset',
    description: '看指定节点的素材信息（类型、像素），用来判断能不能当参考图。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'curateReferences',
    description:
      '读取当前项目和本轮对话里的真实参考、套件图片，分析每条参考的 What，并针对本次任务写入具体的 HowToUse 与 usage。' +
      '涉及品牌套件、产品、角色、风格参考的生成或改图前应先调用；它不会生成图片、不会改动画布、不会把候选搜索自动加入项目参考。' +
      '文字、颜色、字体参考也可以分析；图片素材会按真实读取结果提交，缺图或无法确认的内容会在 limitations 中说明。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '本次用户真正要完成的任务目标，用于判断 HowToUse 和 usage。',
        },
        itemIds: {
          type: 'array',
          maxItems: 12,
          items: { type: 'string' },
          description:
            '可选：只分析指定参考 id。通常省略，默认分析当前任务带过的参考；当前任务没有参考时分析项目参考。',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'researchDesign',
    description:
      '【设计搜索的首选工具】做联网调研：免 Key 抓 Bing 结果页，在固定 12 个设计站点检索图片与网页（每个检索角度并发一次；失败且用户填了 Tavily Key 时改用 Tavily），附带轻画本地灵感库。' +
      '**用户说「找/搜/查」设计、灵感、参考、案例时，直接调用此工具，不要先发问题卡询问偏好。** ' +
      '必须按用户意图选择 mode：找图片、照片、海报、风格参考、灵感或 Moodboard 用 image（缺省也是 image）；' +
      '只要网页资料、文章、报告、新闻或公开来源用 web；既要参考图又要网页资料用 mixed。' +
      'image 模式使用独立的 imageMaxResults 目标（默认 40，允许 30–50），不占用 maxResults 的网页条数。' +
      '也可从用户提供的公开网页、Pinterest Pin / Board 或 Behance 页面提取参考图与出处（要读正文请用 readPage）。' +
      '只读取公开页面，不使用任何账号 Cookie，不声称完成私密内容或无限制全站搜索。' +
      '搜索结果只是候选，不会自动加入项目参考、也不会喂给生图；保留原链接与来源。' +
      '结果为空时按 warnings 如实说明原因；needsTavilyKey 为 true（已填的 Tavily Key 被拒或额度用尽）时，如实告诉用户去 设置 → Agent → 工具 → 联网调研 检查 Key。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '这次要研究的设计主题、风格、品类或用户目标。',
        },
        mode: {
          type: 'string',
          enum: ['image', 'web', 'mixed'],
          description:
            '调研模式。找图片/风格/海报/参考用 image；查网页文章/报告用 web；两者都要用 mixed。省略时按 image。',
        },
        queries: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string' },
          description:
            '1–4 个覆盖不同角度的检索词（如品牌现状、风格趋势、同类案例、配色字体）。' +
            '主题有国际性时至少写一条英文检索词。省略时只用 topic 搜一次。',
        },
        urls: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
          description:
            '用户提供或明确点名的公开页面 URL；没有 URL 时仍会自动检索开放来源。',
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: 'web / mixed 模式的网页来源条数上限，默认 12；不会限制 image 模式的图片目标。',
        },
        imageMaxResults: {
          type: 'integer',
          minimum: 30,
          maximum: 50,
          description:
            'image / mixed 模式的独立图片目标，默认 40；图片候选会合并各角度与网页首图并按原图去重。',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'readPage',
    description:
      '读取一个公开网页的正文（标题、链接与清洗后的正文，最多约 8000 字）。' +
      '用于用户给出的链接，或对 researchDesign 找到的 1–2 个关键来源做深入阅读。' +
      '页面需要登录、有验证码或打不开时会返回 ok:false 与 error；此时如实告诉用户读不到，' +
      '并建议改搜公开来源或请用户贴截图 / 文字，不要编造页面内容。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读取的公开 http / https 页面地址。' },
      },
      required: ['url'],
    },
  },
  {
    name: 'applyPlan',
    description:
      '把一份工作流建到画布上：给出要建的节点与连线，一次性落地。' +
      '**这一步立刻生效、不会问用户**（建节点不花钱，用户马上能在画布上看到）；' +
      '随后要不要真的出图，系统会再问用户一次。' +
      '要用画布上已有的节点（例如用户先放好的素材图）当上游，就把那个节点写进 attach。',
    /**
     * ⚠️ **字段名必须写在 schema 里，不能只靠校验器事后拦。**
     *
     * 真机事故（用户 2026-10-06 截图）：`nodes` / `edges` / `attach` 原来都声明成
     * 光秃秃的 `{ type: 'object' }`，系统提示词里也只有「用 attach 指过去」这种白话，
     * **`localId` / `existingNodeId` 这两个真正的键名一次都没出现过**。于是模型只能猜：
     * 猜错就得到「第 1 条 attach 的 localId 不在计划里：undefined」，猜不出来就自己编
     * 一个 `cat_ref_1`，或者把画布节点 id 直接当连线起点 ⇒ 连试六轮都建不成。
     *
     * 当时的取舍是「形状靠校验器拦」（设计文档 §5.1 原话），但**校验器只会事后报错**，
     * 模型事前不知道键名，报错就只能靠反复试。节点 `data` 里那几十个字段确实不适合塞进
     * schema（会巨大且频繁漂移，那部分继续靠词表 + 校验器），但**计划自身的骨架只有几个键，
     * 必须在这里说死** —— 这是模型唯一能提前看到结构化契约的地方。
     */
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '一句话说明这份计划在做什么' },
        nodes: {
          type: 'array',
          description: '要**新建**的节点。',
          items: {
            type: 'object',
            properties: {
              localId: {
                type: 'string',
                description: '计划内部的临时 id（自己起，计划里唯一）。连线与 attach 都引用它，落地时换成真实节点 id。',
              },
              type: { type: 'string', enum: [...AGENT_NODE_TYPES] },
              title: { type: 'string', description: '节点标题（给人看的短名）' },
              data: {
                type: 'object',
                description:
                  '节点正文与参数，**必须用画布的键名**：提示词节点写 data.text，' +
                  '生成 / 批量 / 分组节点写 data.prompt；比例 data.ratio、清晰度 data.resolution、' +
                  '画质 data.quality、张数 data.count。写错不会报错，但那个框是空的、也跑不出图。',
              },
              order: { type: 'integer', description: '第几步，从 0 起（坐标不用给，系统自己排）' },
            },
            required: ['localId', 'type', 'data', 'order'],
          },
        },
        edges: {
          type: 'array',
          description: '连线。两端都填**节点在计划里的 localId**（不是画布上的真实 id）。',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '起点的 localId' },
              target: { type: 'string', description: '终点的 localId' },
              sourcePort: { type: 'string', description: '多口节点的输出口名；单口节点不用填' },
              targetPort: { type: 'string', description: '多口节点的输入口名；单口节点不用填' },
            },
            required: ['source', 'target'],
          },
        },
        attach: {
          type: 'array',
          description:
            '把计划里的某个节点**接到画布上已有的节点**（复用用户先放好的素材图，不重复建）。' +
            '写法：localId = 计划里那个节点的临时 id；existingNodeId = 画布上那个节点的真实 id' +
            '（就是画布摘要里 `- node_xxx｜...` 那一串）。' +
            '参考别名必须和新生成节点的 localId 不同；例如旧图用 ref1，新节点用 v1，' +
            '再写 ref1 → v1 的连线。',
          items: {
            type: 'object',
            properties: {
              localId: { type: 'string', description: '计划里那个节点的 localId' },
              existingNodeId: { type: 'string', description: '画布上已有的节点 id' },
            },
            required: ['localId', 'existingNodeId'],
          },
        },
      },
      required: ['summary', 'nodes', 'edges'],
    },
  },
  {
    name: 'updateNode',
    description:
      '改某个节点的**生成参数**（比例 / 张数 / 模型 / 时长），会先让用户确认。' +
      '**不要用它改画面内容（提示词）**：出过图的节点，正文就是上一版的记录，' +
      '覆盖掉用户就再也看不到上次写了什么。' +
      '要改画面就新建一个生成节点、用 attach 把旧图接成它的上游，把新提示词写在新节点上。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '只改一个节点时用' },
        /**
         * 批量改（用户 2026-10-06 第七批 #187）：说「都改」时**一次改完**，
         * 用户只确认一次。一次一个节点地改 = 让他确认八次。
         */
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '一次改多个节点（用户说「都改 / 全部 / 这几张都改」时**必须**用这个）。' +
            '同一个 data 会应用到每一个节点上，用户只需要确认一次。',
        },
        data: { type: 'object' },
      },
      required: ['data'],
    },
  },
  {
    name: 'proposeTaskPlan',
    description:
      '为需要多个阶段的长任务提出执行计划，系统会先让用户确认，批准后才保存。' +
      '只在任务预计至少 2 个实质阶段时使用；单步请求不要建计划。' +
      '提出前先分析用户意图、必需输入和缺失信息；关键信息缺失时先用普通文字向用户提问。' +
      '品牌套图、整套视觉、批量物料、复杂画布改造应拆成可验收的阶段。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '计划标题，最多 80 字' },
        summary: { type: 'string', description: '一句话说明目标与交付物' },
        assumptions: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
          description:
            '计划依赖但尚未由用户明确确认的前提。不要把审美判断或用户资料写成既定事实。',
        },
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '稳定步骤 id，后续 updateTaskStep 用它',
              },
              title: { type: 'string', description: '用户能看懂的阶段名' },
              detail: { type: 'string', description: '可选：本阶段产出' },
              requiresConfirmation: {
                type: 'boolean',
                description:
                  '本阶段结果是否需要用户明确验收后才能完成。设计、生成、页面等有产出的步骤应为 true。',
              },
            },
            required: ['id', 'title', 'requiresConfirmation'],
          },
        },
      },
      required: ['title', 'steps'],
    },
  },
  {
    name: 'updateTaskStep',
    description:
      '按顺序更新已批准计划中的一个步骤。上一步未完成时不能开始下一步；' +
      '完成一步不会自动启动下一步。需要验收的步骤必须先由 requestTaskConfirmation 获得用户确认。',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: '计划里的稳定步骤 id' },
        status: {
          type: 'string',
          enum: [...AGENT_TASK_STEP_STATUSES],
        },
        note: { type: 'string', description: '可选：实际产出、数量或失败原因' },
      },
      required: ['stepId', 'status'],
    },
  },
  {
    name: 'requestTaskConfirmation',
    description:
      '暂停当前阶段并向用户确认一个具体问题。purpose=clarification 用于补充关键信息；' +
      'purpose=review 用于在生成或设计结果出来后询问用户是否满意。' +
      '普通生成扣费仍由 runNode 自己的确认卡处理，不要重复询问。',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: '当前计划步骤 id' },
        purpose: {
          type: 'string',
          enum: ['clarification', 'review'],
          description:
            'clarification=开始前补充信息；review=阶段结果已产出，请用户验收是否满意。',
        },
        question: { type: 'string', description: '要让用户决定的具体问题' },
        detail: {
          type: 'string',
          description: '可选：短段落或换行分隔的要点；不要把多个问题挤成一大段。',
        },
      },
      required: ['stepId', 'purpose', 'question'],
    },
  },
  {
    name: 'askQuestions',
    description:
      '发一张问题卡：开工前缺少会改变成品方向、且无法从画布 / 参考 / 记忆判断的关键信息时，一次问清 1～4 题，' +
      '每题给 2～6 个可直接选的候选项，并默认附自由输入。调用后本回合结束，用户的回答会作为下一条消息发回。' +
      '典型场景：尺寸 / 平台未定、核心文案未给、多张参考图自动分析后分工仍拿不准（问每张图怎么配合）。' +
      '**禁止场景**：不要用于信息收集（如问风格、颜色、品类），信息不足时先用 researchDesign 搜索；' +
      '纯搜索任务（用户说「找/搜」）不发问题卡，直接执行 researchDesign。' +
      '也不要用它问费用确认（runNode 自己会确认），也不要和别的写画布工具同一批调用。',
    parameters: {
      type: 'object',
      properties: {
        intro: { type: 'string', description: '可选：一句短引导（如「开工前先定几件事」）；不要在这里或正文里列题目与选项' },
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '可选：稳定 id，如 size / copy / ref-usage' },
              question: { type: 'string', description: '一个具体问题' },
              options: {
                type: 'array',
                maxItems: 6,
                items: { type: 'string' },
                description: '候选项（短语），把最可能的放第一个',
              },
              multiple: { type: 'boolean', description: '是否允许多选；缺省单选' },
              allowFreeText: { type: 'boolean', description: '是否附自由输入；缺省 true' },
              referenceItemId: {
                type: 'string',
                description: '可选：这题问的是哪张参考卡的用法时填该参考的 id（上下文会列出）；回答会写回那张卡的用法',
              },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'runNode',
    description:
      '跑指定的节点（会花钱，先让用户确认）。nodeIds 必须是画布上的真实 id：' +
      'applyPlan 返回的 resolvedNodes[].nodeId，或 readGraph 摘要里的 node_xxx；' +
      '绝不能填计划里的 localId 或节点标题。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'runFrom',
    description:
      '从指定节点开始，按连线顺序跑完整条下游链（会花钱，先让用户确认）。' +
      '用于「把这套流程继续跑下去」；只跑可真正发请求的生成 / 融合节点，' +
      '提示词节点只作为中间输入；批量 / 循环这类分发器请直接对它们调用 runNode。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '下游链的起点节点 id；可以给多个，系统按连线拓扑执行。',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'readResult',
    description: '看指定节点跑出来的产物（有没有图、哪个 hash）或失败原因。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'visualReview',
    description:
      '只读视觉验收。把目标图片和项目当前绑定的品牌 / 产品 / 角色 / 自定义套件素材一起交给视觉子代理，' +
      '检查标志、产品结构、角色身份、文字、排版、画质与整套一致性，返回可执行的 issue 清单。' +
      '该工具不会写画布、不会删除节点、不会自动重新生成或重跑付费请求。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要验收的真实画布节点 id，必须已有图片产物。',
        },
        checklist: {
          type: 'string',
          description: '用户这次点名的验收项；没点名就省略，使用项目套件与默认视觉规范。',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'rememberMemory',
    description:
      '把用户明确要求长期记住的偏好、事实、硬约束或已确认决定整理成一条候选记忆。' +
      '只在用户说“记住 / 以后 / 每次 / 长期”或明确确认项目规则时使用；' +
      '一次性要求不要保存。系统会先把整理结果给用户确认，批准后才写入。' +
      '禁止保存密钥、令牌、密码、Cookie 或整段隐私数据。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '精炼后的单条记忆，最多 800 字' },
        kind: {
          type: 'string',
          enum: ['preference', 'fact', 'constraint', 'decision'],
        },
        scope: {
          type: 'string',
          enum: ['global', 'workbench', 'project', 'session'],
          description:
            '稳定个人偏好用 global；当前工作台用 workbench；本项目用 project；仅当前会话用 session。',
        },
        key: {
          type: 'string',
          description:
            '可选稳定主题键，例如 brand.primaryColor / brand.font / project.size；用于冲突检测。',
        },
        expiresInDays: {
          type: 'integer',
          minimum: 1,
          maximum: 3650,
          description: '可选有效天数；不确定就省略，表示长期有效。',
        },
      },
      required: ['text', 'kind', 'scope'],
    },
  },
  {
    name: 'moveNodes',
    description:
      '移动节点。可用 positions 给每个节点精确的左上角坐标，或 dx/dy 给一组节点相同位移。' +
      '坐标使用 readGraph 返回的 x / y；分组子节点使用组内坐标。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        positions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['nodeId', 'x', 'y'],
          },
        },
        dx: { type: 'number' },
        dy: { type: 'number' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'resizeNodes',
    description:
      '调整图片 / 节点的画布尺寸。可用 width / height 指定同宽同高，scale 指定等比缩放；' +
      '尺寸会保持各自原始宽高比、不拉伸图片。useMax:true 时同宽取最大宽、同高取最大高；' +
      '否则取最小值（避免自动把图放得过大）。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        width: { type: 'number', description: '统一宽度（画布单位），与 scale 二选一；不给数值则按 useMax 取当前最大/最小宽。' },
        height: { type: 'number', description: '统一高度（画布单位），与 scale 二选一；不给数值则按 useMax 取当前最大/最小高。' },
        scale: { type: 'number', description: '相对当前尺寸的等比缩放倍数，如 0.5 / 2。' },
        useMax: { type: 'boolean', description: '统一尺寸时取最大值而不是最小值。' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'deleteNodes',
    description: '删除指定节点。会级联删除关联连线；会先在确认卡中列出节点名，不删除素材库文件。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'arrangeNodes',
    description:
      '把一组同层节点排列成水平、垂直或网格；保持原选区左上角，按给定 gap 排布。' +
      '确定要自动整理画布时使用。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        layout: { type: 'string', enum: ['horizontal', 'vertical', 'grid'] },
        gap: { type: 'number', description: '节点间距，默认 32。' },
        columns: { type: 'number', description: 'grid 模式的列数；不填按平方根估算。' },
      },
      required: ['nodeIds', 'layout'],
    },
  },
  {
    name: 'deleteEdges',
    description:
      '取消连线。优先传 readGraph 返回的 edgeIds；也可用 source/target 对精确指定。' +
      '删除连线不会删除节点。此操作会先让用户确认。',
    parameters: {
      type: 'object',
      properties: {
        edgeIds: { type: 'array', items: { type: 'string' } },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
            },
            required: ['source', 'target'],
          },
        },
      },
    },
  },
  {
    name: 'compareNodes',
    description:
      '把两个有图的节点直接做成 A/B 对比节点：自动在右侧建对比节点并连接两张图。',
    parameters: {
      type: 'object',
      properties: {
        leftNodeId: { type: 'string' },
        rightNodeId: { type: 'string' },
      },
      required: ['leftNodeId', 'rightNodeId'],
    },
  },
  {
    name: 'sliceImage',
    description:
      '对图片节点提取选区或裁剪。rect 使用原图像素坐标 {x,y,w,h}；' +
      '不传 rect 时为该节点打开灯箱框选，用户画完框后由现有裁剪流程生成新节点。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        mode: { type: 'string', enum: ['extract', 'crop'] },
        rect: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
          required: ['x', 'y', 'w', 'h'],
        },
        ratio: { type: 'string' },
      },
      required: ['nodeId', 'mode'],
    },
  },
  {
    name: 'splitGrid',
    description:
      '把图片节点按 rows × cols 宫格切分，并在右侧铺开生成每个切片节点。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        rows: { type: 'number' },
        cols: { type: 'number' },
      },
      required: ['nodeId', 'rows', 'cols'],
    },
  },
]

/** 「联网」开关控制的工具：关闭时整组不暴露给模型。 */
export const AGENT_WEB_TOOL_NAMES: ReadonlySet<string> = new Set(['researchDesign', 'readPage'])

export function agentToolsForCapabilities({
  canvasReview,
  webResearch = true,
}: {
  canvasReview: boolean
  /** Agent 输入框的「联网」开关；缺省视为开启（旧调用方行为不变）。 */
  webResearch?: boolean
}): readonly ToolDeclaration[] {
  if (canvasReview && webResearch) return AGENT_TOOLS
  return AGENT_TOOLS.filter(
    (tool) =>
      (canvasReview || tool.name !== 'visualReview') &&
      (webResearch || !AGENT_WEB_TOOL_NAMES.has(tool.name)),
  )
}

const CAPABILITY_QUERY_GROUPS: readonly {
  terms: readonly string[]
  names: readonly AgentToolName[]
}[] = [
  {
    terms: [
      '移动',
      '挪动',
      '拖动',
      '拖到',
      '摆放',
      '排列',
      '排成',
      '重排',
      '位移',
      '整理',
      '对齐',
      '布局',
      '空位置',
      '空白处',
    ],
    names: ['moveNodes', 'arrangeNodes', 'resizeNodes'],
  },
  {
    terms: ['尺寸', '缩放', '大小', '加高', '加宽'],
    names: ['resizeNodes'],
  },
  {
    terms: ['生成', '出图', '视频', '重跑', '运行', '继续跑'],
    names: ['runNode', 'runFrom', 'readResult'],
  },
  {
    terms: ['新建', '建节点', '工作流', '计划'],
    names: ['applyPlan', 'proposeTaskPlan'],
  },
  {
    // ⚠️ `updateNode` 执行的是 `node.updateData`，**改不了 title**。
    // 「改名 / 改标题」属于下面 UNSUPPORTED 那一类，绝不能在这里就近匹配到 updateNode。
    terms: ['修改', '参数', '模型', '提示词'],
    names: ['updateNode'],
  },
  {
    terms: ['删除', '移除', '断线', '取消连线'],
    names: ['deleteNodes', 'deleteEdges'],
  },
  {
    terms: ['看图', '素材', '画布', '节点信息', '结果'],
    names: ['readGraph', 'readAsset', 'readResult'],
  },
  {
    terms: ['对比', '比较'],
    names: ['compareNodes'],
  },
  {
    terms: ['裁剪', '提取', '切图', '宫格', '切分'],
    names: ['sliceImage', 'splitGrid'],
  },
  {
    terms: ['调研', '参考', '灵感', 'moodboard', '套件', '品牌', '怎么用'],
    names: ['researchDesign', 'curateReferences'],
  },
  {
    terms: ['联网', '搜索', '网页', '链接', '网址', '读取页面', '阅读文章', 'url'],
    names: ['researchDesign', 'readPage'],
  },
  {
    terms: ['验收', '检查', '巡检', '是否一致', '一致性', '质量把关'],
    names: ['visualReview'],
  },
  {
    terms: ['查看画布', '看画布', '查看图片', '看图', '看到图片', '看不了图片', '视觉能力'],
    names: ['readGraph', 'readAsset'],
  },
  {
    terms: ['记忆', '记住', '偏好'],
    names: ['rememberMemory'],
  },
  {
    terms: ['计划', '步骤', '确认'],
    names: ['proposeTaskPlan', 'updateTaskStep', 'requestTaskConfirmation'],
  },
]

/**
 * 明确「当前没有对应工具」的动作。
 *
 * 事故（2026-11-04）：用户让 Agent 改节点标题，模型查能力拿到 `updateNode`，
 * 于是先说“可以帮你改名”、再说“改好了”——画布没变，因为 `updateNode` 只改
 * `node.data`（提示词 / 模型等），而仓库里根本没有暴露给 Agent 的 rename 命令。
 *
 * 这类查询必须**返回空匹配 + 明确的 supported:false**，让模型只能如实回答做不到；
 * 绝不能就近落到某个"看起来相关"的工具上。
 */
const UNSUPPORTED_CAPABILITY_QUERIES: readonly {
  terms: readonly string[]
  capability: string
  error: string
}[] = [
  {
    terms: [
      '改名',
      '重命名',
      '改标题',
      '换标题',
      '改节点标题',
      '改节点名字',
      '改名字',
      '节点名称',
      '修改节点名称',
      '改名称',
      '名称改成',
      '设置名称',
      '标题改成',
      'rename',
      'retitle',
    ],
    capability: 'rename',
    error:
      '当前没有改名 / 重命名节点的工具（supported: false）。' +
      '`updateNode` 只能改节点参数（提示词、模型等），不能改节点标题；' +
      '请如实告诉用户「当前没有改名能力」，不要假装已经改好。',
  },
]

export interface AgentCapabilityDiscovery {
  result: Record<string, unknown>
  tools: readonly ToolDeclaration[]
}

/**
 * 渐进式能力披露：先给能力索引，再把匹配工具的完整 schema 加载到本轮。
 * 这里只做确定性的关键词/名称匹配，不执行任何工具，也不绕过权限或确认流程。
 */
export function discoverAgentTools(
  query: string,
  available: readonly ToolDeclaration[] = AGENT_TOOLS,
): AgentCapabilityDiscovery {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, '')
  const candidates = available.filter((tool) => tool.name !== 'readCapabilities')
  if (!normalized) {
    return {
      result: {
        ok: false,
        error: 'query 不能为空',
        available: candidates.map((tool) => tool.name),
      },
      tools: [],
    }
  }

  const unsupported = UNSUPPORTED_CAPABILITY_QUERIES.find((rule) =>
    rule.terms.some((term) => normalized.includes(term)),
  )
  if (unsupported) {
    return {
      result: {
        ok: false,
        supported: false,
        query,
        capability: unsupported.capability,
        loaded: [],
        capabilities: [],
        error: unsupported.error,
        available: candidates.map((tool) => tool.name),
      },
      tools: [],
    }
  }

  const wanted = new Set<string>()
  for (const tool of candidates) {
    if (normalized.includes(tool.name.toLowerCase())) wanted.add(tool.name)
  }
  for (const group of CAPABILITY_QUERY_GROUPS) {
    if (group.terms.some((term) => normalized.includes(term))) {
      for (const name of group.names) wanted.add(name)
    }
  }
  if (wanted.size === 0) {
    for (const tool of candidates) {
      if (
        normalized.length >= 2 &&
        tool.description?.toLowerCase().includes(normalized)
      ) {
        wanted.add(tool.name)
      }
    }
  }

  const tools = candidates.filter((tool) => wanted.has(tool.name))
  return {
    result: {
      ok: tools.length > 0,
      query,
      loaded: tools.map((tool) => tool.name),
      capabilities: tools.map((tool) => {
        const definition = agentToolDefinitionOf(tool.name)
        return {
          name: tool.name,
          description: tool.description,
          category: definition?.category ?? 'canvas',
          access: definition?.access ?? 'read',
          parameters: tool.parameters,
        }
      }),
      ...(tools.length === 0
        ? {
            error: '没有匹配到能力；可换一个动作词，或从 available 里选择工具名。',
            available: candidates.map((tool) => tool.name),
          }
        : {}),
    },
    tools,
  }
}

const SIMPLE_GENERATE_TOOLS = new Set([
  'readGraph',
  'askQuestions',
  'curateReferences',
  'applyPlan',
  'runNode',
  'readResult',
  'rememberMemory',
])

const REFERENCE_EDIT_TOOLS = new Set([
  'readGraph',
  'askQuestions',
  'readAsset',
  'curateReferences',
  'applyPlan',
  'runNode',
  'readResult',
  'rememberMemory',
])

const DESIGN_RESEARCH_TOOLS = new Set([
  'readGraph',
  'askQuestions',
  'researchDesign',
  'readPage',
  'curateReferences',
  'applyPlan',
  'runNode',
  'readResult',
  'rememberMemory',
])

const CANVAS_OPERATION_TOOLS = new Set([
  'readGraph',
  'readAsset',
  'readResult',
  'visualReview',
  'updateNode',
  'runNode',
  'runFrom',
  'moveNodes',
  'resizeNodes',
  'deleteNodes',
  'arrangeNodes',
  'deleteEdges',
  'compareNodes',
  'sliceImage',
  'splitGrid',
  'rememberMemory',
])

export function agentToolsForRequestMode(
  mode: 'simple_generate' | 'reference_edit' | 'design_research' | 'canvas_operation' | 'complex_plan',
  capabilities: { canvasReview: boolean; webResearch?: boolean },
): readonly ToolDeclaration[] {
  if (mode === 'complex_plan') return agentToolsForCapabilities(capabilities)
  const allowed =
    mode === 'simple_generate'
      ? SIMPLE_GENERATE_TOOLS
      : mode === 'reference_edit'
        ? REFERENCE_EDIT_TOOLS
        : mode === 'design_research'
          ? DESIGN_RESEARCH_TOOLS
          : CANVAS_OPERATION_TOOLS
  const tools = agentToolsForCapabilities(capabilities).filter((tool) => allowed.has(tool.name))
  return tools.some((tool) => tool.name === 'readCapabilities')
    ? tools
    : [
        agentToolsForCapabilities(capabilities).find(
          (tool) => tool.name === 'readCapabilities',
        )!,
        ...tools,
      ]
}
