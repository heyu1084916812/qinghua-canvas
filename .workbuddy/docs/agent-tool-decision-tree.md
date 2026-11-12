# Agent 工具选择决策树

## 问题现状

用户请求"帮我找一些包装视觉设计"时，Agent 错误地调用了：
- Pinterest 工具
- askQuestions 问题卡
- 其他不必要的工具

**应该只调用**：`researchDesign`（image 模式）

## 工具分类与使用场景

### 1. 信息获取类（优先级：高）

#### 1.1 联网搜索
- **`researchDesign`** - 设计调研与灵感搜索
  - **使用场景**：
    - 用户明确要求"找/搜索/查找"设计、灵感、参考、案例
    - 包含时效词：流行、趋势、最新、今年
    - 涉及真实品牌/产品/地标/人物
  - **模式选择**：
    - `image`：找图片、照片、海报、风格参考、灵感、Moodboard（**默认**）
    - `web`：查网页、文章、报告、新闻
    - `mixed`：既要参考图又要资料
  - **禁止搭配**：调用 `researchDesign` 时，不得同时调用 Pinterest、askQuestions

- **`readPage`** - 读取公开网页正文
  - **使用场景**：
    - 用户给出具体网页链接
    - 对 `researchDesign` 找到的关键来源做深入阅读（1-2个）

#### 1.2 本地信息
- **`readGraph`** - 查看画布状态
- **`readAsset`** - 查看节点素材信息
- **`readCapabilities`** - 查询当前可用能力

#### 1.3 参考资料
- **`curateReferences`** - 分析项目参考的用法
  - **使用场景**：涉及品牌套件、产品、角色、风格参考的生成前
  - **禁止**：不要和 `researchDesign` 同时调用

### 2. 用户交互类（谨慎使用）

- **`askQuestions`** - 发问题卡
  - **使用场景**（必须同时满足）：
    1. 用户需求**有明确的多个可选方案**
    2. **无法从上下文推断**用户偏好
    3. **不是信息缺失**（缺信息应该先调研）
  - **禁止场景**：
    - ❌ 纯搜索/调研任务（应该直接执行 `researchDesign`）
    - ❌ 信息不足（应该先调研再根据结果决定）
    - ❌ 可以合理推断的场景

### 3. 外部服务类（按需使用）

- **Pinterest** - 读取用户的 Pinterest 收藏
  - **使用场景**：
    - 用户**明确提到** "Pinterest" 或 "我的收藏"
    - 用户要求从**自己的收藏板**导入
  - **禁止场景**：
    - ❌ 一般性设计搜索（应该用 `researchDesign`）
    - ❌ 灵感查找（应该用 `researchDesign`）

## 决策流程

```
用户请求
    │
    ├─ 包含"找/搜/查"设计相关？
    │   └─ YES → researchDesign (默认 image 模式)
    │       └─ 直接执行，不发问题卡
    │
    ├─ 明确提到 Pinterest / 我的收藏？
    │   └─ YES → Pinterest
    │   └─ NO → researchDesign
    │
    ├─ 给出了具体网页链接？
    │   └─ YES → readPage
    │
    ├─ 需要分析现有参考？
    │   └─ YES → curateReferences
    │
    └─ 有多个明确方案且无法推断？
        └─ YES → askQuestions
        └─ NO → 直接执行或先调研
```

## 优化策略

### 1. System Prompt 改进
- 在"联网"部分明确工具优先级
- 添加"禁止组合"规则
- 明确 askQuestions 的限制条件

### 2. 工具 Description 改进
- `researchDesign`：强调"设计搜索的首选工具"
- `askQuestions`：添加"不要用于信息收集"
- Pinterest：明确"仅用于用户自己的收藏"

### 3. 执行顺序优化
- 纯搜索任务：单工具执行
- 复杂任务：先调研 → 分析 → 执行
