"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  findAIAnalysisBySignature,
  findLatestAIAnalysisForProperty,
  saveAIAnalysisRecord,
} from "@/lib/ai-analysis-storage";
import { requestAIAnalysis } from "@/lib/ai/client";
import { projectAIAnalysisContext } from "@/lib/ai/input";
import { createAIInputSignature } from "@/lib/ai/signature";
import {
  AI_ANALYSIS_SCHEMA_VERSION,
  type AIAnalysis,
  type AIAnalysisRequest,
} from "@/types/ai-analysis";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { DecisionEngineResult } from "@/types/decision";
import type { Property } from "@/types/property";

interface AIAnalysisPanelProps {
  properties: Property[];
  preferences: BuyerPreferences;
  engine: DecisionEngineResult;
}

interface PropertyAnalysisItem {
  propertyId: string;
  propertyName: string;
  analysis: AIAnalysis;
}

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "cached"; items: PropertyAnalysisItem[] }
  | { status: "stale" }
  | { status: "success"; items: PropertyAnalysisItem[]; warning?: string }
  | { status: "error"; message: string };

function buildRequests(
  properties: Property[],
  preferences: BuyerPreferences,
  engine: DecisionEngineResult,
): Array<{ propertyId: string; propertyName: string; request: AIAnalysisRequest }> {
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  return engine.results.flatMap((decisionResult) => {
    const property = propertyById.get(decisionResult.propertyId);
    if (!property) return [];
    const context = projectAIAnalysisContext({
      property,
      preferences,
      decisionResult,
      decisionVersion: engine.engineVersion,
      asOfDate: engine.asOfDate,
    });
    const inputSignature = createAIInputSignature(context);
    return [{
      propertyId: property.id,
      propertyName: property.name,
      request: {
        schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
        locale: "zh-CN",
        inputSignature,
        context,
      },
    }];
  });
}

export function AIAnalysisPanel({ properties, preferences, engine }: AIAnalysisPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const abortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const generationRef = useRef(0);
  const requests = useMemo(
    () => buildRequests(properties, preferences, engine),
    [properties, preferences, engine],
  );
  const requestIdentity = requests.map((item) => item.request.inputSignature).join(":");

  useEffect(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isGeneratingRef.current = false;
    const cachedItems = requests.flatMap((item) => {
      const record = findAIAnalysisBySignature(
        item.propertyId,
        item.request.inputSignature,
        engine.engineVersion,
      );
      return record
        ? [{ propertyId: item.propertyId, propertyName: item.propertyName, analysis: record.analysis }]
        : [];
    });
    if (requests.length > 0 && cachedItems.length === requests.length) {
      setState({ status: "cached", items: cachedItems });
      return;
    }

    const hasStaleAnalysis = requests.some((item) => {
      const previous = findLatestAIAnalysisForProperty(item.propertyId);
      return previous !== null && (
        previous.inputSignature !== item.request.inputSignature ||
        previous.engineVersion !== engine.engineVersion
      );
    });
    setState(hasStaleAnalysis ? { status: "stale" } : { status: "idle" });
  }, [engine.engineVersion, requestIdentity, requests]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  async function generateAnalysis(forceRefresh = false): Promise<void> {
    if (requests.length === 0 || isGeneratingRef.current) return;

    if (state.status === "cached" && !forceRefresh) {
      setState({ status: "success", items: state.items });
      return;
    }

    const cachedItemsByProperty = new Map<string, PropertyAnalysisItem>();
    if (!forceRefresh) {
      requests.forEach((item) => {
        const record = findAIAnalysisBySignature(
          item.propertyId,
          item.request.inputSignature,
          engine.engineVersion,
        );
        if (record) {
          cachedItemsByProperty.set(item.propertyId, {
            propertyId: item.propertyId,
            propertyName: item.propertyName,
            analysis: record.analysis,
          });
        }
      });
    }

    const pendingRequests = requests.filter((item) => !cachedItemsByProperty.has(item.propertyId));
    if (pendingRequests.length === 0) {
      setState({
        status: "success",
        items: requests.flatMap((item) => {
          const cachedItem = cachedItemsByProperty.get(item.propertyId);
          return cachedItem ? [cachedItem] : [];
        }),
      });
      return;
    }

    isGeneratingRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState({ status: "loading" });

    try {
      const responses = await Promise.all(
        pendingRequests.map(async (item) => ({
          item,
          response: await requestAIAnalysis(item.request, { signal: controller.signal }),
        })),
      );
      if (controller.signal.aborted || generationRef.current !== generation) return;

      const failed = responses.find(({ response }) => !response.ok);
      const hasMismatchedSignature = responses.some(({ item, response }) =>
        response.ok && response.metadata.inputSignature !== item.request.inputSignature
      );
      if ((failed && !failed.response.ok) || hasMismatchedSignature) {
        const previousItems = requests.flatMap((item) => {
          const cachedItem = cachedItemsByProperty.get(item.propertyId);
          if (cachedItem) return [cachedItem];
          const previous = findLatestAIAnalysisForProperty(item.propertyId);
          return previous
            ? [{ propertyId: item.propertyId, propertyName: item.propertyName, analysis: previous.analysis }]
            : [];
        });
        if (previousItems.length > 0) {
          setState({
            status: "success",
            items: previousItems,
            warning: "最新生成失败，正在展示上一次有效解读",
          });
        } else {
          setState({
            status: "error",
            message: failed && !failed.response.ok
              ? failed.response.error.message
              : "AI 解读与当前房源信息不匹配，请重新尝试。",
          });
        }
        return;
      }

      responses.forEach(({ item, response }) => {
        if (!response.ok || response.metadata.inputSignature !== item.request.inputSignature) return;
        const analysisItem = {
          propertyId: item.propertyId,
          propertyName: item.propertyName,
          analysis: response.analysis,
        };
        cachedItemsByProperty.set(item.propertyId, analysisItem);
        saveAIAnalysisRecord({
          propertyId: item.propertyId,
          inputSignature: item.request.inputSignature,
          engineVersion: engine.engineVersion,
          generatedAt: response.metadata.generatedAt,
          analysis: response.analysis,
        });
      });

      setState({
        status: "success",
        items: requests.flatMap((item) => {
          const analysisItem = cachedItemsByProperty.get(item.propertyId);
          return analysisItem ? [analysisItem] : [];
        }),
      });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        isGeneratingRef.current = false;
      }
    }
  }

  const rankingNames = requests.map((item) => item.propertyName).join(" → ");
  const isLoading = state.status === "loading";
  const buttonLabel = state.status === "success"
    ? "重新生成"
    : state.status === "cached"
      ? "查看已有AI解读"
      : state.status === "stale"
        ? "重新生成"
    : state.status === "error"
      ? "重新尝试"
      : isLoading
        ? "生成中..."
        : "生成AI解读";

  return (
    <section className="card mt-7 overflow-hidden" aria-live="polite">
      <div className="border-b border-[#ebe8e0] bg-[linear-gradient(135deg,#f8f6ef_0%,#eef3eb_100%)] p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#667a5f] shadow-sm">
              <Sparkles size={22} />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">AI Analysis</p>
              <h2 className="mt-1 font-serif text-2xl">AI购房解读</h2>
              <p className="mt-2 text-sm leading-6 text-[#70736e]">基于当前房源、偏好和决策结果生成个性化分析</p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void generateAnalysis(state.status === "success" || state.status === "stale")}
            className="shrink-0"
            disabled={isLoading || requests.length === 0}
            aria-busy={isLoading}
          >
            {isLoading
              ? <LoaderCircle className="animate-spin" size={16} />
              : state.status === "success" || state.status === "error"
                ? <RefreshCcw size={16} />
                : <Sparkles size={16} />}
            {buttonLabel}
          </Button>
        </div>
      </div>

      {state.status === "idle" && (
        <div className="p-6 text-sm leading-7 text-[#747772] sm:p-8">
          AI 只负责解释已有证据；当前匹配度、阶段性排序和推荐状态仍由 Decision Engine 决定。
        </div>
      )}

      {state.status === "cached" && (
        <div className="p-6 text-sm leading-7 text-[#687563] sm:p-8">
          已找到与当前房源信息一致的有效 AI 解读，可直接查看，无需再次生成。
        </div>
      )}

      {state.status === "stale" && (
        <div className="flex items-start gap-3 p-6 text-sm leading-6 text-[#78684a] sm:p-8">
          <AlertTriangle className="mt-0.5 shrink-0" size={19} />
          <p className="font-medium">AI解读已过期，房源信息发生变化，请重新生成</p>
        </div>
      )}

      {state.status === "loading" && (
        <div className="p-6 sm:p-8">
          <div className="mx-auto max-w-xl rounded-2xl border border-[#e4e8e0] bg-[#f8faf6] p-5 sm:p-6">
            <div className="flex items-center gap-3 text-[#5f7258]">
              <LoaderCircle className="animate-spin" size={20} />
              <p className="font-medium">正在生成AI购房解读</p>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-[#6c7169]">
              <LoadingStep complete text="已读取房源信息" />
              <LoadingStep complete text="已分析购房偏好" />
              <LoadingStep complete text="已结合 Decision Engine 结果" />
              <LoadingStep text="正在生成个性化建议" />
            </ul>
            <p className="mt-5 text-xs leading-5 text-[#8a8f87]">通常需要 15–30 秒，请保持页面开启。</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex items-start gap-3 p-6 text-sm leading-6 text-[#78684a] sm:p-8">
          <AlertTriangle className="mt-0.5 shrink-0" size={19} />
          <div>
            <p className="font-medium">AI分析暂时不可用，当前评分结果仍然有效</p>
            <p className="mt-1 text-xs text-[#8a806e]">{state.message}</p>
          </div>
        </div>
      )}

      {state.status === "success" && (
        <div className="space-y-7 p-6 sm:p-8">
          {state.warning && (
            <div className="flex items-start gap-3 rounded-xl border border-[#eadfca] bg-[#faf6ed] p-4 text-sm text-[#78684a]">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} />
              <p>{state.warning}</p>
            </div>
          )}
          <div className="grid gap-4 rounded-2xl bg-[#f7f6f2] p-5 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">整体解读</h3>
              <p className="mt-2 text-sm leading-6 text-[#6e716c]">已完成 {state.items.length} 套候选房源的个性化解读，可结合下方优势、权衡和确认问题继续判断。</p>
            </div>
            <div>
              <h3 className="font-semibold">排序说明</h3>
              <p className="mt-2 text-sm leading-6 text-[#6e716c]">{rankingNames || "当前暂无排序"}</p>
              <p className="mt-1 text-xs text-[#8a8c87]">该顺序来自 Decision Engine，AI 解读不会改变排序。</p>
            </div>
          </div>

          <div className="space-y-5">
            {state.items.map((item, index) => (
              <article key={item.propertyId} className="rounded-2xl border border-[#e6e3dc] p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-[#718169] text-sm text-white">{index + 1}</span>
                  <h3 className="font-serif text-xl">{item.propertyName}</h3>
                </div>
                <p className="mt-4 text-sm leading-7 text-[#626560]">{item.analysis.summary}</p>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <AnalysisList title="优势" items={item.analysis.strengths} tone="positive" />
                  <AnalysisList title="权衡与风险" items={item.analysis.tradeoffs} tone="warning" />
                  <AnalysisList title="建议确认" items={item.analysis.confirmationQuestions} tone="neutral" />
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LoadingStep({ complete = false, text }: { complete?: boolean; text: string }) {
  return (
    <li className="flex items-center gap-3">
      {complete
        ? <span className="grid size-5 place-items-center rounded-full bg-[#718169] text-white"><Check size={13} /></span>
        : <LoaderCircle className="animate-spin text-[#718169]" size={20} />}
      <span>{text}</span>
    </li>
  );
}

function AnalysisList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "warning" | "neutral";
}) {
  const styles = {
    positive: "bg-[#f3f7f1] text-[#5f7358]",
    warning: "bg-[#faf5eb] text-[#806b3e]",
    neutral: "bg-[#f5f5f2] text-[#626560]",
  } as const;

  return (
    <div className={`rounded-xl p-4 ${styles[tone]}`}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-xs leading-5">
          {items.map((text) => (
            <li key={text} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0" />{text}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs opacity-70">当前没有可展示内容</p>
      )}
    </div>
  );
}
