import {
  COMMUTE_MODES,
  DECISION_PRIORITIES,
  EDUCATION_NEEDS,
  PURCHASE_PURPOSES,
} from "@/types/buyer-preferences";
import type {
  PropertyIntelligence,
  PropertyIntelligenceRequest,
} from "@/types/property-intelligence";

export type PropertyIntelligenceValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function validatePropertyIntelligenceRequest(
  value: unknown,
): PropertyIntelligenceValidationResult<PropertyIntelligenceRequest> {
  const errors: string[] = [];
  if (!isRecord(value) || !hasExactKeys(value, ["property", "preferences"])) {
    return { success: false, errors: ["request structure is invalid"] };
  }

  const property = value.property;
  if (!isRecord(property) || !hasExactKeys(property, [
    "id", "name", "city", "district", "address", "totalPrice", "listingPrice",
    "area", "layout", "floor", "metroDistance", "schoolInformation",
    "propertyManagementInformation", "deliveryYear", "orientation",
  ])) {
    errors.push("property structure is invalid");
  } else if (
    !isNonEmptyString(property.id) ||
    !isNonEmptyString(property.name) ||
    !isNonEmptyString(property.city) ||
    !isNonEmptyString(property.district) ||
    !isNonEmptyString(property.address) ||
    typeof property.totalPrice !== "number" || !Number.isFinite(property.totalPrice) || property.totalPrice <= 0 ||
    !isNullableFiniteNumber(property.listingPrice) ||
    typeof property.area !== "number" || !Number.isFinite(property.area) || property.area <= 0 ||
    !isNonEmptyString(property.layout) ||
    !isNonEmptyString(property.floor) ||
    !isNullableFiniteNumber(property.metroDistance) ||
    !isNullableString(property.schoolInformation) ||
    !isNullableString(property.propertyManagementInformation) ||
    !isNullableFiniteNumber(property.deliveryYear) ||
    !isNullableString(property.orientation)
  ) {
    errors.push("property fields are invalid");
  }

  const preferences = value.preferences;
  if (!isRecord(preferences) || !hasExactKeys(preferences, [
    "purchasePurpose", "maximumBudget", "commuteMode", "primaryWorkLocation",
    "educationNeed", "topPriorities",
  ])) {
    errors.push("preferences structure is invalid");
  } else if (
    !isOneOf(preferences.purchasePurpose, PURCHASE_PURPOSES) ||
    typeof preferences.maximumBudget !== "number" || !Number.isFinite(preferences.maximumBudget) || preferences.maximumBudget <= 0 ||
    !isOneOf(preferences.commuteMode, COMMUTE_MODES) ||
    !isNullableString(preferences.primaryWorkLocation) ||
    !isOneOf(preferences.educationNeed, EDUCATION_NEEDS) ||
    !Array.isArray(preferences.topPriorities) ||
    preferences.topPriorities.length !== 3 ||
    !preferences.topPriorities.every((priority) => isOneOf(priority, DECISION_PRIORITIES)) ||
    new Set(preferences.topPriorities).size !== preferences.topPriorities.length
  ) {
    errors.push("preferences fields are invalid");
  }

  return errors.length === 0
    ? { success: true, data: value as unknown as PropertyIntelligenceRequest }
    : { success: false, errors };
}

export function validatePropertyIntelligence(
  value: unknown,
): PropertyIntelligenceValidationResult<PropertyIntelligence> {
  const errors: string[] = [];
  if (!isRecord(value) || !hasExactKeys(value, [
    "propertyId", "generatedAt", "analysisConfidence", "locationProfile",
    "industry", "lifestyle", "assetValue", "risks",
  ])) {
    return { success: false, errors: ["intelligence structure is invalid"] };
  }

  if (!isNonEmptyString(value.propertyId)) errors.push("propertyId is required");
  if (!isNonEmptyString(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))) {
    errors.push("generatedAt must be a valid date");
  }
  if (
    typeof value.analysisConfidence !== "number" ||
    !Number.isFinite(value.analysisConfidence) ||
    value.analysisConfidence < 0 ||
    value.analysisConfidence > 100
  ) errors.push("analysisConfidence must be between 0 and 100");

  const location = value.locationProfile;
  if (!isRecord(location) || !hasExactKeys(location, ["cityLevel", "districtPosition", "developmentStage"]) ||
    !isNonEmptyString(location.cityLevel) || !isNonEmptyString(location.districtPosition) || !isNonEmptyString(location.developmentStage)) {
    errors.push("locationProfile is invalid");
  }
  const industry = value.industry;
  if (!isRecord(industry) || !hasExactKeys(industry, ["industries", "employmentOpportunity"]) ||
    !isStringArray(industry.industries) || !isNonEmptyString(industry.employmentOpportunity)) {
    errors.push("industry is invalid");
  }
  const lifestyle = value.lifestyle;
  if (!isRecord(lifestyle) || !hasExactKeys(lifestyle, ["commercialMaturity", "transportation", "dailyConvenience", "communityQuality"]) ||
    !isNonEmptyString(lifestyle.commercialMaturity) || !isNonEmptyString(lifestyle.transportation) ||
    !isNonEmptyString(lifestyle.dailyConvenience) || !isNonEmptyString(lifestyle.communityQuality)) {
    errors.push("lifestyle is invalid");
  }
  const assetValue = value.assetValue;
  if (!isRecord(assetValue) || !hasExactKeys(assetValue, ["liquidity", "preservationPotential"]) ||
    !isNonEmptyString(assetValue.liquidity) || !isNonEmptyString(assetValue.preservationPotential)) {
    errors.push("assetValue is invalid");
  }
  const risks = value.risks;
  if (!isRecord(risks) || !hasExactKeys(risks, ["risks", "verificationPoints"]) ||
    !isStringArray(risks.risks) || !isStringArray(risks.verificationPoints)) {
    errors.push("risks is invalid");
  }

  return errors.length === 0
    ? { success: true, data: value as unknown as PropertyIntelligence }
    : { success: false, errors };
}
