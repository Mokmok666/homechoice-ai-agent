"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findAIAnalysisBySignature, findLatestAIAnalysisForProperty, saveAIAnalysisRecord } from "@/lib/ai-analysis-storage";
import { requestAIAnalysis } from "@/lib/ai/client";
import { projectAIAnalysisContext } from "@/lib/ai/input";
import { createAIInputSignature } from "@/lib/ai/signature";
import { RECOMMENDATION_BADGE_STYLES, RECOMMENDATION_LABELS } from "@/lib/recommendation-presentation";
import { AI_ANALYSIS_SCHEMA_VERSION, type AIAnalysis, type AIAnalysisRequest } from "@/types/ai-analysis";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { DecisionPriority } from "@/types/buyer-preferences";
import type { DecisionEngineResult } from "@/types/decision";
import type { GeoEvidenceByProperty } from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import type { WebEvidenceByProperty } from "@/lib/web-evidence/types";

interface AIAnalysisPanelProps {
  properties: Property[];
  preferences: BuyerPreferences;
  engine: DecisionEngineResult;
  geoEvidenceByProperty: GeoEvidenceByProperty;
  webEvidenceByProperty: WebEvidenceByProperty;
}

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "cached"; analysis: AIAnalysis }
  | { status: "stale" }
  | { status: "success"; analysis: AIAnalysis; warning?: string }
  | { status: "error"; message: string };

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  commute: "通勤",
  price: "预算与价格",
  layout_and_space: "户型与空间",
  community_quality: "小区品质",
  property_management: "物业服务",
  education: "教育需求",
  commercial_amenities: "商业生活",
  public_transport: "公共交通",
  liquidity: "流动性",
  value_preservation: "长期价值",
};

function buildRequest(
  properties: Property[],
  preferences: BuyerPreferences,
  engine: DecisionEngineResult,
  geoEvidenceByProperty: GeoEvidenceByProperty,
  webEvidenceByProperty: WebEvidenceByProperty,
): AIAnalysisRequest | null {
  if (engine.ranking.length === 0) return null;
  const context = projectAIAnalysisContext({ properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty });
  return {
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    locale: "zh-CN",
    inputSignature: createAIInputSignature(context),
    context,
  };
}

export function AIAnalysisPanel({ properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty }: AIAnalysisPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const abortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const generationRef = useRef(0);
  const request = useMemo(
    () => buildRequest(properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty),
    [properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty],
  );
  const topPropertyId = request?.context.authoritativeTopPropertyId ?? null;
  const topCandidate = request?.context.candidates[0] ?? null;
  const requestIdentity = request?.inputSignature ?? "none";

  useEffect(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isGeneratingRef.current = false;
    if (!request || !topPropertyId) { setState({ status: "idle" }); return; }
    const cached = findAIAnalysisBySignature(topPropertyId, request.inputSignature, engine.engineVersion);
    if (cached) { setState({ status: "cached", analysis: cached.analysis }); return; }
    const previous = findLatestAIAnalysisForProperty(topPropertyId);
    setState(previous ? { status: "stale" } : { status: "idle" });
  }, [engine.engineVersion, request, requestIdentity, topPropertyId]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  async function generateAnalysis(forceRefresh = false): Promise<void> {
    if (!request || !topPropertyId || isGeneratingRef.current) return;
    if (state.status === "cached" && !forceRefresh) { setState({ status: "success", analysis: state.analysis }); return; }

    if (!forceRefresh) {
      const cached = findAIAnalysisBySignature(topPropertyId, request.inputSignature, engine.engineVersion);
      if (cached) { setState({ status: "success", analysis: cached.analysis }); return; }
    }

    isGeneratingRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState({ status: "loading" });

    try {
      const response = await requestAIAnalysis(request, { signal: controller.signal });
      if (controller.signal.aborted || generationRef.current !== generation) return;
      if (!response.ok || response.metadata.inputSignature !== request.inputSignature || response.analysis.topPropertyId !== topPropertyId) {
        const previous = findLatestAIAnalysisForProperty(topPropertyId);
        if (previous) {
          setState({ status: "success", analysis: previous.analysis, warning: "最新生成失败，正在展示上一次有效解读" });
        } else {
          setState({ status: "error", message: response.ok ? "AI 解读与当前房源比较结果不匹配。" : response.error.message });
        }
        return;
      }
      saveAIAnalysisRecord({
        propertyId: topPropertyId,
        inputSignature: request.inputSignature,
        engineVersion: engine.engineVersion,
        generatedAt: response.metadata.generatedAt,
        analysis: response.analysis,
      });
      setState({ status: "success", analysis: response.analysis });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        isGeneratingRef.current = false;
      }
    }
  }

  const isLoading = state.status === "loading";
  const buttonLabel = state.status === "success" ? "重新生成" : state.status === "cached" ? "查看已有AI解读" : state.status === "stale" ? "重新生成" : state.status === "error" ? "重新尝试" : isLoading ? "生成中..." : "生成AI解读";

  return (
    <section className="card mt-7 overflow-hidden" aria-live="polite">
      <div className="border-b border-[#ebe8e0] bg-[linear-gradient(135deg,#f8f6ef_0%,#eef3eb_100%)] p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#667a5f] shadow-sm"><Sparkles size={22} /></span>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">AI Analysis</p>
              <h2 className="mt-1 font-serif text-2xl">AI购房解读</h2>
              <p className="mt-2 text-sm leading-6 text-[#70736e]">结合你的偏好、房源事实和地图证据，解释为什么当前首选更适合你</p>
            </div>
          </div>
          <Button type="button" onClick={() => void generateAnalysis(state.status === "success" || state.status === "stale")} className="shrink-0" disabled={isLoading || !request} aria-busy={isLoading}>
            {isLoading ? <LoaderCircle className="animate-spin" size={16} /> : state.status === "success" || state.status === "error" ? <RefreshCcw size={16} /> : <Sparkles size={16} />}
            {buttonLabel}
          </Button>
        </div>
      </div>

      {state.status === "idle" && <div className="p-6 text-sm leading-7 text-[#747772] sm:p-8">AI 将结合购房偏好、全部候选、15维结果以及当前高德地图与通勤证据，解释现有阶段性排序。</div>}
      {state.status === "cached" && <div className="p-6 text-sm leading-7 text-[#687563] sm:p-8">已找到与当前完整决策上下文一致的有效 AI 解读，可直接查看。</div>}
      {state.status === "stale" && <div className="flex items-start gap-3 p-6 text-sm leading-6 text-[#78684a] sm:p-8"><AlertTriangle className="mt-0.5 shrink-0" size={19} /><p className="font-medium">AI解读已过期，决策上下文发生变化，请重新生成</p></div>}
      {state.status === "loading" && (
        <div className="p-6 sm:p-8"><div className="mx-auto max-w-xl rounded-2xl border border-[#e4e8e0] bg-[#f8faf6] p-5 sm:p-6">
          <div className="flex items-center gap-3 text-[#5f7258]"><LoaderCircle className="animate-spin" size={20} /><p className="font-medium">正在生成AI购房解读</p></div>
          <ul className="mt-5 space-y-3 text-sm text-[#6c7169]">
            <LoadingStep complete text="已读取房源与购房偏好" />
            <LoadingStep complete text="已结合15维排序结果" />
            <LoadingStep complete text="已读取地图与通勤证据" />
            <LoadingStep text="正在生成比较结论" />
          </ul>
          <p className="mt-5 text-xs leading-5 text-[#8a8f87]">通常需要 15–30 秒，请保持页面开启。</p>
        </div></div>
      )}
      {state.status === "error" && <div className="flex items-start gap-3 p-6 text-sm leading-6 text-[#78684a] sm:p-8"><AlertTriangle className="mt-0.5 shrink-0" size={19} /><div><p className="font-medium">AI分析暂时不可用，当前评分结果仍然有效</p><p className="mt-1 text-xs text-[#8a806e]">{state.message}</p></div></div>}
      {state.status === "success" && topCandidate && (
        <AnalysisContent
          analysis={state.analysis}
          deterministicTopName={topCandidate.property.name ?? "当前首选房源"}
          matchScore={topCandidate.decision.matchScore}
          recommendation={topCandidate.decision.recommendation}
          topPriorities={request?.context.preferences.topPriorities ?? preferences.topPriorities}
          alternativeName={request?.context.candidates[1]?.property.name ?? null}
          warning={state.warning}
        />
      )}
    </section>
  );
}

function AnalysisContent({
  analysis,
  deterministicTopName,
  matchScore,
  recommendation,
  topPriorities,
  alternativeName,
  warning,
}: {
  analysis: AIAnalysis;
  deterministicTopName: string;
  matchScore: number | null;
  recommendation: "CONSIDER" | "WAIT" | "PASS";
  topPriorities: DecisionPriority[];
  alternativeName: string | null;
  warning?: string;
}) {
  const recommendationLabel = RECOMMENDATION_LABELS[recommendation];
  const decisionSummary = analysis.decisionSummary.replace(/^\s*推荐结论\s*[：:]\s*/, "");
  return (
    <div className="space-y-5 p-6 sm:p-8">
      {warning && <div className="flex items-start gap-3 rounded-xl border border-[#eadfca] bg-[#faf6ed] p-4 text-sm text-[#78684a]"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>{warning}</p></div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-serif text-xl">最适合您的房源：{deterministicTopName}</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-1.5 font-medium ${RECOMMENDATION_BADGE_STYLES[recommendation]}`}>{recommendationLabel}</span>
          {matchScore !== null && <span className="rounded-full bg-[#f3f2ed] px-3 py-1.5 text-[#747772]">当前匹配度 {Math.round(matchScore)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-[#667061]"><span className="py-1.5">您当前最关注：</span>{topPriorities.map((priority, index) => <span key={priority} className="rounded-full bg-[#f3f5f0] px-3 py-1.5">{index + 1}. {PRIORITY_LABELS[priority]}</span>)}</div>
      <div className="rounded-xl bg-[#faf9f6] p-4 sm:p-5"><h4 className="text-sm font-semibold text-[#5d6658]">推荐结论</h4><p className="mt-2 text-sm leading-8 text-[#626560]">{decisionSummary}</p>{alternativeName && <p className="mt-3 text-xs text-[#898b86]">主要比较对象：{alternativeName}</p>}</div>
      {analysis.pendingEvidence.length > 0 && <AnalysisList title="建议下一步确认" items={analysis.pendingEvidence} />}
      <p className="text-xs leading-5 text-[#8a8c87]">{analysis.disclaimer}</p>
    </div>
  );
}

function LoadingStep({ complete = false, text }: { complete?: boolean; text: string }) {
  return <li className="flex items-center gap-3">{complete ? <span className="grid size-5 place-items-center rounded-full bg-[#718169] text-white"><Check size={13} /></span> : <LoaderCircle className="animate-spin text-[#718169]" size={20} />}<span>{text}</span></li>;
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-xl bg-[#f7f6f2] p-4 text-[#626560]"><h4 className="text-sm font-semibold">{title}</h4><ul className="mt-3 flex flex-wrap gap-2 text-xs leading-5">{items.map((text) => <li key={text} className="rounded-full bg-white px-3 py-1.5">{text}</li>)}</ul></div>;
}
