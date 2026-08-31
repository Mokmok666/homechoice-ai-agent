import type { AIAnalysisContext } from "../../types/ai-analysis";
import type { DecisionPriority } from "../../types/buyer-preferences";
import type { DecisionEvidencePack } from "../../types/decision-evidence-pack";
import type { KnownDecisionContext } from "../../types/known-decision-context";

function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AI signature input must contain finite numbers.");
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new Error(`Unsupported AI signature value: ${typeof value}`);
}

function fnv1a32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const VOLATILE_SIGNATURE_KEYS = new Set(["createdAt", "updatedAt", "fetchedAt", "retrievedAt", "confirmedAt", "generatedAt", "imageUrl"]);

function decisionRelevantSignatureValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decisionRelevantSignatureValue);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const isProperty = typeof source.id === "string" && typeof source.name === "string" && typeof source.totalPrice === "number" && typeof source.area === "number";
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !VOLATILE_SIGNATURE_KEYS.has(key) && !(isProperty && key === "status"))
    .map(([key, child]) => [key, decisionRelevantSignatureValue(child)]));
}

export function stableSerializeAIInput(value: unknown): string {
  return canonicalize(value);
}

/** Stable cache identity, not a cryptographic or authentication primitive. */
export function createAIInputSignature(
  context: AIAnalysisContext,
  evidencePack?: DecisionEvidencePack,
  effectivePriorities?: DecisionPriority[],
  knownDecisionContext?: KnownDecisionContext,
): string {
  const serialized = stableSerializeAIInput(decisionRelevantSignatureValue(evidencePack
    ? { context, evidencePack, effectivePriorities: effectivePriorities ?? [], knownDecisionContext }
    : context));
  return `aia-v26-${fnv1a32(serialized, 0x811c9dc5)}${fnv1a32(serialized, 0x9e3779b9)}`;
}
