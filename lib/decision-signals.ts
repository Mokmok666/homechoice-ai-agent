import type { DecisionSignal, DecisionSignalComparison, DecisionSignalComparisonRelation } from "@/types/decision-signals";
import type { DimensionKey } from "@/types/decision";
import type { NoiseExperienceLevel, Property, SubjectiveQualityLevel } from "@/types/property";
import type { PropertyWebEvidence, VerifiedEvidenceItem } from "@/lib/web-evidence/types";

const QUALITY_LABELS: Record<SubjectiveQualityLevel, string> = {
  very_poor: "很差", poor: "较差", average: "一般", good: "较好", very_good: "很好", unknown: "未判断",
};
const NOISE_LABELS: Record<NoiseExperienceLevel, string> = {
  severe: "严重", noticeable: "明显", occasional: "偶尔", low: "较少", minimal: "很少", unknown: "未判断",
};
const QUALITY_RANK: Record<SubjectiveQualityLevel, number | null> = { very_poor: 1, poor: 2, average: 3, good: 4, very_good: 5, unknown: null };
const NOISE_RANK: Record<NoiseExperienceLevel, number | null> = { severe: 1, noticeable: 2, occasional: 3, low: 4, minimal: 5, unknown: null };

interface SignalDefinition {
  key: keyof Property;
  signalKey: string;
  label: string;
  dimension: DimensionKey | null;
  scoringOwner: DimensionKey | null;
  kind: "numeric" | "quality" | "noise";
  unit?: string;
  webKey?: string;
  boundary: string;
}

const DEFINITIONS: readonly SignalDefinition[] = [
  { key: "propertyFee", signalKey: "property_fee", label: "物业费", dimension: null, scoringOwner: null, kind: "numeric", unit: "元/㎡/月", webKey: "property_fee", boundary: "这是持续持有成本事实，只能比较已记录费用高低，不能据此判断物业服务、房源品质或性价比。" },
  { key: "greenRatio", signalKey: "green_ratio", label: "绿化率", dimension: "community_quality", scoringOwner: null, kind: "numeric", unit: "%", webKey: "greening_ratio", boundary: "只能比较已记录绿化率高低，单一比例不能证明整体小区品质。" },
  { key: "parkingRatio", signalKey: "parking_ratio", label: "车位配比", dimension: "community_quality", scoringOwner: null, kind: "numeric", unit: "车位/户", boundary: "只能比较已记录停车供给，不能单独判断停车体验或小区品质。" },
  { key: "propertyManagementExperience", signalKey: "property_management_experience", label: "物业服务体验", dimension: "property_management", scoringOwner: "property_management", kind: "quality", boundary: "这是用户记录的主观体验，以有界方式计入物业服务维度；不是外部验证结论，也不能单独决定该维度。" },
  { key: "publicAreaMaintenance", signalKey: "public_area_maintenance", label: "公共区域维护", dimension: "community_quality", scoringOwner: "community_quality", kind: "quality", boundary: "这是用户记录的现场观察，以有界方式计入小区品质维度；外部与长期证据仍需单独确认。" },
  { key: "communityEnvironmentExperience", signalKey: "community_environment_experience", label: "小区环境体验", dimension: "community_quality", scoringOwner: "community_quality", kind: "quality", boundary: "这是用户记录的现场观察，以有界方式计入小区品质维度；外部与长期证据仍需单独确认。" },
  { key: "noiseExperience", signalKey: "noise_experience", label: "噪音体验", dimension: "community_quality", scoringOwner: "community_quality", kind: "noise", boundary: "这是用户记录的时点居住体验，以有界方式计入小区品质维度；不代表长期、全时段噪音结论。" },
  { key: "parkingExperience", signalKey: "parking_experience", label: "停车体验", dimension: null, scoringOwner: null, kind: "quality", boundary: "现有15维没有语义准确的停车维度，因此仅作用户观察背景，不参与确定性评分。" },
  { key: "maintenanceCondition", signalKey: "maintenance_condition", label: "整体维护状况", dimension: "community_quality", scoringOwner: "community_quality", kind: "quality", boundary: "这是用户记录的现场观察，以有界方式计入小区品质维度；不能单独证明长期整体品质。" },
] as const;

function verifiedItems(evidence: PropertyWebEvidence | undefined, key: string): VerifiedEvidenceItem[] {
  return evidence?.dimensions.flatMap((dimension) => dimension.verifiedEvidence ?? [])
    .filter((item) => item.key === key && item.status !== "insufficient") ?? [];
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quality(value: unknown): SubjectiveQualityLevel {
  return typeof value === "string" && value in QUALITY_LABELS ? value as SubjectiveQualityLevel : "unknown";
}

function noise(value: unknown): NoiseExperienceLevel {
  return typeof value === "string" && value in NOISE_LABELS ? value as NoiseExperienceLevel : "unknown";
}

export function normalizeStructuredObservation(value: SubjectiveQualityLevel | NoiseExperienceLevel | null | undefined): number | null {
  if (!value || value === "unknown") return null;
  if (value in QUALITY_RANK) {
    const rankValue = QUALITY_RANK[value as SubjectiveQualityLevel];
    return rankValue === null ? null : (rankValue - 1) / 4;
  }
  const rankValue = NOISE_RANK[value as NoiseExperienceLevel];
  return rankValue === null || rankValue === undefined ? null : (rankValue - 1) / 4;
}

export interface UserObservationScoreSummary {
  dimension: DimensionKey;
  knownCount: number;
  normalizedScore: number;
  observationWeight: 0.15 | 0.25;
  signals: Array<{ key: string; label: string; value: string; normalizedValue: number }>;
}

export interface UserObservationBlendResult extends UserObservationScoreSummary {
  baseScoreAvailable: boolean;
  baseScoreUsed: number;
  finalScore: number;
}

export function blendUserObservationScore(
  baseScore: number | null,
  summary: UserObservationScoreSummary,
): UserObservationBlendResult {
  const baseScoreAvailable = typeof baseScore === "number" && Number.isFinite(baseScore);
  const baseScoreUsed = baseScoreAvailable ? Math.min(100, Math.max(0, baseScore)) : 50;
  const finalScore = Math.round(
    baseScoreUsed * (1 - summary.observationWeight)
    + summary.normalizedScore * 100 * summary.observationWeight,
  );
  return { ...summary, baseScoreAvailable, baseScoreUsed, finalScore };
}

export function buildUserObservationScoreSummary(property: Property, dimension: DimensionKey): UserObservationScoreSummary | null {
  const signals = DEFINITIONS.flatMap((definition) => {
    if (definition.scoringOwner !== dimension || definition.kind === "numeric") return [];
    const raw = definition.kind === "noise" ? noise(property[definition.key]) : quality(property[definition.key]);
    const normalizedValue = normalizeStructuredObservation(raw);
    return normalizedValue === null ? [] : [{ key: definition.signalKey, label: definition.label, value: raw, normalizedValue }];
  });
  if (signals.length === 0) return null;
  return {
    dimension,
    knownCount: signals.length,
    normalizedScore: signals.reduce((sum, item) => sum + item.normalizedValue, 0) / signals.length,
    observationWeight: signals.length === 1 ? 0.15 : 0.25,
    signals,
  };
}

function conflict(value: number | null, external: VerifiedEvidenceItem[]): boolean {
  if (value === null) return false;
  return external.some((item) => typeof item.normalizedValue === "number" && Math.abs(item.normalizedValue - value) > 0.001);
}

export function buildPropertyDecisionSignals(property: Property, webEvidence?: PropertyWebEvidence): DecisionSignal[] {
  const signals = DEFINITIONS.map((definition): DecisionSignal => {
    const raw = property[definition.key];
    const external = definition.webKey ? verifiedItems(webEvidence, definition.webKey) : [];
    const objectiveValue = definition.kind === "numeric" ? numeric(raw) : null;
    const normalizedQuality = definition.kind === "quality" ? quality(raw) : null;
    const normalizedNoise = definition.kind === "noise" ? noise(raw) : null;
    const value = definition.kind === "numeric"
      ? objectiveValue
      : definition.kind === "quality" ? normalizedQuality : normalizedNoise;
    const unknown = value === null || value === "unknown";
    const hasConflict = definition.kind === "numeric" && conflict(objectiveValue, external);
    return {
      key: definition.signalKey,
      label: definition.label,
      dimension: definition.dimension,
      role: definition.scoringOwner ? "deterministic_scoring_input" : "supporting",
      scoringOwner: definition.scoringOwner,
      source: definition.kind === "numeric" ? "user_objective" : "user_reported",
      provenanceLabel: definition.kind === "numeric" ? "用户录入的客观房源事实" : "用户记录的主观观察",
      status: hasConflict ? "conflicting" : unknown ? "unknown" : "available",
      value,
      ...(!unknown && definition.kind !== "numeric" ? { normalizedValue: normalizeStructuredObservation(value as SubjectiveQualityLevel | NoiseExperienceLevel) ?? undefined } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      note: definition.boundary,
      ...(external.length ? { externalValues: external.map((item) => ({ value: item.normalizedValue ?? item.value, status: item.status, source: "web" as const })) } : {}),
    };
  });

  const legacyNotes: Array<[keyof Property, string, string, DimensionKey]> = [
    ["propertyExperience", "property_experience_note", "物业服务补充说明", "property_management"],
    ["environment", "community_environment_note", "小区环境补充说明", "community_quality"],
    ["noise", "noise_note", "噪音补充说明", "community_quality"],
    ["parking", "parking_note", "停车补充说明", "community_quality"],
    ["publicArea", "public_area_note", "公共区域补充说明", "community_quality"],
  ];
  for (const [field, key, label, dimension] of legacyNotes) {
    const value = typeof property[field] === "string" && property[field].trim() ? property[field].trim() : null;
    signals.push({
      key,
      label,
      dimension,
      role: "contextual",
      scoringOwner: null,
      source: "user_reported",
      provenanceLabel: "用户自由文本备注（未分类）",
      status: value ? "available" : "unknown",
      value,
      note: "自由文本仅提供背景，不自动推断为正面或负面，也不参与确定性评分。",
    });
  }
  return signals;
}

function rank(signal: DecisionSignal): number | null {
  if (signal.value === null || signal.value === "unknown") return null;
  if (signal.key === "noise_experience") return NOISE_RANK[signal.value as NoiseExperienceLevel];
  if (typeof signal.value === "string" && signal.value in QUALITY_RANK) return QUALITY_RANK[signal.value as SubjectiveQualityLevel];
  return null;
}

function relation(top: DecisionSignal, alternative: DecisionSignal): DecisionSignalComparisonRelation {
  if (top.status === "conflicting" || alternative.status === "conflicting") return "conflicting";
  if (top.status !== "available" || alternative.status !== "available") return "unknown";
  if (typeof top.value === "number" && typeof alternative.value === "number") {
    if (Math.abs(top.value - alternative.value) < 0.001) return "equal";
    return top.value > alternative.value ? "top_higher" : "top_lower";
  }
  const topRank = rank(top);
  const alternativeRank = rank(alternative);
  if (topRank === null || alternativeRank === null) return "unknown";
  if (topRank === alternativeRank) return "equal";
  return topRank > alternativeRank ? "top_stronger" : "top_weaker";
}

export function buildDecisionSignalComparisons(
  ordered: Array<{ propertyId: string; signals: DecisionSignal[] }>,
): DecisionSignalComparison[] {
  const top = ordered[0];
  if (!top) return [];
  return ordered.slice(1).flatMap((alternative) => DEFINITIONS.map((definition): DecisionSignalComparison => {
    const topSignal = top.signals.find((item) => item.key === definition.signalKey)!;
    const alternativeSignal = alternative.signals.find((item) => item.key === definition.signalKey)!;
    return {
      key: definition.signalKey,
      label: definition.label,
      dimension: definition.dimension,
      topCandidateId: top.propertyId,
      alternativeId: alternative.propertyId,
      topValue: topSignal.value,
      alternativeValue: alternativeSignal.value,
      relation: relation(topSignal, alternativeSignal),
      interpretationBoundary: definition.boundary,
    };
  }));
}

export { NOISE_LABELS, QUALITY_LABELS };
