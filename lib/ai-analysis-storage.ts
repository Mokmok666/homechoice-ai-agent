import { validateAIAnalysisResponse } from "@/lib/ai/validation";
import type { AIAnalysis } from "@/types/ai-analysis";

export const AI_ANALYSIS_STORAGE_KEY = "homechoice.ai-analysis.v1";

const SCHEMA_VERSION = 1;
const MAX_RECORDS = 25;

export interface StoredAIAnalysisRecord {
  propertyId: string;
  inputSignature: string;
  engineVersion: string;
  generatedAt: string;
  analysis: AIAnalysis;
}

interface AIAnalysisStorageEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  records: StoredAIAnalysisRecord[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRecord(value: unknown): value is StoredAIAnalysisRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredAIAnalysisRecord>;
  if (
    !isNonEmptyString(record.propertyId) ||
    !isNonEmptyString(record.inputSignature) ||
    !isNonEmptyString(record.engineVersion) ||
    !isNonEmptyString(record.generatedAt)
  ) {
    return false;
  }

  return validateAIAnalysisResponse({
    ok: true,
    analysis: record.analysis,
    metadata: {
      generatedAt: record.generatedAt,
      inputSignature: record.inputSignature,
      provider: "zhipu",
      model: "cached-analysis",
    },
  }, record.propertyId).success;
}

export function loadAIAnalysisRecords(): StoredAIAnalysisRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const storedValue = window.localStorage.getItem(AI_ANALYSIS_STORAGE_KEY);
    if (storedValue === null) return [];
    const envelope = JSON.parse(storedValue) as Partial<AIAnalysisStorageEnvelope>;
    if (envelope.schemaVersion !== SCHEMA_VERSION || !Array.isArray(envelope.records)) return [];
    return envelope.records.filter(isValidRecord);
  } catch {
    return [];
  }
}

export function findAIAnalysisBySignature(
  propertyId: string,
  inputSignature: string,
  engineVersion: string,
): StoredAIAnalysisRecord | null {
  return loadAIAnalysisRecords().find((record) =>
    record.propertyId === propertyId &&
    record.inputSignature === inputSignature &&
    record.engineVersion === engineVersion
  ) ?? null;
}

export function findLatestAIAnalysisForProperty(propertyId: string): StoredAIAnalysisRecord | null {
  return loadAIAnalysisRecords()
    .filter((record) => record.propertyId === propertyId)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0] ?? null;
}

export function saveAIAnalysisRecord(record: StoredAIAnalysisRecord): boolean {
  if (typeof window === "undefined" || !isValidRecord(record)) return false;

  try {
    const records = loadAIAnalysisRecords().filter((item) => !(
      item.propertyId === record.propertyId &&
      item.inputSignature === record.inputSignature &&
      item.engineVersion === record.engineVersion
    ));
    const envelope: AIAnalysisStorageEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      records: [...records, record]
        .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
        .slice(-MAX_RECORDS),
    };
    window.localStorage.setItem(AI_ANALYSIS_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}
