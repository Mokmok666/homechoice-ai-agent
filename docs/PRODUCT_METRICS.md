# HomeChoice 产品指标框架

> **Future measurement framework**：本文件描述未来真实用户版本的测量方案，不代表 HomeChoice 已取得下列指标，也不包含虚构的用户量、转化率或商业成果。

## 1. 测量目标

HomeChoice 的价值不是让用户浏览更多房源，而是帮助已有候选的用户完成一个更清晰、可解释、可继续验证的阶段性购房判断。因此指标需要同时覆盖：

- 用户是否完成了有效决策流程；
- 推荐是否真正响应个人偏好；
- AI 解释是否准确且有帮助；
- 外部证据和模型失败时，任务是否仍能完成；
- 服务延迟与成本是否可持续。

## 2. North Star Candidate

### Successful Decision Completion Rate

定义候选：在一个决策周期内，用户完成以下关键步骤并查看有效推荐的比例：

1. 至少添加 2 套有效候选房源；
2. 完成核心 Buyer Preferences；
3. 进入 Results 并获得确定性排序；
4. 查看关键理由或 AI 解读；
5. 保存决策，或明确记录后续需要确认的事项。

该指标需要在真实研究中验证。保存快照不一定等于用户获得价值，因此应配合访谈、回访和推荐接受度使用。

## 3. Funnel

```text
Visit
  → Add ≥2 properties
  → Confirm property/work locations
  → Complete core preferences + Top3
  → View deterministic recommendation
  → Generate/view AI explanation
  → Inspect reasons/evidence
  → Save decision
```

建议事件：

| Stage | Event candidate | 关键属性 |
| --- | --- | --- |
| 访问 | `session_started` | demo / non-demo、device |
| 房源 | `property_confirmed` | candidate count、location confirmed |
| 偏好 | `preferences_completed` | Top3、partner commute configured |
| 结果 | `decision_rendered` | candidate count、completeness、confidence |
| AI | `ai_generation_completed` | model/fallback、latency、retry used |
| 证据 | `evidence_detail_viewed` | dimension、evidence state |
| 保存 | `decision_saved` | time-to-decision、candidate count |

事件不应记录完整地址、工作地点原文、模型 Prompt、API Key 或其他不必要的个人数据。

## 4. Product Metrics

| Metric | 定义方向 | 用途 |
| --- | --- | --- |
| Property input completion | 开始添加后完成有效房源确认的比例 | 找出录入与位置确认摩擦 |
| Preference completion | 开始偏好设置后保存核心字段的比例 | 验证偏好模型是否易理解 |
| Decision completion | 有效候选集获得 Results 的比例 | 核心任务完成度 |
| AI generation success | 单次前端请求最终获得可用解释的比例 | 生成链路可靠性 |
| Corrective retry rate | 首次输出未通过、内部纠错的比例 | 模型稳定性与 Prompt 健康度 |
| Deterministic fallback rate | 最终使用本地安全解释的比例 | Provider/validation 风险监控 |
| Recommendation acceptance | 用户将 Top1 保留为当前首选或保存决策的比例 | 推荐可用性信号，不等于绝对正确率 |
| Decision confidence | 用户自报的判断清晰度/信心变化 | 衡量解释和证据价值 |
| Time-to-decision | 从有效候选集到查看/保存决策的时间 | 是否降低比较成本 |
| Evidence confirmation action | 用户因“仍需确认”而补充信息的比例 | 验证风险提示是否可执行 |

## 5. AI Quality Metrics

| Metric | 建议定义 |
| --- | --- |
| Factual accuracy | 摘要中的可核验事实与权威上下文一致的比例 |
| Hallucination rate | 出现上下文不存在的房源、数字、设施或结论的比例 |
| Preference alignment | 适用 Top3 在解释中被实质回应的比例 |
| Ranking consistency | AI 推荐对象与确定性 Top1 一致的比例，目标应为 100% |
| Comparison direction accuracy | 相对关系与确定性 comparison facts 一致的比例 |
| Explanation relevance | 用户/标注员判断内容是否回答“为什么适合我” |
| Evidence-use accuracy | VERIFIED / PARTIAL / CONFLICTING / INSUFFICIENT 是否被正确措辞 |
| Unknown neutrality | 未知是否未被表达为负面或优势 |
| First-attempt pass rate | 首次模型输出通过完整事实校验的比例 |
| End-to-end success | 含 retry/fallback 后最终可用响应比例 |
| Latency | P50 / P95 前端单次生成总时长 |
| Cost per analysis | 搜索、证据解释和 Narrative 的综合调用成本 |

## 6. Guardrails

- Top1 一致率和非法事实率优先于文案多样性；
- fallback 提高任务成功率，但不能掩盖 Provider 或 Prompt 退化；
- Recommendation acceptance 不能单独视为“推荐正确”；
- 不用更多页面停留时间作为正向目标，用户更快形成清晰判断可能更有价值；
- 指标应按 demo、真实输入、候选数量、信息完整度和 evidence state 分层。

## 7. Suggested Research Loop

1. 用可控情景完成可用性测试，观察用户能否快速指出 Top1、原因和风险；
2. 让购房者对推荐与理由分别评分，避免把“喜欢文案”误当成“接受推荐”；
3. 记录用户最终补充了哪些证据，以及补充后排序是否变化；
4. 定期抽样审计 AI 事实准确率与 fallback；
5. 真实用户规模扩大后，再用漏斗和留存验证是否形成持续价值。
