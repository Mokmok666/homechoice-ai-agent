# HomeChoice AI Product Case Study

## 1. Background

HomeChoice 是一个面向“已经有候选房源、但还没有形成购买判断”的购房决策支持产品。用户通常已经完成了房源发现，却仍需在预算、家庭通勤、空间、社区、配套和长期价值之间做跨维度取舍。

这个阶段的困难不在于缺少更多房源，而在于：资料口径不一致、重要性因人而异、外部信息质量参差不齐，且结论需要能够向家庭成员解释和复查。

## 2. User Problem

- 房源资料、地图信息、公开网页和线下观察彼此分散；
- 挂牌价、预期成交价和真实成交证据容易被混为一谈；
- 家庭成员的通勤目标和关注优先级不同；
- “数据更多”容易被误解成“房源更好”；
- 通用 LLM 会补全缺失事实、反转比较方向或给出不稳定排名；
- 用户需要的不只是答案，还需要知道答案使用了什么证据、哪里仍不确定。

## 3. Product Goal

让用户在 5–10 秒内理解当前首选、主要原因和关键边界，同时保留继续核验的路径。产品输出是阶段性决策支持，不替代线下查验、专业意见和最终购买决定。

成功的产品体验应同时满足：

1. 个性化：排序响应用户的购房目的、预算和 Top3；
2. 稳定：同样的事实不因模型随机性改变 Top1；
3. 可信：无证据不下结论，冲突和未知不会被包装成事实；
4. 可解释：推荐、结构化理由、快速比较和 15 维详情层层对应；
5. 可恢复：外部服务或模型失败时，确定性结果仍然可用。

## 4. User Journey

1. 添加候选房源，通过 AMap 搜索并确认具体项目位置；
2. 录入挂牌价、预期成交价、面积、户型、楼龄和结构化现场观察；
3. 设置购房目的、最高预算、Top3，以及本人/伴侣工作地点与通勤阈值；
4. 系统按需获取 AMap 路线、公共交通、商业和医疗证据，以及 Web 公开证据；
5. 15 维 Decision Engine 在共同可比维度上计算个性化结果；
6. Results 先展示首选，再展示 AI 解读、确定性理由、候选快速比较和 15 维详情；
7. 用户保存当前决策快照，后续信息变化不会重写历史判断。

## 5. MVP Scope

### 已实现

- 最多 5 套候选房源的结构化录入与位置确认；
- Buyer Preferences、Top3、本人及可选伴侣通勤需求；
- 15 维确定性评分、共同可比权重、排序和 Recommendation；
- AMap Geo / Commute Evidence；
- Tavily Web Search、来源保留、相关性与可信度处理；
- Zhipu GLM 证据解释与 AI 购房解读；
- factual validation、一次纠错、确定性 fallback、签名缓存和竞态防护；
- Supabase Anonymous Auth、RLS、LocalStorage fallback 和 Decision History；
- Demo Mode、Vercel 生产部署和确定性回归测试。

### 明确不做

- 房源交易、经纪或贷款服务；
- 房价上涨预测；
- 自动承诺学区或入学资格；
- 让 LLM 直接评分、改权重或重排；
- 长时间自主运行的通用 Agent 编排。

## 6. Decision Framework

15 维覆盖区位与家庭、房屋与居住、价格与安全边际、长期价值四组问题。它是“可能需要考虑的最大空间”，而不是要求用户填满的表格。

### 个性化逻辑

- 购房目的选择基础先验；
- Top3 按顺序获得更高组权重；
- 无教育需求时，教育维度权重为 0；
- 硬约束以单独 mismatch 语义处理；
- 只有所有当前候选都拥有合法分数的维度，才进入本轮 Effective Comparable Dimension Set；
- 同一有效权重向量应用于所有候选，避免比较口径漂移。

### 缺失信息逻辑

- `score = null` 表示不能合法计算，不是 0 分；
- unknown 不产生优势或负面结论；
- 补充证据后，系统重新确定当前可比集合并重算；
- Results 明确标记信息完整度与阶段性排序。

## 7. AI Architecture

产品将“决策权”和“表达权”分开：

- **Decision Engine：**计算分数、权重、排名、Top1 和 Recommendation；
- **DecisionEvidencePack：**保存 Buyer Context、完整候选、15 维结果、权重、排名、AMap/Web Evidence、来源和比较关系；
- **KnownDecisionContext：**从权威 Evidence Pack 生成闭集、精简、可解释的模型输入；
- **Zhipu GLM：**把允许使用的事实组织成自然中文；
- **Validation：**验证 Top1、候选、数字、比较方向、证据边界和未知语义；
- **Fallback：**在模型链路不可用时，用 TypeScript 生成同一前端契约的安全摘要。

这个边界的产品价值不是“更复杂”，而是让排名可复现、解释可读、失败可恢复。

## 8. Evidence Strategy

### AMap

确认房源与工作地点坐标，按需获取驾车、公交、步行、骑行路线，并为公共交通、大型商业体和正规医院提供结构化 POI 证据。通勤缓存由起终点稳定身份和模式决定，阈值变化只重算评分，不重复请求路线。

### Web Evidence

Tavily 提供公开搜索结果；系统按房源身份、城市/行政区、维度相关性、来源层级和重复 URL 过滤。事实保留标题、URL、域名、日期、抓取时间、置信度与 corroboration。

证据项分为 `verified`、`partially_verified`、`conflicting`、`insufficient`。弱来源不能独立变成确定事实，挂牌信息不会自动变成成交样本，公开营销内容不会直接产生小区品质结论。

### Structured Observations

对小区环境、物业服务、公共区域维护、噪音和停车等主观信息，产品优先收集结构化用户观察，而不是让自由文本直接进入评分。它们保留 `user_reported` 来源边界，不能被 AI 描述成公开验证事实。

## 9. Reliability Design

### 发现的问题

- 模型会把预算匹配写成“市场价格合理”；
- 同分维度可能被描述成明显优势；
- 通勤更慢但仍达标时，模型可能错误声称更快；
- unknown 可能被写成缺点或补成事实；
- 教育需求为 none 时，模型仍可能使用教育因素；
- JSON 解析、供应商超时、校验失败会中断用户体验；
- 上下文变化时，旧请求可能晚返回并污染新结果。

### 产品方案

```text
一次用户点击
→ 一次前端请求和连续 loading
→ 模型 attempt 1
→ parse + full factual validation
→ 最多一次 corrective retry
→ deterministic fallback
→ 一个最终可用结果
```

请求签名、in-flight 防重复、AbortController、generation guard 和 Top1 guard 防止旧响应覆盖新上下文。模型输出失败不会阻塞确定性 Results。

## 10. Major Product Iterations

### Iteration A — LLM 不拥有排名权

- **Problem：**通用模型能生成流畅解释，但对同一候选可能给出不稳定顺序。
- **Decision：**评分、权重、Top1 与 Recommendation 全部交给 TypeScript Decision Engine。
- **Implementation：**AI 请求显式携带 authoritative Top1，返回结果必须映射同一候选。
- **Validation：**回归覆盖 Top1 不可变化、候选不可虚构和比较方向不可反转。

### Iteration B — 15 维不要求全部有数据

- **Problem：**用 completeness 代替 quality 会让数据少的房源被系统性惩罚。
- **Decision：**null 保持未知，只在所有候选共同有合法分数的维度上比较。
- **Implementation：**引擎先计算 intended weights，再生成共享 comparable set 与 effective weights。
- **Validation：**many-nulls、偏好变化和候选覆盖差异均有确定性测试。

### Iteration C — 公开搜索不是已确认事实

- **Problem：**搜索摘要可能来自营销、同名项目或相互冲突页面。
- **Decision：**搜索结果先经过身份/相关性/来源过滤，再分类为 scoreable 或 contextual evidence。
- **Implementation：**保留 provenance、置信度、验证状态与冲突；不抓取整页，也不让搜索直接给分。
- **Validation：**覆盖近名项目、弱来源、重复页面、交易/挂牌混淆和冲突隔离。

### Iteration D — AI 摘要和确定性理由分工

- **Problem：**单一长报告既重复数据又掩盖决策。
- **Decision：**AI 摘要负责快速解释当前首选；“为什么更适合您”负责确定性理由；15 维详情负责审计。
- **Implementation：**Results 使用渐进披露的信息架构。
- **Validation：**摘要限制为单段、最多 200 中文字符，并要求至少两个已知理由。

## 11. Product Trade-offs

- **稳定性优先于模型自由：**模型不能改变排序，但仍可优化中文表达。
- **公平比较优先于维度覆盖：**只用共同可比维度，牺牲“15 项全亮”的视觉完整感。
- **可信度优先于信息数量：**部分或冲突 Web Evidence 不能强行支撑主结论。
- **单击体验优先于错误透明：**内部纠错和 fallback 对用户透明，服务端保留安全日志用于诊断。
- **渐进披露优先于一次展示全部：**先结论，再理由，再完整证据。

## 12. Evaluation / Acceptance

现有回归脚本覆盖 Phase 11 个性化权重、证据基础、Evidence Pack、事实推理、最终修复、Scoring Closure、Final Decision Synthesis、AI Summary、纠错与 fallback。生产验收还验证了真实 AMap/Web/GLM 链路、候选上下文一致性和浏览器单击生成。

项目没有声称真实用户增长或商业指标。下一阶段评估框架见 [PRODUCT_METRICS.md](PRODUCT_METRICS.md) 与 [EVAL_PLAN.md](EVAL_PLAN.md)。

## 13. What I Learned

1. AI 产品最关键的设计，不是“在哪里调用模型”，而是定义模型不能决定什么；
2. 数据缺失本身是一种状态，需要产品语义，而不是默认数值；
3. 个性化比较必须共享可比口径，否则权重再精细也无法公平；
4. Evidence provenance 和冲突处理决定了 AI 能否说出可信结论；
5. retry 只能修输出，fallback 才能保护完整用户任务；
6. 解释层需要与决策层、证据层、审计层明确分工。

## 14. Next Steps if Real Users Scale

- 建立离线 golden set 与人工事实标注，持续评估解释准确性；
- 为路线、搜索和模型调用增加成本、延迟、失败率监控；
- 在不改变证据标准的前提下扩展可信交易数据覆盖；
- 引入用户决策反馈，验证 Top3、排序与解释是否真正降低决策成本；
- 评估正式账号体系、数据导出与隐私删除流程；
- 通过 A/B 测试优化信息密度，而不是直接增加更多维度或模型调用。
