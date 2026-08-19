import type { BuyerPreferences } from "./buyer-preferences";
import type { DecisionEngineResult } from "./decision";
import type { Property } from "./property";

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
}

export type DecisionHistoryInput = Omit<DecisionHistoryRecord, "id" | "createdAt">;

export interface DecisionHistoryStorage {
  schemaVersion: typeof DECISION_HISTORY_SCHEMA_VERSION;
  records: DecisionHistoryRecord[];
}
