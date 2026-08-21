import {
  resolvePartnerCommutePreference,
  resolvePrimaryCommutePreference,
  type BuyerPreferences,
  type ResolvedCommutePreference,
} from "@/types/buyer-preferences";
import type {
  AMapRouteMode,
  CommuteGeoEvidence,
  CommuteModeResult,
  CommutePersonEvidence,
  GeoEvidenceQuality,
} from "@/types/geo-evidence";

export const FAMILY_COMMUTE_WEIGHTS = {
  primary: 0.6,
  partner: 0.4,
} as const;

export const FLEXIBLE_ROUTE_MODES: readonly AMapRouteMode[] = [
  "driving",
  "transit",
  "walking",
  "cycling",
];

export function routeModesForPreference(
  mode: ResolvedCommutePreference["mode"],
): AMapRouteMode[] {
  if (mode === "flexible") return [...FLEXIBLE_ROUTE_MODES];
  if (mode === "public_transit") return ["transit"];
  if (mode === "not_important") return [];
  return [mode];
}

export function selectCommuteModeResult(
  modeResults: Partial<Record<AMapRouteMode, CommuteModeResult>>,
  idealMinutes: number | null,
  maxMinutes: number | null,
): { mode: AMapRouteMode; result: CommuteModeResult } | null {
  const entries = Object.entries(modeResults)
    .filter((entry): entry is [AMapRouteMode, CommuteModeResult] => {
      const result = entry[1];
      return Boolean(result) && Number.isFinite(result.minutes) && result.minutes > 0;
    })
    .sort((left, right) => left[1].minutes - right[1].minutes || left[0].localeCompare(right[0]));
  if (entries.length === 0) return null;
  if (idealMinutes !== null) {
    const withinIdeal = entries.find(([, result]) => result.minutes <= idealMinutes);
    if (withinIdeal) return { mode: withinIdeal[0], result: withinIdeal[1] };
  }
  if (maxMinutes !== null) {
    const withinMaximum = entries.find(([, result]) => result.minutes <= maxMinutes);
    if (withinMaximum) return { mode: withinMaximum[0], result: withinMaximum[1] };
  }
  return { mode: entries[0][0], result: entries[0][1] };
}

function selectedPersonEvidence(
  evidence: CommutePersonEvidence | undefined,
  preference: ResolvedCommutePreference | null,
): CommutePersonEvidence | undefined {
  if (!evidence || !preference) return undefined;
  const selected = selectCommuteModeResult(
    evidence.modeResults,
    preference.idealMinutes,
    preference.maxMinutes,
  );
  return {
    ...evidence,
    ...(selected
      ? { selectedMode: selected.mode, selectedMinutes: selected.result.minutes }
      : { status: "unavailable" as const }),
  };
}

function lowerQuality(
  left: GeoEvidenceQuality | undefined,
  right: GeoEvidenceQuality | undefined,
): GeoEvidenceQuality {
  const rank: Record<GeoEvidenceQuality, number> = { low: 0, medium: 1, high: 2 };
  if (!left) return right ?? "low";
  if (!right) return left;
  return rank[left] <= rank[right] ? left : right;
}

export function buildCommuteGeoEvidence(
  preferences: BuyerPreferences,
  primaryEvidence?: CommutePersonEvidence,
  partnerEvidence?: CommutePersonEvidence,
): CommuteGeoEvidence | undefined {
  const primary = selectedPersonEvidence(primaryEvidence, resolvePrimaryCommutePreference(preferences));
  const partnerPreference = resolvePartnerCommutePreference(preferences);
  const partner = selectedPersonEvidence(partnerEvidence, partnerPreference);
  if (!primary && !partner) return undefined;
  const fetchedAt = [primary?.fetchedAt, partner?.fetchedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? new Date(0).toISOString();
  const quality = lowerQuality(primary?.quality, partner?.quality);
  const usablePrimary = primary?.selectedMinutes !== undefined;
  const usablePartner = partner?.selectedMinutes !== undefined;
  const status = quality === "low" || (!usablePrimary && !usablePartner)
    ? "insufficient"
    : (primary?.status === "partial" || partner?.status === "partial" || !usablePrimary || (partnerPreference !== null && !usablePartner))
      ? "partial"
      : "verified";
  const parts = [
    usablePrimary ? `你的参考通勤约 ${primary.selectedMinutes} 分钟` : "你的通勤路线暂不可用",
    partnerPreference ? (usablePartner ? `伴侣约 ${partner.selectedMinutes} 分钟` : "伴侣通勤路线暂不可用") : null,
  ].filter(Boolean);
  return {
    dimension: "commute",
    source: "amap",
    fetchedAt,
    status,
    quality,
    observation: parts.join("，"),
    ...(primary ? { primary } : {}),
    ...(partner ? { partner } : {}),
  };
}
