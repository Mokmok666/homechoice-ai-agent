import type { BuyerPreferences } from "../../types/buyer-preferences";
import type {
  ConfidenceResult,
  DimensionEvaluation,
  HardMismatch,
  Recommendation,
} from "../../types/decision";
import type { Property } from "../../types/property";

interface RecommendationInput {
  property: Property;
  preferences: BuyerPreferences;
  dimensions: DimensionEvaluation[];
  confidence: ConfidenceResult;
  overallScore: number | null;
  propertyCount: number;
}

export interface RecommendationResult {
  recommendation: Recommendation;
  reasons: string[];
  decisionFactors: string[];
  hardMismatches: HardMismatch[];
}

export function makeRecommendation(input: RecommendationInput): RecommendationResult {
  const { property, preferences, dimensions, confidence, overallScore } = input;
  const byKey = new Map(dimensions.map((item) => [item.key, item]));
  const budgetRatio = property.totalPrice / preferences.maximumBudget;
  const priceReasonableness = byKey.get("transaction_price_reasonableness");
  const hardMismatches: HardMismatch[] = [];
  const decisionFactors: string[] = [];

  if (budgetRatio > 1.1 && byKey.get("budget_match")?.status === "known") {
    hardMismatches.push({
      dimension: "budget_match",
      reason: "预期成交价超过家庭最高预算 10% 以上，存在明确支付压力。",
    });
  } else if (budgetRatio > 1) {
    decisionFactors.push("预期成交价略高于家庭最高预算，建议优先关注议价空间。");
  } else {
    decisionFactors.push("预期成交价位于家庭最高预算以内。");
  }

  if (
    priceReasonableness?.score !== null &&
    priceReasonableness?.score !== undefined
  ) {
    if (priceReasonableness.score <= 30) {
      hardMismatches.push({
        dimension: "transaction_price_reasonableness",
        reason: "已确认成交参考显示预期成交单价存在显著偏高风险。",
      });
    } else if (priceReasonableness.score < 60) {
      decisionFactors.push("近期成交参考显示当前价格安全边际偏弱。");
    } else {
      decisionFactors.push("当前成交参考未显示显著价格偏离。");
    }
  } else {
    decisionFactors.push("当前价格判断基于已知预算关系；增加成交样本只会提升可信度。");
  }

  decisionFactors.push(
    confidence.analysisConfidence === "supported"
      ? "当前结构化信息较充分，分析可信度较高。"
      : "当前建议为阶段性判断，可进一步确认的信息不会阻塞推荐。",
  );

  if (hardMismatches.length > 0) {
    return {
      recommendation: "PASS",
      reasons: hardMismatches.map((item) => item.reason),
      decisionFactors,
      hardMismatches,
    };
  }

  if (budgetRatio > 1 || (priceReasonableness?.score ?? 100) < 60) {
    return {
      recommendation: "WAIT",
      reasons: ["房源仍可保留，但当前价格条件存在需要优先处理或观察的风险。"],
      decisionFactors,
      hardMismatches: [],
    };
  }

  return {
    recommendation: "CONSIDER",
    reasons: [
      overallScore === null
        ? "基于当前已确认事实，未发现阻止继续考虑该房源的硬性冲突。"
        : "基于当前已确认事实与家庭偏好，该房源可以继续进入优先考虑范围。",
    ],
    decisionFactors,
    hardMismatches: [],
  };
}
