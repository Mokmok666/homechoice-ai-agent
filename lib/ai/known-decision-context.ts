import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import { getPriorityDimensions } from "@/lib/decision/weights";
import type { DecisionEvidencePack } from "@/types/decision-evidence-pack";
import type { DimensionKey } from "@/types/decision";
import type { KnownDecisionAttention, KnownDecisionContext, KnownDecisionFactor } from "@/types/known-decision-context";
import type { PropertyGeoEvidence } from "@/types/geo-evidence";

function usableAmapEvidence(evidence: PropertyGeoEvidence | null): Partial<PropertyGeoEvidence> | null {
  if (!evidence) return null;
  const usable = Object.fromEntries(Object.entries(evidence).filter(([, item]) => {
    if (!item || typeof item !== "object") return false;
    const record = item as { status?: string; quality?: string };
    return record.status !== "insufficient" && record.quality !== "low";
  })) as Partial<PropertyGeoEvidence>;
  return Object.keys(usable).length > 0 ? usable : null;
}

function priorityRank(pack: DecisionEvidencePack, dimension: DimensionKey): 1 | 2 | 3 | null {
  for (const priority of pack.priorities) {
    if (getPriorityDimensions(priority.priority).includes(dimension)) return priority.rank as 1 | 2 | 3;
  }
  return null;
}

function familyCommuteMinutes(candidate: DecisionEvidencePack["candidates"][number], hasPartner: boolean): number | null {
  const commute = candidate.amapEvidence?.commute;
  const primary = commute?.primary?.selectedMinutes ?? commute?.durationMinutes ?? null;
  const partner = commute?.partner?.selectedMinutes ?? null;
  if (primary === null || (hasPartner && partner === null)) return null;
  return hasPartner ? primary * 0.6 + partner! * 0.4 : primary;
}

function buildFactors(pack: DecisionEvidencePack, comparable: Set<DimensionKey>): KnownDecisionFactor[] {
  const top = pack.candidates[0];
  const alternative = pack.candidates[1];
  if (!top) return [];
  return top.dimensionResults.flatMap((dimension): KnownDecisionFactor[] => {
    if (!comparable.has(dimension.key) || dimension.score === null) return [];
    if (dimension.key === "value_preservation" && dimension.status !== "known") return [];
    const otherScore = alternative?.dimensionResults.find((item) => item.key === dimension.key)?.score ?? null;
    const delta = otherScore === null ? 0 : dimension.score - otherScore;
    let relation: KnownDecisionFactor["relation"] = !alternative
      ? "single_candidate"
      : delta === 0 ? "equal" : Math.abs(delta) < 5 ? "close" : delta > 0 ? "top_better" : "top_worse";
    if (dimension.key === "commute" && alternative) {
      const hasPartner = Boolean(pack.buyerContext.partnerWorkLocation || pack.buyerContext.partnerWorkLocationConfirmed);
      const topMinutes = familyCommuteMinutes(top, hasPartner);
      const alternativeMinutes = familyCommuteMinutes(alternative, hasPartner);
      if (topMinutes !== null && alternativeMinutes !== null) {
        const minuteDelta = topMinutes - alternativeMinutes;
        relation = Math.abs(minuteDelta) < 0.5 ? "equal" : Math.abs(minuteDelta) <= 3 ? "close" : minuteDelta < 0 ? "top_better" : "top_worse";
      }
    }
    return [{
      dimension: dimension.key,
      label: DIMENSION_LABELS[dimension.key],
      priorityRank: priorityRank(pack, dimension.key),
      effectiveWeight: pack.effectiveWeights?.[dimension.key] ?? pack.weights[dimension.key],
      topScore: dimension.score,
      alternativeScore: otherScore,
      relation,
      impact: Math.abs(delta) * (pack.effectiveWeights?.[dimension.key] ?? pack.weights[dimension.key]) / 100,
    }];
  }).sort((left, right) => {
    const leftPriority = left.priorityRank ?? 99;
    const rightPriority = right.priorityRank ?? 99;
    return leftPriority - rightPriority || right.impact - left.impact || right.effectiveWeight - left.effectiveWeight;
  }).slice(0, 5);
}

function buildAttention(pack: DecisionEvidencePack, comparable: Set<DimensionKey>): KnownDecisionAttention[] {
  const top = pack.candidates[0];
  if (!top) return [];
  const attention: KnownDecisionAttention[] = (top.hardMismatches ?? []).map((item) => ({
    dimension: item.dimension,
    label: DIMENSION_LABELS[item.dimension],
    reason: item.reason,
    priorityRank: priorityRank(pack, item.dimension),
    kind: "hard_constraint" as const,
  }));
  const scoreGap = pack.candidates[1] && top.overallScore !== null && pack.candidates[1].overallScore !== null
    ? Math.abs(top.overallScore - pack.candidates[1].overallScore)
    : 0;
  for (const priority of pack.priorities) {
    const dimensions = getPriorityDimensions(priority.priority).filter((key) => (pack.intendedWeights?.[key] ?? pack.weights[key]) > 0);
    if (dimensions.length === 0 || dimensions.some((key) => comparable.has(key))) continue;
    const potentialWeight = dimensions.reduce((sum, key) => sum + (pack.intendedWeights?.[key] ?? pack.weights[key]), 0);
    if (potentialWeight <= scoreGap) continue;
    const dimension = dimensions[0];
    attention.push({
      dimension,
      label: DIMENSION_LABELS[dimension],
      reason: `${DIMENSION_LABELS[dimension]}是你的第${priority.rank}优先项，但候选间尚无可比证据；补充后可能影响当前排序。`,
      priorityRank: priority.rank as 1 | 2 | 3,
      kind: "material_uncertainty",
    });
  }
  return attention.sort((left, right) => (left.kind === "hard_constraint" ? -1 : 1) - (right.kind === "hard_constraint" ? -1 : 1) || (left.priorityRank ?? 99) - (right.priorityRank ?? 99)).slice(0, 2);
}

/** Closed-world projection used for normal AI synthesis. The full Evidence Pack remains canonical for audit and validation. */
export function buildKnownDecisionContext(pack: DecisionEvidencePack): KnownDecisionContext {
  const comparableDimensions = pack.effectiveComparableDimensions ?? pack.candidates[0]?.dimensionResults
    .filter((dimension) => dimension.finalWeight > 0 && pack.candidates.every((candidate) => candidate.dimensionResults.find((item) => item.key === dimension.key)?.score !== null))
    .map((dimension) => dimension.key) ?? [];
  const comparable = new Set(comparableDimensions);
  const intendedWeights = pack.intendedWeights ?? pack.weights;
  const effectiveWeights = pack.effectiveWeights ?? pack.weights;
  const top = pack.candidates[0];
  if (!top) throw new Error("Known Decision Context requires an authoritative Top1.");
  const candidateName = (id: string) => pack.candidates.find((candidate) => candidate.property.id === id)?.property.name ?? id;
  const decisiveKnownFactors = buildFactors(pack, comparable);
  const explainableDimensions = new Set(decisiveKnownFactors.map((factor) => factor.dimension));
  const usableTop3 = pack.priorities.flatMap((priority) => {
    if (pack.buyerContext.educationNeed === "none" && priority.priority === "education") return [];
    const dimensions = getPriorityDimensions(priority.priority).filter((key) => comparable.has(key) && explainableDimensions.has(key));
    return dimensions.length > 0 ? [{ priority: priority.priority, rank: priority.rank as 1 | 2 | 3, dimensions }] : [];
  });
  const topScore = top.overallScore;
  const alternativeScore = pack.candidates[1]?.overallScore ?? null;
  return {
    version: 1,
    buyer: {
      purchasePurpose: pack.buyerContext.purchasePurpose,
      maximumBudget: pack.buyerContext.maximumBudget,
      originalTop3: [...pack.buyerContext.topPriorities],
      usableTop3,
      educationNeed: pack.buyerContext.educationNeed,
    },
    ranking: [...pack.ranking],
    authoritativeTop1: {
      propertyId: top.property.id,
      propertyName: candidateName(top.property.id),
      score: top.overallScore,
      recommendation: top.recommendation,
    },
    intendedWeights: { ...intendedWeights },
    effectiveWeights: { ...effectiveWeights },
    effectiveComparableDimensions: [...comparableDimensions],
    candidates: pack.candidates.map((candidate) => ({
      propertyId: candidate.property.id,
      propertyName: candidate.property.name,
      rank: candidate.rank,
      overallScore: candidate.overallScore,
      recommendation: candidate.recommendation,
      propertyFacts: {
        expectedTransactionPrice: candidate.property.totalPrice,
        listingPrice: candidate.property.listingPrice ?? null,
        area: candidate.property.area,
        layout: candidate.property.layout,
        deliveryYear: candidate.property.deliveryYear ?? null,
        city: candidate.property.city,
        district: candidate.property.district,
      },
      comparableDimensions: candidate.dimensionResults.flatMap((dimension) =>
        comparable.has(dimension.key) && dimension.score !== null ? [{
          dimension: dimension.key,
          label: DIMENSION_LABELS[dimension.key],
          score: dimension.score,
          status: dimension.status as "known" | "partial",
          intendedWeight: intendedWeights[dimension.key],
          effectiveWeight: effectiveWeights[dimension.key],
          evidence: dimension.evidence.map((item) => ({ ...item })),
        }] : []),
      structuredSignals: candidate.decisionSignals.filter((signal) => signal.status === "available" && signal.role !== "contextual"),
      amapEvidence: usableAmapEvidence(candidate.amapEvidence),
      verifiedWebEvidence: [...candidate.scoreableWebEvidence, ...candidate.contextualVerifiedEvidence].filter((item) => item.status === "verified"),
      partialWebEvidence: candidate.contextualVerifiedEvidence.filter((item) => item.status === "partially_verified"),
    })),
    decisiveKnownFactors,
    attentionCandidates: buildAttention(pack, comparable),
    rankingIsClose: topScore !== null && alternativeScore !== null && Math.abs(topScore - alternativeScore) < 5,
  };
}
