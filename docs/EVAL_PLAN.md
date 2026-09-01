# HomeChoice Evaluation Plan

> 本文件定义后续评测方向，不代表已经上线新的评测平台。当前仓库已有确定性回归脚本；未来生产评测需要在真实流量、隐私和成本约束下单独建设。

## 1. Evaluation Objectives

HomeChoice 需要分别评估三个层面：

1. **Decision correctness**：相同输入是否稳定得到符合规则的评分、权重、排名和 Top1；
2. **Evidence integrity**：来源、可信度、冲突和缺失是否被正确传递；
3. **Narrative safety and usefulness**：AI 是否准确解释权威结果，同时保持简洁、个性化和可行动。

“用户是否最终购买”受市场、家庭和谈判等大量外部因素影响，不能直接当作模型正确率。

## 2. Existing Regression Coverage

仓库现有轻量 TypeScript 脚本主要覆盖：

- `scripts/test-phase11a-personalization.ts`：个性化权重和价格评分相关边界；
- `scripts/test-phase11b-evidence-foundation.ts`：Evidence Pack、验证状态与上下文基础；
- `scripts/test-phase11c-evidence-reasoning.ts`、`test-phase11c-final-fix.ts`、`test-phase11c-scoring-closure.ts`：证据推理、事实边界和阶段性回归；
- `scripts/test-ai-corrective-retry.ts`：首次生成、一次纠错与 fallback；
- `scripts/test-final-ai-summary.ts`：最终 AI 摘要长度、事实与风格约束；
- `scripts/test-final-decision-synthesis.ts`：最终决策综合表达。

这些脚本是代码级回归保护，不等同于真实用户质量评估，也不代表已覆盖所有 Provider 随机性。

## 3. Core Scenario Matrix

| Scenario | 核心输入 | 预期行为 |
| --- | --- | --- |
| Normal comparison | 2–3 套信息较完整候选 | 稳定 Top1；解释覆盖 Top3 与关键取舍 |
| Many nulls | 多个维度缺失 | `null` 不计零分；只在共享可比维度排名 |
| Preference change | 调整 Top3 / purchase purpose | 权重与结果按规则变化；旧 AI 结果失效 |
| Hard budget constraint | 一套超预算、一套预算内 | 预算规则正确；不把预算匹配写成市场价格合理 |
| Evidence conflict | 公开来源相互冲突 | 冲突不支持主结论；可提示仍需确认 |
| Web unavailable | 搜索超时/无相关结果 | Results 与确定性排名可用；不产生零分 |
| AMap partial failure | 个别路线/POI 失败 | 保留成功证据；不虚构时间或设施 |
| Close ranking | Top1 / Top2 很接近 | 不夸大领先；仍保持权威候选顺序 |
| Hallucinated number | 模型生成上下文不存在数字 | Validation 拒绝；纠错或 fallback |
| Wrong comparison direction | 更慢写成更快、相等写成更优 | Validation 拒绝 |
| Education none | 教育需求为 none | 教育不进入有效优先级、理由或风险 |
| Retry | 首次为可纠正事实错误 | 同一请求内最多一次纠错，最终响应一次返回 |
| Fallback | Provider / parse / 两次校验失败 | 本地安全解释；Top1、候选和事实不变 |
| Stale context | 生成中修改价格/偏好 | 旧请求不能覆盖新 signature；旧有效结果按规则标记 |
| History | 保存后修改当前数据 | 旧 snapshot 不重算、不被改写 |

## 4. Deterministic Decision Evals

建议对每个规则维护输入—输出夹具：

- 15 个 dimension key 和 label 不漂移；
- purchase purpose 与 Top3 的 intended weights 正确；
- education disabled 逻辑正确；
- 候选共享 Effective Comparable Dimension Set；
- 每个候选使用同一有效权重向量；
- missing ≠ zero，unknown ≠ negative；
- 排名 tie-break 保持确定性；
- Recommendation / confidence / completeness 边界保持稳定。

成功标准应是精确断言，而不是 LLM judge。

## 5. Evidence Evals

### AMap

- confirmed coordinates 优先，避免重复 geocode；
- driving / transit / walking / cycling 与 flexible 选择正确；
- 商业只使用目标设施类型与半径；
- 医疗只统计符合规则的正规医院；
- 单模式失败不覆盖其他成功模式；
- cache identity 只随位置、目的地和模式等相关字段失效。

### Web

- 属性名、城市、行政区相关性过滤；
- 近似但不同项目不会混入；
- URL/title 去重；
- 来源 credibility 不因搜索排序被抬高；
- listing、transaction、unknown 不混用；
- VERIFIED / PARTIAL / CONFLICTING / INSUFFICIENT 语义正确；
- 无可用证据时不产生事实或数值分数。

## 6. AI Narrative Evals

### Factual gates

- 推荐对象必须是确定性 Top1；
- 所有候选存在于权威上下文；
- 数字、价格类型和比较方向一致；
- unknown / conflicting / insufficient 不变成已确认事实；
- educationNeed=none 时不使用教育；
- 不创造学校资格、升值、物业质量或市场成交结论。

### Product quality

- 明确回答“哪套更适合、为什么”；
- 至少使用 2 个真实已知理由；
- 重点响应适用的 Top3；
- 不逐维复述，也不输出工程术语；
- 简洁、自然、可行动；
- 对接近排名和部分证据保持克制。

### Reliability

- 首次通过时 1 次 Provider call；
- 可纠错错误最多 2 次 call；
- Provider / parse / validation exhausted 可安全 fallback；
- 正常有效上下文维持单次点击、单次等待、单个最终结果；
- 旧缓存和 stale response 不覆盖新上下文。

## 7. Future Production AI Eval

未来建议建立经匿名化的评测集，按候选数量、城市、Top3、数据完整度和 evidence state 分层。每次 Prompt、模型、验证规则或证据解释版本变化时运行：

1. 离线 deterministic fixtures；
2. 固定 Evidence Pack 的多次生成稳定性测试；
3. 自动事实校验；
4. 双人抽样标注解释相关性和克制度；
5. 小流量线上观察 first-pass、retry、fallback、延迟和成本；
6. 失败样本归因到 provider、parse、validation、context 或产品规则。

## 8. Metric Candidates

- Deterministic ranking consistency：目标 100%；
- Top1 narrative consistency：目标 100%；
- Hallucinated candidate / number rate；
- Comparison direction error rate；
- Unknown-as-fact rate；
- Top3 material coverage；
- First-attempt validation pass rate；
- End-to-end usable response rate；
- Retry / fallback rate；
- P50 / P95 latency；
- Human explanation relevance；
- Evidence-use accuracy；
- Cost per completed analysis。

具体阈值应在建立真实基线后确定，不能从当前 portfolio MVP 虚构。
