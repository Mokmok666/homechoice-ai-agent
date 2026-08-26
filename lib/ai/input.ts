import { createDecisionPropertyView, validateTextField } from "../decision/dataQuality";
import { DIMENSION_LABELS } from "../decision/dimensions";
import { resolvePartnerCommutePreference, resolvePrimaryCommutePreference } from "../../types/buyer-preferences";
import type {
  AIAnalysisContext,
  AIBuyerPreferencesContext,
  AICandidateDecisionContext,
  AICommutePersonContext,
  AIDecisionContext,
  AIGeoEvidenceContext,
  AIWebEvidenceContext,
  AIPropertyContext,
} from "../../types/ai-analysis";
import type { BuyerPreferences, ResolvedCommutePreference } from "../../types/buyer-preferences";
import type { DecisionEngineResult, PropertyDecisionResult } from "../../types/decision";
import type { CommutePersonEvidence, GeoEvidenceByProperty, PropertyGeoEvidence } from "../../types/geo-evidence";
import type { Property } from "../../types/property";
import type { WebEvidenceByProperty } from "../web-evidence/types";

export interface AIInputProjectorInput {
  properties: Property[];
  preferences: BuyerPreferences;
  engine: DecisionEngineResult;
  geoEvidenceByProperty?: GeoEvidenceByProperty;
  webEvidenceByProperty?: WebEvidenceByProperty;
}

function safeText(value: string | null | undefined): string | null {
  return validateTextField(value).status === "valid" ? value!.trim() : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectProperty(property: Property, maximumBudget: number): AIPropertyContext {
  const safeProperty = createDecisionPropertyView(property);
  return {
    propertyId: property.id,
    name: safeText(property.name),
    location: {
      city: safeText(safeProperty.city),
      district: safeText(safeProperty.district),
      address: safeText(safeProperty.address),
      confirmedLocationName: safeText(property.confirmedLocation?.name),
    },
    expectedTransactionPrice: property.totalPrice,
    listingPrice: finiteOrNull(property.listingPrice),
    budgetDifference: maximumBudget - property.totalPrice,
    area: property.area,
    layout: safeText(safeProperty.layout),
    floor: safeText(property.floor),
    orientation: property.orientation === "other" ? safeText(property.customOrientation) : property.orientation ?? null,
    deliveryYear: finiteOrNull(property.deliveryYear),
    schoolInformation: safeText(safeProperty.schoolInformation),
    propertyManagementInformation: safeText(safeProperty.propertyManagementInformation),
    supplementalInformation: {
      propertyCompany: safeText(property.propertyCompany),
      propertyFee: finiteOrNull(property.propertyFee),
      propertyExperience: safeText(property.propertyExperience),
      environment: safeText(property.environment),
      noise: safeText(property.noise),
      parking: safeText(property.parking),
      publicArea: safeText(property.publicArea),
      actualCommuteExperience: safeText(property.actualCommuteExperience),
      recentDealPrice: finiteOrNull(property.recentDealPrice),
    },
    comparableTransactions: (safeProperty.comparableTransactions ?? [])
      .filter((item) => item.confirmed && item.price > 0 && item.area > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.transactionDate) && safeText(item.source))
      .map((item) => ({ price: item.price, area: item.area, transactionDate: item.transactionDate, source: item.source.trim() })),
  };
}

function workplaceContext(preference: ResolvedCommutePreference) {
  return {
    label: safeText(preference.confirmedLocation?.name ?? preference.workLocation),
    confirmed: preference.confirmedLocation?.confirmedByUser === true,
    commuteMode: preference.mode,
    idealCommuteMinutes: finiteOrNull(preference.idealMinutes),
    maxCommuteMinutes: finiteOrNull(preference.maxMinutes),
  };
}

function projectPreferences(preferences: BuyerPreferences): AIBuyerPreferencesContext {
  const primary = resolvePrimaryCommutePreference(preferences);
  const partner = resolvePartnerCommutePreference(preferences);
  return {
    purchasePurpose: preferences.purchasePurpose,
    maximumBudget: preferences.maximumBudget,
    primaryWorkplace: workplaceContext(primary),
    partnerWorkplace: partner ? workplaceContext(partner) : null,
    educationNeed: preferences.educationNeed,
    educationStages: [...preferences.educationStages],
    topPriorities: [...preferences.topPriorities],
  };
}

function projectDecision(result: PropertyDecisionResult, propertyName: string | null, rank: number): AIDecisionContext {
  return {
    rank,
    propertyId: result.propertyId,
    propertyName,
    matchScore: finiteOrNull(result.overallScore),
    recommendation: result.recommendation,
    provisional: result.provisional,
    analysisConfidence: result.confidence.analysisConfidence,
    dataCompletenessPercent: result.confidence.dataCompletenessPercent,
    reasons: result.reasons.filter((item) => safeText(item) !== null),
    decisionFactors: result.decisionFactors.filter((item) => safeText(item) !== null),
    hardMismatches: result.hardMismatches
      .filter((item) => safeText(item.reason) !== null)
      .map((item) => ({ dimension: item.dimension, reason: item.reason.trim() })),
    dimensions: result.dimensions.map((dimension) => ({
      key: dimension.key,
      label: DIMENSION_LABELS[dimension.key],
      score: finiteOrNull(dimension.score),
      status: dimension.status,
      finalWeight: dimension.finalWeight,
      evidence: dimension.evidence
        .filter((item) => safeText(item.description) !== null)
        .map((item) => ({ source: item.source, quality: item.quality, description: item.description.trim() })),
      missingInputs: dimension.missingInputs.map(safeText).filter((item): item is string => item !== null),
    })),
    excludedInputFields: [...result.confidence.invalidInputFields],
  };
}

function projectPersonCommute(evidence: CommutePersonEvidence | undefined, preference: ResolvedCommutePreference | null): AICommutePersonContext | null {
  if (!evidence || !preference) return null;
  return {
    destinationLabel: evidence.destinationLabel,
    requestedMode: evidence.requestedMode,
    modeResults: Object.fromEntries(Object.entries(evidence.modeResults).map(([mode, result]) => [mode, { ...result! }])),
    selectedMode: evidence.selectedMode ?? null,
    selectedMinutes: finiteOrNull(evidence.selectedMinutes),
    idealCommuteMinutes: finiteOrNull(preference.idealMinutes),
    maxCommuteMinutes: finiteOrNull(preference.maxMinutes),
    status: evidence.status,
  };
}

function projectGeoEvidence(
  evidence: PropertyGeoEvidence | undefined,
  result: PropertyDecisionResult,
  preferences: BuyerPreferences,
): AIGeoEvidenceContext | null {
  if (!evidence || Object.keys(evidence).length === 0) return null;
  const items = Object.values(evidence).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const quality = items.some((item) => item.quality === "low") ? "low" : items.some((item) => item.quality === "medium") ? "medium" : "high";
  const status = items.some((item) => item.status === "insufficient") ? "insufficient" : items.some((item) => item.status === "partial") ? "partial" : "verified";
  const commuteDimension = result.dimensions.find((item) => item.key === "commute");
  const primaryPreference = resolvePrimaryCommutePreference(preferences);
  const partnerPreference = resolvePartnerCommutePreference(preferences);
  return {
    source: "amap",
    quality,
    status,
    publicTransport: evidence.public_transport ? {
      nearestStationName: evidence.public_transport.nearestStationName ?? null,
      nearestDistanceMeters: finiteOrNull(evidence.public_transport.nearestDistanceMeters),
      stationCountWithin1000m: finiteOrNull(evidence.public_transport.stationCountWithin1000m),
      busEvidenceAvailable: evidence.public_transport.busEvidenceAvailable === true,
      nearestBusStopName: evidence.public_transport.nearestBusStopName ?? null,
      nearestBusStopDistanceMeters: finiteOrNull(evidence.public_transport.nearestBusStopDistanceMeters),
      busStopCountWithin500m: finiteOrNull(evidence.public_transport.busStopCountWithin500m),
      busStopCountWithin800m: finiteOrNull(evidence.public_transport.busStopCountWithin800m),
    } : null,
    commercial: evidence.commercial_amenities ? {
      countWithin2000m: evidence.commercial_amenities.countWithin2000m,
      nearestDistanceMeters: finiteOrNull(evidence.commercial_amenities.nearestDistanceMeters),
      nearestName: evidence.commercial_amenities.nearestName ?? null,
      examples: [...evidence.commercial_amenities.examples],
    } : null,
    medical: evidence.medical_amenities ? {
      hospitalCountWithin3000m: evidence.medical_amenities.hospitalCountWithin3000m,
      nearestDistanceMeters: finiteOrNull(evidence.medical_amenities.nearestDistanceMeters),
      nearestName: evidence.medical_amenities.nearestName ?? null,
      examples: [...evidence.medical_amenities.examples],
    } : null,
    commute: evidence.commute ? {
      primary: projectPersonCommute(evidence.commute.primary, primaryPreference),
      partner: projectPersonCommute(evidence.commute.partner, partnerPreference),
      familyCommuteScore: finiteOrNull(commuteDimension?.score),
      observation: evidence.commute.observation,
    } : null,
  };
}

function projectWebEvidence(evidence: WebEvidenceByProperty[string] | undefined): AIWebEvidenceContext | null {
  if (!evidence) return null;
  const dimensions = evidence.dimensions.map((dimension) => ({
    dimensionKey: dimension.dimensionKey,
    status: dimension.status,
    summary: safeText(dimension.summary),
    interpretationConclusion: safeText(dimension.interpretation?.conclusion),
    supportingFacts: dimension.interpretation?.supportingFacts.flatMap((fact) => safeText(fact) ? [safeText(fact)!] : []).slice(0, 3) ?? [],
    facts: dimension.facts.flatMap((fact) => {
      const claim = safeText(fact.claim);
      const sourceTitle = safeText(fact.sourceTitle);
      if (!claim || !sourceTitle) return [];
      return [{
        claim,
        sourceTitle,
        sourceDomain: safeText(fact.sourceDomain),
        confidence: fact.confidence,
        transactionKind: fact.transactionKind ?? null,
      }];
    }).slice(0, 4),
  }));
  return { fetchedAt: evidence.fetchedAt, dimensions };
}

/** Projects the complete authoritative comparison into an AI-safe allowlist. */
export function projectAIAnalysisContext(input: AIInputProjectorInput): AIAnalysisContext {
  const propertyById = new Map(input.properties.map((property) => [property.id, property]));
  const candidates: AICandidateDecisionContext[] = input.engine.results.map((result, index) => {
    const property = propertyById.get(result.propertyId);
    if (!property) throw new Error(`DecisionResult property ${result.propertyId} is missing.`);
    const projectedProperty = projectProperty(property, input.preferences.maximumBudget);
    return {
      property: projectedProperty,
      decision: projectDecision(result, projectedProperty.name, index + 1),
      geoEvidence: projectGeoEvidence(input.geoEvidenceByProperty?.[property.id], result, input.preferences),
      webEvidence: projectWebEvidence(input.webEvidenceByProperty?.[property.id]),
    };
  });
  if (candidates.length === 0 || input.engine.ranking[0] !== candidates[0].property.propertyId) {
    throw new Error("Decision Engine ranking and result order are inconsistent.");
  }
  return {
    asOfDate: input.engine.asOfDate,
    decisionVersion: input.engine.engineVersion,
    authoritativeTopPropertyId: input.engine.ranking[0],
    ranking: [...input.engine.ranking],
    rankingProvisional: input.engine.rankingProvisional,
    preferences: projectPreferences(input.preferences),
    candidates,
  };
}
