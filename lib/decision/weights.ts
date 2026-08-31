import type { DecisionPriority, PurchasePurpose } from "../../types/buyer-preferences";
import { DIMENSION_KEYS, type DimensionKey } from "../../types/decision";

export const PRIORITY_DIMENSIONS: Readonly<Record<DecisionPriority, readonly DimensionKey[]>> = {
  commute: ["commute"],
  price: ["budget_match", "transaction_price_reasonableness"],
  layout_and_space: ["layout_design", "space_match"],
  community_quality: ["community_quality"],
  property_management: ["property_management"],
  education: ["education"],
  commercial_amenities: ["commercial_amenities"],
  medical_amenities: ["medical_amenities"],
  public_transport: ["public_transport"],
  liquidity: ["liquidity"],
  value_preservation: ["value_preservation"],
};

export function getPriorityDimensions(priority: DecisionPriority): readonly DimensionKey[] {
  return PRIORITY_DIMENSIONS[priority];
}

export const SELF_USE_BASE_PRIORS: Readonly<Record<DimensionKey, number>> = {
  location_maturity: 6,
  commute: 9,
  public_transport: 5,
  commercial_amenities: 6,
  education: 5,
  medical_amenities: 4,
  layout_design: 9,
  space_match: 8,
  building_age: 5,
  community_quality: 8,
  property_management: 6,
  budget_match: 10,
  transaction_price_reasonableness: 7,
  liquidity: 5,
  value_preservation: 7,
};

export const INVESTMENT_BASE_PRIORS: Readonly<Record<DimensionKey, number>> = {
  location_maturity: 10,
  commute: 6,
  public_transport: 6,
  commercial_amenities: 6,
  education: 3,
  medical_amenities: 2,
  layout_design: 5,
  space_match: 4,
  building_age: 5,
  community_quality: 5,
  property_management: 4,
  budget_match: 10,
  transaction_price_reasonableness: 12,
  liquidity: 10,
  value_preservation: 12,
};

export const TOP_PRIORITY_GROUP_SHARES = [18, 14, 11] as const;

function basePriors(purpose: PurchasePurpose): Readonly<Record<DimensionKey, number>> {
  return purpose === "long_term_asset" ? INVESTMENT_BASE_PRIORS : SELF_USE_BASE_PRIORS;
}

export function calculateWeights(
  purchasePurpose: PurchasePurpose,
  topPriorities: DecisionPriority[],
  educationNeed: "none" | "current" | "future" = "current",
): Record<DimensionKey, number> {
  const priors = basePriors(purchasePurpose);
  const disabled = new Set<DimensionKey>(educationNeed === "none" ? ["education"] : []);
  const assigned = new Map<DimensionKey, number>();

  topPriorities.slice(0, 3).forEach((priority, index) => {
    const group = PRIORITY_DIMENSIONS[priority].filter((key) => !disabled.has(key));
    if (group.length === 0) return;
    const groupPrior = group.reduce((sum, key) => sum + priors[key], 0);
    for (const key of group) assigned.set(key, TOP_PRIORITY_GROUP_SHARES[index] * priors[key] / groupPrior);
  });

  const unassigned = DIMENSION_KEYS.filter((key) => !disabled.has(key) && !assigned.has(key));
  const remainingShare = 100 - [...assigned.values()].reduce((sum, value) => sum + value, 0);
  const remainingPrior = unassigned.reduce((sum, key) => sum + priors[key], 0);
  const weights = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    if (disabled.has(key)) return [key, 0];
    const selectedShare = assigned.get(key);
    return [key, selectedShare ?? (remainingPrior === 0 ? 0 : remainingShare * priors[key] / remainingPrior)];
  })) as Record<DimensionKey, number>;

  // Eliminate floating-point drift while preserving the deterministic allocation.
  const total = DIMENSION_KEYS.reduce((sum, key) => sum + weights[key], 0);
  if (total > 0) for (const key of DIMENSION_KEYS) weights[key] = weights[key] * 100 / total;
  return weights;
}

export function calculateEffectiveWeights(
  intendedWeights: Readonly<Record<DimensionKey, number>>,
  comparableDimensions: readonly DimensionKey[],
): Record<DimensionKey, number> {
  const comparable = new Set(comparableDimensions);
  const total = DIMENSION_KEYS.reduce((sum, key) => sum + (comparable.has(key) ? intendedWeights[key] : 0), 0);
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [
    key,
    comparable.has(key) && total > 0 ? intendedWeights[key] * 100 / total : 0,
  ])) as Record<DimensionKey, number>;
}
