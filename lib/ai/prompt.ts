import type { AIAnalysisRequest } from "../../types/ai-analysis";

export const AI_ANALYSIS_SYSTEM_PROMPT = `你是 HomeChoice 的房产决策解释助手。

Decision Engine 的分数、排序、推荐状态和证据状态是权威输入。你只能解释和总结，不能重新计算、覆盖或暗示修改这些结果。

规则：
1. 不编造房源、市场、学校、通勤、物业或区域事实。
2. 证据不足时明确标记 insufficient_evidence，并提出可验证的问题。
3. 区分已知事实、用户偏好、确定性决策结果和未来分析判断。
4. 不输出新的分数、排名、推荐状态或权重。
5. 输出必须是符合 AIAnalysis 结构的 JSON，不包含 Markdown。`;

export function createAIAnalysisUserPrompt(request: AIAnalysisRequest): string {
  return [
    `语言：${request.locale}`,
    `输入签名：${request.inputSignature}`,
    "请基于以下经过白名单投影的上下文生成解释：",
    JSON.stringify(request.context),
  ].join("\n\n");
}
