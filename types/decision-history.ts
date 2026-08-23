import type { BuyerPreferences } from "./buyer-preferences";
import type { DecisionEngineResult, DecisionReason } from "./decision";
import type { Property } from "./property";
import type { PropertyIntelligence } from "./property-intelligence";

export const DECISION_HISTORY_SCHEMA_VERSION = 1 as const;

export interface DecisionHistoryRecord {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly properties: readonly Property[];
  readonly preferences: BuyerPreferences;
  readonly decisionResult: DecisionEngineResult;
  readonly recommendedPropertyId: string | null;
  readonly aiOverallSummary: string | null;
  readonly decisionReasons?: readonly DecisionReason[];
  readonly propertyIntelligence?: readonly PropertyIntelligence[];
}

export type DecisionHistoryInput = Omit<DecisionHistoryRecord, "id" | "createdAt">;

export interface DecisionHistoryStorage {
  schemaVersion: typeof DECISION_HISTORY_SCHEMA_VERSION;
  records: DecisionHistoryRecord[];
}
