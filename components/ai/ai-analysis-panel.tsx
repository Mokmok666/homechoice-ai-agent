"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  | { status: "success"; items: PropertyAnalysisItem[] }
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
  const requests = useMemo(
    () => buildRequests(properties, preferences, engine),
    [properties, preferences, engine],
  );
  const requestIdentity = requests.map((item) => item.request.inputSignature).join(":");

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState({ status: "idle" });
  }, [requestIdentity]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  async function generateAnalysis(): Promise<void> {
    if (requests.length === 0) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState({ status: "loading" });

    const responses = await Promise.all(
      requests.map(async (item) => ({
        item,
        response: await requestAIAnalysis(item.request, { signal: controller.signal }),
      })),
    );
    if (controller.signal.aborted) return;

    const failed = responses.find(({ response }) => !response.ok);
    if (failed && !failed.response.ok) {
      setState({ status: "error", message: failed.response.error.message });
      return;
    }

    setState({
      status: "success",
      items: responses.flatMap(({ item, response }) => response.ok
        ? [{ propertyId: item.propertyId, propertyName: item.propertyName, analysis: response.analysis }]
        : []),
    });
  }

  const rankingNames = requests.map((item) => item.propertyName).join(" → ");

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
          {(state.status === "idle" || state.status === "error") && (
            <Button type="button" onClick={() => void generateAnalysis()} className="shrink-0">
              {state.status === "error" ? <RefreshCcw size={16} /> : <Sparkles size={16} />}
              {state.status === "error" ? "重新生成" : "生成 AI 解读"}
            </Button>
          )}
        </div>
      </div>

      {state.status === "idle" && (
        <div className="p-6 text-sm leading-7 text-[#747772] sm:p-8">
          AI 只负责解释已有证据；当前匹配度、阶段性排序和推荐状态仍由 Decision Engine 决定。
        </div>
      )}

      {state.status === "loading" && (
        <div className="flex min-h-40 items-center justify-center gap-3 p-8 text-sm text-[#65725f]">
          <LoaderCircle className="animate-spin" size={20} />
          正在分析房源特点...
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
