import { buildDecisionEvidencePack } from "@/lib/decision-evidence-pack";
import { projectAIAnalysisContext, type AIInputProjectorInput } from "@/lib/ai/input";
import { createAIInputSignature } from "@/lib/ai/signature";
import { buildKnownDecisionContext } from "@/lib/ai/known-decision-context";
import { AI_ANALYSIS_SCHEMA_VERSION, type AIAnalysisRequest } from "@/types/ai-analysis";

/** Builds the single authoritative request used by Results, cache identity and the API route. */
export function createAIAnalysisRequest(input: AIInputProjectorInput): AIAnalysisRequest {
  const context = projectAIAnalysisContext(input);
  const evidencePack = buildDecisionEvidencePack({
    properties: input.properties,
    preferences: input.preferences,
    engine: input.engine,
    geoEvidenceByProperty: input.geoEvidenceByProperty,
    webEvidenceByProperty: input.webEvidenceByProperty,
    createdAt: `${input.engine.asOfDate}T00:00:00.000Z`,
  });
  const knownDecisionContext = buildKnownDecisionContext(evidencePack);
  const effectivePriorities = knownDecisionContext.buyer.usableTop3.map((item) => item.priority);
  return {
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    locale: "zh-CN",
    inputSignature: createAIInputSignature(context, evidencePack, effectivePriorities, knownDecisionContext),
    context,
    evidencePack,
    knownDecisionContext,
    effectivePriorities,
  };
}
