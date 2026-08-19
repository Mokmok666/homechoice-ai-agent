import { DECISION_HISTORY_SCHEMA_VERSION } from "@/types/decision-history";
import type {
  DecisionHistoryInput,
  DecisionHistoryRecord,
  DecisionHistoryStorage,
} from "@/types/decision-history";
import type { Recommendation } from "@/types/decision";
import { validatePropertyIntelligence } from "@/lib/ai/property-intelligence-validation";

export const DECISION_HISTORY_STORAGE_KEY = "homechoice.decision-history.v1";

const MAX_HISTORY_RECORDS = 30;
const RECOMMENDATIONS = new Set<Recommendation>(["CONSIDER", "WAIT", "PASS"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isValidHistoryRecord(value: unknown): value is DecisionHistoryRecord {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.properties) ||
    value.properties.length === 0 ||
    !isRecord(value.preferences) ||
    !isRecord(value.decisionResult) ||
    !(typeof value.recommendedPropertyId === "string" || value.recommendedPropertyId === null) ||
    !(typeof value.aiOverallSummary === "string" || value.aiOverallSummary === null)
  ) {
    return false;
  }

  const propertiesAreValid = value.properties.every((property) =>
    isRecord(property) &&
    typeof property.id === "string" &&
    typeof property.name === "string" &&
    typeof property.city === "string" &&
    typeof property.district === "string" &&
    typeof property.totalPrice === "number" &&
    typeof property.area === "number" &&
    typeof property.layout === "string"
  );
  if (!propertiesAreValid) return false;

  if (
    value.propertyIntelligence !== undefined &&
    (!Array.isArray(value.propertyIntelligence) ||
      !value.propertyIntelligence.every(
        (intelligence) => validatePropertyIntelligence(intelligence).success,
      ))
  ) {
    return false;
  }

  const engine = value.decisionResult;
  if (
    typeof engine.engineVersion !== "string" ||
    typeof engine.asOfDate !== "string" ||
    !Array.isArray(engine.results) ||
    !Array.isArray(engine.ranking)
  ) {
    return false;
  }

  return engine.results.every((result) => {
    if (!isRecord(result) || !isRecord(result.confidence)) return false;
    return (
      typeof result.propertyId === "string" &&
      isFiniteNumberOrNull(result.overallScore) &&
      typeof result.recommendation === "string" &&
      RECOMMENDATIONS.has(result.recommendation as Recommendation) &&
      Array.isArray(result.reasons) &&
      result.reasons.every((reason) => typeof reason === "string") &&
      typeof result.confidence.dataCompletenessPercent === "number"
    );
  });
}

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createHistoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getDecisionHistory(): DecisionHistoryRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const storedValue = window.localStorage.getItem(DECISION_HISTORY_STORAGE_KEY);
    if (storedValue === null) return [];
    const envelope = JSON.parse(storedValue) as Partial<DecisionHistoryStorage>;
    if (
      envelope.schemaVersion !== DECISION_HISTORY_SCHEMA_VERSION ||
      !Array.isArray(envelope.records)
    ) {
      return [];
    }
    return envelope.records
      .filter(isValidHistoryRecord)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

export function getDecisionHistoryById(id: string): DecisionHistoryRecord | null {
  return getDecisionHistory().find((record) => record.id === id) ?? null;
}

export function saveDecisionHistory(input: DecisionHistoryInput): DecisionHistoryRecord {
  if (typeof window === "undefined") throw new Error("决策记录只能在浏览器中保存。");

  const record = cloneSnapshot<DecisionHistoryRecord>({
    ...input,
    id: createHistoryId(),
    createdAt: new Date().toISOString(),
  });
  if (!isValidHistoryRecord(record)) throw new Error("当前分析快照不完整，暂时无法保存。");

  const envelope: DecisionHistoryStorage = {
    schemaVersion: DECISION_HISTORY_SCHEMA_VERSION,
    records: [record, ...getDecisionHistory()].slice(0, MAX_HISTORY_RECORDS),
  };
  window.localStorage.setItem(DECISION_HISTORY_STORAGE_KEY, JSON.stringify(envelope));
  return cloneSnapshot(record);
}

export function deleteDecisionHistory(id: string): DecisionHistoryRecord[] {
  if (typeof window === "undefined") return [];

  const records = getDecisionHistory().filter((record) => record.id !== id);
  const envelope: DecisionHistoryStorage = {
    schemaVersion: DECISION_HISTORY_SCHEMA_VERSION,
    records,
  };
  window.localStorage.setItem(DECISION_HISTORY_STORAGE_KEY, JSON.stringify(envelope));
  return records;
}
