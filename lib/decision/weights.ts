import type { DecisionPriority, PurchasePurpose } from "../../types/buyer-preferences";
import { DIMENSION_KEYS, type DimensionKey } from "../../types/decision";
import { BASE_WEIGHTS } from "./dimensions";

const PRIORITY_DIMENSIONS: Record<DecisionPriority, DimensionKey[]> = {
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

const TOP_MULTIPLIERS = [1.6, 1.4, 1.2] as const;

function purposeMultiplier(purpose: PurchasePurpose, key: DimensionKey): number {
  if (purpose === "self_use") {
    if (["commute", "education", "layout_design", "space_match", "community_quality", "property_management"].includes(key)) return 1.1;
    if (["liquidity", "value_preservation"].includes(key)) return 0.95;
  }
  if (purpose === "long_term_asset") {
    if (["transaction_price_reasonableness", "liquidity", "value_preservation"].includes(key)) return 1.1;
    if (["layout_design", "space_match", "community_quality"].includes(key)) return 0.95;
  }
  return 1;
}

export function calculateWeights(
  purchasePurpose: PurchasePurpose,
  topPriorities: DecisionPriority[],
): Record<DimensionKey, number> {
  const raw = Object.fromEntries(DIMENSION_KEYS.map((key) => [
    key,
    BASE_WEIGHTS[key] * purposeMultiplier(purchasePurpose, key),
  ])) as Record<DimensionKey, number>;

  topPriorities.slice(0, 3).forEach((priority, index) => {
    for (const key of PRIORITY_DIMENSIONS[priority]) raw[key] *= TOP_MULTIPLIERS[index];
  });

  const total = DIMENSION_KEYS.reduce((sum, key) => sum + raw[key], 0);
  return Object.fromEntries(
    DIMENSION_KEYS.map((key) => [key, (raw[key] / total) * 100]),
  ) as Record<DimensionKey, number>;
}
