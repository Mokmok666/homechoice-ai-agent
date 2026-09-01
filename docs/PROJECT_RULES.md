# HomeChoice 项目开发规则

> **历史文档说明：** 本文件记录项目早期的开发约束与产品边界。当前已发布能力和架构以 [README](../README.md)、[Case Study](./CASE_STUDY.md)、[Architecture](./ARCHITECTURE.md) 及实际代码为准；其中仍适用的安全边界继续有效。

本文件是 HomeChoice 的 AI Coding Agent 开发规范。未来所有 Codex 或其他 AI Coding Agent 在修改代码前必须阅读并遵守本文件，同时服从用户在当前任务中的明确指令。

## 1. Product Goal

HomeChoice 是面向已有 3–5 套候选房源用户的 AI 房产决策助手，不是房源搜索平台。

产品目标是：

- 将复杂、分散的房地产信息结构化；
- 结合具体家庭的预算、通勤、教育和生活偏好比较房源；
- 输出可解释的推荐顺序、风险和 BUY / WAIT / PASS 建议；
- 帮助用户提升决策质量，但不替代用户、经纪人、律师或金融机构作出最终决定。

产品开发优先保证完整、清晰、可信的用户决策流程。

## 2. Technology Constraints

技术栈已锁定：

- Frontend：Next.js App Router、React、TypeScript；
- UI：Tailwind CSS、shadcn/ui、Lucide Icons；
- Backend：Next.js Route Handlers；
- Database：Supabase PostgreSQL（未来阶段）；
- Storage：Supabase Storage（未来阶段）；
- Authentication：Supabase Anonymous Auth（未来阶段）；
- AI：Zhipu GLM API，仅允许服务端调用（未来阶段）；
- Deployment：Vercel。

未经用户明确指示，不得引入或迁移到：

- Prisma、Firebase、MongoDB 或其他数据库；
- Clerk、NextAuth、Auth.js 或其他认证框架；
- Redux、Zustand、MobX 或其他全局状态库；
- Express、NestJS、FastAPI、Flask 或独立后端服务；
- LangChain、LangGraph、CrewAI、AutoGen 等 Agent 编排框架；
- OpenAI、Claude、Gemini、DeepSeek、Kimi 或其他 AI 供应商；
- Docker、Kubernetes 或当前 Demo 不需要的基础设施；
- styled-components、Emotion、Sass 架构或其他样式系统；
- 另一套图标库或完整替代 shadcn/ui 的设计系统。

不得为了“未来可能需要”提前增加依赖、服务或抽象层。

## 3. Coding Rules

### 修改前

- 检查仓库状态、现有结构、锁文件和相关代码；
- 阅读本文件、产品需求和用户流程文档；
- 保留现有可用功能和用户未提交的修改；
- 只实现当前 Phase 明确要求的范围，不提前开发后续阶段。

### 架构

- 保持单一 Next.js 仓库，使用 App Router；
- 服务端能力使用 Next.js Route Handlers，不创建独立后端；
- 优先使用 React state、Context、标准 TypeScript 和 Next.js 原生能力；
- 业务类型集中放置在 `lib/types.ts` 或明确的 `types` 目录；
- Mock 数据集中管理，不在页面组件中散落大型数据对象；
- 评分与 AI 能力保持清晰边界。

### TypeScript

- 启用并保持严格类型检查；
- 避免 `any`，只有在确实无法合理建模且有注释说明时才能使用；
- 类型应服务于可读性，避免不必要的复杂泛型；
- 对外部输入和 API 响应执行运行时校验。

### UI

- 保持现有 HomeChoice 的低饱和、克制、面向消费者的视觉语言；
- 优先复用现有组件和 shadcn/ui 基础；
- 使用 Tailwind CSS 作为主要样式系统；
- 使用 Lucide Icons；
- 修改必须兼顾基础响应式、键盘操作、标签和可读性；
- 未经明确要求，不重构或重设计已经验收的页面。

### 数据与安全

- 不把密钥写入客户端代码、仓库或 `NEXT_PUBLIC_*` 变量；
- `ZHIPU_API_KEY` 只能由服务端 Route Handler 使用；
- 不创建虚假 Supabase 集成或伪造生产数据；
- AI 提取数据必须允许用户确认和修改；
- 不把 LLM 输出直接作为数学评分或交易事实；
- 对教育、价格、升值和交易建议展示适当的不确定性说明。

### 依赖与包管理

- 使用仓库现有的 npm 和 `package-lock.json`；
- 不创建第二种包管理器锁文件；
- 只在当前需求确实无法由现有技术解决时增加依赖；
- 新增依赖时必须记录用途并验证许可、维护状态和构建兼容性。

### 验证

- 代码修改后至少执行与风险相称的类型检查或 `npm run build`；
- 涉及运行时交互时验证主要用户路径；
- 不以测试通过代替产品需求检查；
- 构建失败、明显运行时错误或已知数据破坏风险未解决时不得宣称完成。

### Git

- 未经用户明确要求，不执行 commit、push、创建 PR、reset 或 destructive checkout；
- 不覆盖用户已有的未提交修改；
- 最终报告新增、修改、验证结果和已知限制。

## 4. Development Priority

所有实现选择按以下顺序评估：

1. 产品体验；
2. 用户流程完整性；
3. Demo 稳定性；
4. 决策可解释性；
5. 可维护性；
6. 工程复杂度与技术炫技。

出现权衡时，选择能够可靠支持当前产品阶段的最简单方案，不为假设中的大规模场景提前设计。

## 5. AI 与确定性逻辑的职责边界

### TypeScript 确定性逻辑负责

- 评分公式和权重；
- 排名和预算计算；
- 价格比较；
- BUY / WAIT / PASS 规则；
- 可信度计算；
- 可复现的数据转换。

### Zhipu GLM 负责

- 自然语言理解；
- 图片内容理解；
- 结构化信息提取；
- 用户意图理解；
- 基于确定性结果生成自然语言解释。

LLM 不得成为数学评分的唯一事实来源，也不得编造无法从输入或结构化结果验证的信息。

## 6. Agent 开始任务前检查清单

- 当前需求属于哪个 Phase？
- 本次修改是否直接服务于明确需求？
- 是否保持锁定技术栈？
- 是否读取了相关产品文档？
- 是否会修改现有 UI 或用户数据？
- 是否存在未提交修改需要保护？
- 是否清楚区分确定性逻辑和 AI 能力？
- 完成后将运行哪些验证？
