# HomeChoice Portfolio Screenshot Guide

仓库当前未包含可用于作品集的真实产品截图。本指南用于后续从已部署的 `v1.0.0` 手工截取素材；不要使用设计稿或伪造数据冒充真实运行画面。

## Capture Principles

- 使用桌面浏览器主视图，建议 1440×900 或接近比例；
- 使用同一组清晰、无敏感信息的演示候选，保证跨页面叙事一致；
- 隐去真实姓名、详细住址、工作单位和其他个人信息；
- 截图前确认不是历史快照或过期 AI cache；
- 不把 API Key、浏览器开发者工具、Supabase 标识或调试日志截入画面；
- README 最终建议只放 3–4 张最强截图，其余留在 Case Study 或面试演示中。

## 1. Home

- **Page:** `/`
- **应包含:** HomeChoice 定位、核心价值主张、主 CTA 与低权重示例体验 CTA。
- **面试价值:** 说明产品服务的是“已有候选后的购房决策”，不是房源搜索平台。
- **建议文件名:** `docs/assets/home.png`

## 2. Candidate Properties

- **Page:** `/properties`
- **应包含:** 2–3 套候选卡片、已确认位置状态、添加/编辑入口；不要显示敏感详细地址。
- **面试价值:** 展示输入边界和多候选比较前提，以及 Location Confirmation 并非自由文本地址。
- **建议文件名:** `docs/assets/properties.png`

## 3. Buyer Preferences

- **Page:** `/preferences`
- **应包含:** 购房目的、预算、Top3、有代表性的本人/伴侣通勤设置与工作地点确认。
- **面试价值:** 展示个性化不是文案层，而是进入权重和确定性决策的结构化输入。
- **建议文件名:** `docs/assets/preferences.png`

## 4. Recommendation Result

- **Page:** `/results`
- **应包含:** 页面顶部首选房源、Recommendation、匹配度、挂牌价和预期成交价；可适当保留下方首屏内容。
- **面试价值:** 证明 Results 采用“Decision First”信息层级，用户可快速回答哪套更适合。
- **建议文件名:** `docs/assets/results-recommendation.png`

## 5. AI 购房解读

- **Page:** `/results`
- **应包含:** 已成功生成的单段 AI 解读，文字需清晰可读，并与当前候选和偏好一致。
- **面试价值:** 展示 LLM 的职责是解释权威结论，而不是自己排名；可配合讲 validation / retry / fallback。
- **建议文件名:** `docs/assets/ai-summary.png`

## 6. 为什么更适合您

- **Page:** `/results`
- **应包含:** 最多三条确定性 Decision Reasons，最好分别覆盖用户重点偏好、已知差异和家庭约束。
- **面试价值:** 展示即使 AI 不可用，用户仍能看到由规则产生的可解释理由。
- **建议文件名:** `docs/assets/why-fit.png`

## 7. 15D Detailed Analysis

- **Page:** `/results`，展开“查看完整 15 维分析”
- **应包含:** 若干有分数、有证据、部分证据和未知状态的维度卡；不必一次塞入全部卡片。
- **面试价值:** 解释 Missing ≠ 0、Unknown ≠ negative，以及证据来源和渐进披露。
- **建议文件名:** `docs/assets/decision-15d.png`

## 8. Decision History

- **Page:** `/history` 或某个历史详情
- **应包含:** 已保存记录及可打开的 snapshot；避免显示个人敏感字段。
- **面试价值:** 展示一次决策可被保留和复查，后续数据变化不会回写旧判断。
- **建议文件名:** `docs/assets/history.png`

## Recommended README Set

如果只选择四张，建议依次使用：

1. `home.png`
2. `preferences.png`
3. `results-recommendation.png`
4. `ai-summary.png` 或 `decision-15d.png`

这组图片能用最短路径讲清“用户偏好 → 确定性决策 → AI 解释 → 透明证据”。
