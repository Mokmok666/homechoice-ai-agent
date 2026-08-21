import type { AIAnalysisContext } from "../../types/ai-analysis";

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

export function stableSerializeAIInput(value: unknown): string {
  return canonicalize(value);
}

/** Stable cache identity, not a cryptographic or authentication primitive. */
export function createAIInputSignature(context: AIAnalysisContext): string {
  const serialized = stableSerializeAIInput(context);
  return `aia-v2-${fnv1a32(serialized, 0x811c9dc5)}${fnv1a32(serialized, 0x9e3779b9)}`;
}
