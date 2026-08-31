import type {
  AIAnalysisRequest,
  AICandidateDecisionContext,
  AIComparisonRelation,
  AIDimensionComparisonFact,
  AINarrativeComparisonFact,
  AINarrativeFact,
  AINarrativeFacts,
} from "../../types/ai-analysis";
import type { DecisionPriority } from "../../types/buyer-preferences";
import type { DimensionKey } from "../../types/decision";

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  commute: "通勤",
  price: "预算与价格",
  layout_and_space: "户型与空间",
  community_quality: "小区品质",
  property_management: "物业服务",
  education: "教育需求",
  commercial_amenities: "商业配套",
  medical_amenities: "医疗配套",
  public_transport: "公共交通",
  liquidity: "流动性",
  value_preservation: "长期价值",
};

const PRIORITY_DIMENSIONS: Record<DecisionPriority, DimensionKey[]> = {
  commute: ["commute"],
  price: ["budget_match", "transaction_price_reasonableness"],
  layout_and_space: ["space_match", "layout_design"],
  community_quality: ["community_quality"],
  property_management: ["property_management"],
  education: ["education"],
  commercial_amenities: ["commercial_amenities"],
  medical_amenities: ["medical_amenities"],
  public_transport: ["public_transport"],
  liquidity: ["liquidity"],
  value_preservation: ["value_preservation"],
};

const NEXT_STEP_BY_DIMENSION: Partial<Record<DimensionKey, string>> = {
  commute: "在工作日通勤高峰实测本人及伴侣的实际通勤时间",
  community_quality: "实地查看小区公共区域、维护状态、噪音和停车情况",
  property_management: "向在住业主确认物业响应、公共区域维护和收费情况",
  transaction_price_reasonableness: "补充近期同小区、相近面积户型的真实成交记录",
  layout_design: "实地确认采光、动线和实际空间利用情况",
  space_match: "结合家庭成员和房间用途实地核对空间是否够用",
  liquidity: "核实近期真实挂牌周期与成交记录",
  value_preservation: "核实相关规划的官方进度与实施状态",
  public_transport: "实地确认步行至公共交通站点的路线与耗时",
};

function candidateName(candidate: AICandidateDecisionContext): string {
  return candidate.property.name ?? candidate.decision.propertyName ?? "未命名房源";
}

function fact(
  kind: string,
  candidate: AICandidateDecisionContext,
  dimension: DimensionKey | null,
  allowedMeaning: string,
  values: Record<string, string | number | null> = {},
): AINarrativeFact {
  return {
    kind,
    subjectId: candidate.property.propertyId,
    subjectName: candidateName(candidate),
    dimension,
    values,
    allowedMeaning,
  };
}

function dimensionPriorityOrder(priorities: DecisionPriority[]): DimensionKey[] {
  return priorities.flatMap((priority) => PRIORITY_DIMENSIONS[priority]);
}

function buildRequiredFacts(request: AIAnalysisRequest): AINarrativeFact[] {
  const top = request.context.candidates[0];
  const result: AINarrativeFact[] = [];
  const maximumBudget = request.context.preferences.maximumBudget;
  const expectedPrice = top.property.expectedTransactionPrice;
  const budgetMargin = top.property.budgetDifference;
  result.push(fact(
    budgetMargin >= 0 ? "BUDGET_WITHIN_RANGE" : "BUDGET_OVER_LIMIT",
    top,
    "budget_match",
    budgetMargin >= 0
      ? `首选预期成交价为${expectedPrice}万元，在${maximumBudget}万元最高预算内，保留约${budgetMargin}万元资金余量。`
      : `首选预期成交价为${expectedPrice}万元，比${maximumBudget}万元最高预算高约${Math.abs(budgetMargin)}万元。`,
    { expectedPrice, maximumBudget, budgetMargin },
  ));

  const primary = top.geoEvidence?.commute?.primary;
  const partner = top.geoEvidence?.commute?.partner;
  if (primary?.selectedMinutes !== null && primary?.selectedMinutes !== undefined) {
    const primaryBoundary = primary.idealCommuteMinutes !== null && primary.selectedMinutes <= primary.idealCommuteMinutes
      ? "处于本人理想通勤范围"
      : primary.maxCommuteMinutes !== null && primary.selectedMinutes <= primary.maxCommuteMinutes
        ? "高于本人理想值但仍在最大可接受范围"
        : "超过本人当前最大可接受范围";
    const partnerText = partner?.selectedMinutes !== null && partner?.selectedMinutes !== undefined
      ? `；伴侣约${partner.selectedMinutes}分钟${partner.maxCommuteMinutes !== null && partner.selectedMinutes <= partner.maxCommuteMinutes ? "，未超过伴侣最大可接受范围" : "，需结合伴侣通勤边界判断"}`
      : "";
    result.push(fact(
      "HOUSEHOLD_COMMUTE",
      top,
      "commute",
      `首选本人通勤约${primary.selectedMinutes}分钟，${primaryBoundary}${partnerText}。地图路线仅作参考，实际高峰仍需实测。`,
      {
        primaryMinutes: primary.selectedMinutes,
        primaryIdealMinutes: primary.idealCommuteMinutes,
        primaryMaxMinutes: primary.maxCommuteMinutes,
        partnerMinutes: partner?.selectedMinutes ?? null,
        partnerIdealMinutes: partner?.idealCommuteMinutes ?? null,
        partnerMaxMinutes: partner?.maxCommuteMinutes ?? null,
      },
    ));
  }

  const priorityOrder = dimensionPriorityOrder(request.context.preferences.topPriorities);
  const selectedDimensions = top.decision.dimensions
    .filter((dimension) => dimension.score !== null && dimension.status !== "unknown" && dimension.key !== "budget_match" && dimension.key !== "commute")
    .filter((dimension) => request.context.preferences.educationNeed !== "none" || dimension.key !== "education")
    .sort((left, right) => {
      const leftPriority = priorityOrder.indexOf(left.key);
      const rightPriority = priorityOrder.indexOf(right.key);
      const leftRank = leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const rightRank = rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority;
      return leftRank - rightRank || right.finalWeight - left.finalWeight;
    })
    .slice(0, Math.max(0, 3 - result.length));

  for (const dimension of selectedDimensions) {
    result.push(fact(
      "KNOWN_DIMENSION",
      top,
      dimension.key,
      dimension.status === "partial"
        ? `${dimension.label}已有部分证据支持，但仍需保留不确定性。`
        : `${dimension.label}已有可用信息支持当前判断。`,
    ));
  }
  return result.slice(0, 3);
}

function relationMeaning(relation: AIComparisonRelation): AINarrativeComparisonFact["relationMeaning"] {
  if (relation === "TOP1_BETTER") return "首选相对更符合该项";
  if (relation === "TOP1_WORSE") return "主要备选相对更符合该项";
  if (relation === "TOP1_WORSE_BUT_WITHIN_TARGET") return "主要备选数值更优，但首选仍满足目标";
  if (relation === "EQUAL") return "两者表现相当";
  if (relation === "CLOSE") return "两者表现接近";
  return "当前信息不足以比较";
}

function dimensionComparisonMeaning(
  comparison: AIDimensionComparisonFact,
  topName: string,
  alternativeName: string,
): string {
  const relation = relationMeaning(comparison.relation);
  if (relation === "首选相对更符合该项") return `${topName}在${comparison.label}的当前对比中相对更强。`;
  if (relation === "主要备选相对更符合该项") return `${alternativeName}在${comparison.label}的当前对比中相对更强。`;
  if (relation === "两者表现相当") return `两套房在${comparison.label}上的当前结果相当，不得声称任一方明显领先。`;
  if (relation === "两者表现接近") return `两套房在${comparison.label}上的当前结果接近，不得制造显著差距。`;
  return `${comparison.label}当前信息不足以形成候选优劣比较。`;
}

function buildComparisonFacts(request: AIAnalysisRequest): AINarrativeComparisonFact[] {
  const comparisons = request.context.candidateComparisons;
  const top = request.context.candidates[0];
  const alternative = request.context.candidates[1];
  if (!comparisons || !alternative) return [];
  const topName = candidateName(top);
  const alternativeName = candidateName(alternative);
  const result: AINarrativeComparisonFact[] = [];

  const commute = comparisons.commute;
  if (commute.relation !== "UNKNOWN") {
    let allowedMeaning: string;
    if (commute.relation === "TOP1_WORSE_BUT_WITHIN_TARGET") {
      allowedMeaning = `${alternativeName}的通勤时间更短；${topName}虽然更慢，但仍满足当前通勤目标。`;
    } else if (commute.relation === "TOP1_WORSE") {
      allowedMeaning = `${alternativeName}的通勤表现相对更好。`;
    } else if (commute.relation === "TOP1_BETTER") {
      allowedMeaning = `${topName}的通勤表现相对更符合当前目标。`;
    } else {
      allowedMeaning = `两套房通勤${commute.relation === "EQUAL" ? "相当" : "接近"}。`;
    }
    result.push({
      ...fact("COMMUTE_COMPARISON", top, "commute", allowedMeaning, {
        topPrimaryMinutes: commute.top1PrimaryMinutes,
        alternativePrimaryMinutes: commute.top2PrimaryMinutes,
        topPartnerMinutes: commute.top1PartnerMinutes,
        alternativePartnerMinutes: commute.top2PartnerMinutes,
        primaryIdealMinutes: commute.primaryIdealMinutes,
        primaryMaxMinutes: commute.primaryMaxMinutes,
      }),
      alternativeId: alternative.property.propertyId,
      alternativeName,
      relationMeaning: relationMeaning(commute.relation),
    });
  }

  const budget = comparisons.budgetMatch;
  result.push({
    ...fact("BUDGET_COMPARISON", top, "budget_match",
      budget.relation === "TOP1_BETTER"
        ? `${topName}的预期成交价更低，预算余量相对更多。`
        : budget.relation === "TOP1_WORSE"
          ? `${alternativeName}的预期成交价更低，预算余量相对更多。`
          : `两套房的预期成交价与预算余量${budget.relation === "EQUAL" ? "相当" : budget.relation === "CLOSE" ? "接近" : "目前不足以比较"}。`,
      {
        topExpectedPrice: budget.top1ExpectedTransactionPrice,
        alternativeExpectedPrice: budget.top2ExpectedTransactionPrice,
        maximumBudget: budget.maximumBudget,
        topBudgetMargin: budget.top1BudgetMargin,
        alternativeBudgetMargin: budget.top2BudgetMargin,
      }),
    alternativeId: alternative.property.propertyId,
    alternativeName,
    relationMeaning: relationMeaning(budget.relation),
  });

  const priorityOrder = dimensionPriorityOrder(request.context.preferences.topPriorities);
  const remaining = comparisons.dimensions
    .filter((item) => item.dimensionKey !== "commute" && item.dimensionKey !== "budget_match")
    .filter((item) => item.relation !== "UNKNOWN")
    .filter((item) => request.context.preferences.educationNeed !== "none" || item.dimensionKey !== "education")
    .sort((left, right) => {
      const leftPriority = priorityOrder.indexOf(left.dimensionKey);
      const rightPriority = priorityOrder.indexOf(right.dimensionKey);
      return (leftPriority < 0 ? 999 : leftPriority) - (rightPriority < 0 ? 999 : rightPriority);
    });
  for (const comparison of remaining) {
    if (result.length >= 3) break;
    result.push({
      ...fact("DIMENSION_COMPARISON", top, comparison.dimensionKey, dimensionComparisonMeaning(comparison, topName, alternativeName)),
      alternativeId: alternative.property.propertyId,
      alternativeName,
      relationMeaning: relationMeaning(comparison.relation),
    });
  }
  return result;
}

function buildUncertaintyFacts(request: AIAnalysisRequest): AINarrativeFact[] {
  const top = request.context.candidates[0];
  const priorityOrder = dimensionPriorityOrder(request.context.preferences.topPriorities);
  return top.decision.dimensions
    .filter((dimension) => dimension.score === null || dimension.status === "unknown" || dimension.missingInputs.length > 0)
    .filter((dimension) => request.context.preferences.educationNeed !== "none" || dimension.key !== "education")
    .sort((left, right) => {
      const leftPriority = priorityOrder.indexOf(left.key);
      const rightPriority = priorityOrder.indexOf(right.key);
      return (leftPriority < 0 ? 999 : leftPriority) - (rightPriority < 0 ? 999 : rightPriority)
        || right.finalWeight - left.finalWeight;
    })
    .slice(0, 3)
    .map((dimension) => fact(
      "NEEDS_CONFIRMATION",
      top,
      dimension.key,
      `目前仍缺少足够证据判断${dimension.label}的实际表现，尚待确认。`,
    ));
}

function buildNextStepFacts(
  request: AIAnalysisRequest,
  uncertainties: AINarrativeFact[],
): AINarrativeFact[] {
  const top = request.context.candidates[0];
  const selected = uncertainties
    .flatMap((uncertainty) => uncertainty.dimension && NEXT_STEP_BY_DIMENSION[uncertainty.dimension]
      ? [{ dimension: uncertainty.dimension, action: NEXT_STEP_BY_DIMENSION[uncertainty.dimension]! }]
      : [])
    .filter((item, index, items) => items.findIndex((candidate) => candidate.action === item.action) === index)
    .slice(0, 3);
  if (selected.length === 0) {
    selected.push({
      dimension: "transaction_price_reasonableness",
      action: "补充近期真实成交记录，并在出价前复核预期成交假设",
    });
  }
  return selected.map(({ dimension, action }) => fact(
    "NEXT_STEP",
    top,
    dimension,
    action,
  ));
}

export function buildNarrativeFacts(request: AIAnalysisRequest): AINarrativeFacts {
  const top = request.context.candidates[0];
  if (!top || top.property.propertyId !== request.context.authoritativeTopPropertyId) {
    throw new Error("Narrative facts require the deterministic Top1 candidate first.");
  }
  const educationExcluded = request.context.preferences.educationNeed === "none";
  const uncertaintyFacts = buildUncertaintyFacts(request);
  const comparisonFacts = buildComparisonFacts(request);
  return {
    topCandidate: {
      id: top.property.propertyId,
      name: candidateName(top),
      rank: 1,
      recommendation: top.decision.recommendation,
      matchScore: top.decision.matchScore,
    },
    candidateOrder: request.context.candidates.map((candidate, index) => ({
      id: candidate.property.propertyId,
      name: candidateName(candidate),
      rank: index + 1,
    })),
    userPriorities: request.context.preferences.topPriorities
      .filter((priority) => !educationExcluded || priority !== "education")
      .map((dimension, index) => ({ dimension, label: PRIORITY_LABELS[dimension], rank: index + 1 })),
    requiredFacts: buildRequiredFacts(request),
    comparisonFacts,
    uncertaintyFacts,
    nextStepFacts: buildNextStepFacts(request, uncertaintyFacts),
    prohibitedClaims: [
      { dimension: null, guidance: "不得引入清单之外的候选、数字、地点或证据，也不得改变候选顺序、分数或推荐。" },
      { dimension: null, guidance: "不得在用户文案中出现英文证据缺口、比较枚举、内部比较对象、决策引擎、校验或维度键等技术术语。" },
      { dimension: "transaction_price_reasonableness", guidance: "预算内只说明符合预算约束；没有充分真实成交样本时，不得声称市场价格合理或已得到市场验证。" },
      ...uncertaintyFacts.map((item) => ({
        dimension: item.dimension,
        guidance: "当前信息不足的事项只能写尚待确认，不得写成优势、缺点或确定风险。",
      })),
      ...comparisonFacts
        .filter((item) => item.relationMeaning === "两者表现相当" || item.relationMeaning === "两者表现接近")
        .map((item) => ({
          dimension: item.dimension,
          guidance: "表现相当或接近的事项不得声称任一方明显领先。",
        })),
    ],
  };
}
