"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Database, LoaderCircle, RefreshCcw, Save, Sparkles } from "lucide-react";
import { AIAnalysisPanel } from "@/components/ai/ai-analysis-panel";
import { DecisionPropertyCard } from "@/components/decision/decision-property-card";
import { PropertyIntelligenceCard } from "@/components/intelligence/property-intelligence-card";
import { Button } from "@/components/ui/button";
import { findAIAnalysisBySignature } from "@/lib/ai-analysis-storage";
import { projectAIAnalysisContext } from "@/lib/ai/input";
import { validatePropertyIntelligence } from "@/lib/ai/property-intelligence-validation";
import { createAIInputSignature } from "@/lib/ai/signature";
import { BUYER_PREFERENCES_STORAGE_KEY, loadBuyerPreferences } from "@/lib/buyer-preferences-storage";
import { createDecisionPropertyView, validateTextField } from "@/lib/decision/dataQuality";
import { runDecisionEngine } from "@/lib/decision/engine";
import { saveDecisionHistory } from "@/lib/decision-history-storage";
import { getProperties, PROPERTY_STORAGE_KEY } from "@/lib/property-storage";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { DecisionEngineResult } from "@/types/decision";
import type { Property } from "@/types/property";
import type { PropertyIntelligence, PropertyIntelligenceRequest } from "@/types/property-intelligence";

interface ResultsState {
  properties: Property[];
  preferences: BuyerPreferences | null;
  engine: DecisionEngineResult | null;
  message: string | null;
}

const RECOMMENDATION_LABELS = {
  CONSIDER: "优先考虑",
  WAIT: "谨慎考虑",
  PASS: "暂不推荐",
} as const;

function getAIOverallSummary(
  properties: Property[],
  preferences: BuyerPreferences,
  engine: DecisionEngineResult,
): string | null {
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const summaries = engine.results.flatMap((decisionResult) => {
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
    const cached = findAIAnalysisBySignature(property.id, inputSignature, engine.engineVersion);
    return cached ? [`${property.name}：${cached.analysis.summary}`] : [];
  });
  return summaries.length > 0 ? summaries.join("\n") : null;
}

type IntelligenceState =
  | { status: "loading" }
  | { status: "success"; intelligence: PropertyIntelligence }
  | { status: "error"; message: string };

function createPropertyIntelligenceRequest(
  property: Property,
  preferences: BuyerPreferences,
): PropertyIntelligenceRequest {
  const safeProperty = createDecisionPropertyView(property);
  const primaryWorkLocation = validateTextField(preferences.primaryWorkLocation).status === "valid"
    ? preferences.primaryWorkLocation.trim()
    : null;

  return {
    property: {
      id: property.id,
      name: property.name,
      city: safeProperty.city,
      district: safeProperty.district,
      address: safeProperty.address,
      totalPrice: property.totalPrice,
      listingPrice: property.listingPrice ?? null,
      area: property.area,
      layout: safeProperty.layout,
      floor: property.floor,
      metroDistance: safeProperty.metroDistance,
      schoolInformation: safeProperty.schoolInformation.trim() || null,
      propertyManagementInformation: safeProperty.propertyManagementInformation.trim() || null,
      deliveryYear: property.deliveryYear ?? null,
      orientation: property.orientation ?? null,
    },
    preferences: {
      purchasePurpose: preferences.purchasePurpose,
      maximumBudget: preferences.maximumBudget,
      commuteMode: preferences.commuteMode,
      primaryWorkLocation,
      educationNeed: preferences.educationNeed,
      topPriorities: preferences.topPriorities,
    },
  };
}

export function DecisionResults() {
  const [state, setState] = useState<ResultsState>({ properties: [], preferences: null, engine: null, message: null });
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [intelligenceByProperty, setIntelligenceByProperty] = useState<Record<string, IntelligenceState>>({});
  const intelligenceRequestsRef = useRef(new Map<string, AbortController>());

  const refresh = useCallback(() => {
    intelligenceRequestsRef.current.forEach((controller) => controller.abort());
    intelligenceRequestsRef.current.clear();
    setIntelligenceByProperty({});
    setSaveStatus("idle");
    const manualProperties = getProperties().filter((property) => property.source === "manual");
    const preferencesResult = loadBuyerPreferences();
    if (preferencesResult.status !== "valid") {
      setState({
        properties: manualProperties,
        preferences: null,
        engine: null,
        message: preferencesResult.status === "invalid" ? preferencesResult.message : "请先完成并保存购房偏好。",
      });
      setIsLoading(false);
      return;
    }
    if (manualProperties.length === 0) {
      setState({ properties: [], preferences: preferencesResult.preferences, engine: null, message: "当前没有可用于真实分析的手动录入房源。演示 Mock 房源不会参与真实排序。" });
      setIsLoading(false);
      return;
    }

    const asOfDate = new Date().toISOString().slice(0, 10);
    try {
      const engine = runDecisionEngine({ properties: manualProperties, preferences: preferencesResult.preferences, asOfDate });
      setState({ properties: manualProperties, preferences: preferencesResult.preferences, engine, message: null });
    } catch (error) {
      setState({ properties: manualProperties, preferences: preferencesResult.preferences, engine: null, message: error instanceof Error ? error.message : "无法生成分析结果。" });
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    function handleStorage(event: StorageEvent) {
      if (event.key === PROPERTY_STORAGE_KEY || event.key === BUYER_PREFERENCES_STORAGE_KEY) refresh();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refresh]);

  useEffect(() => () => {
    intelligenceRequestsRef.current.forEach((controller) => controller.abort());
  }, []);

  async function generatePropertyIntelligence(property: Property): Promise<void> {
    if (!state.preferences || intelligenceRequestsRef.current.has(property.id)) return;
    const controller = new AbortController();
    intelligenceRequestsRef.current.set(property.id, controller);
    setIntelligenceByProperty((current) => ({ ...current, [property.id]: { status: "loading" } }));

    try {
      const response = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPropertyIntelligenceRequest(property, state.preferences)),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      const validation = validatePropertyIntelligence(payload);
      if (!response.ok || !validation.success || validation.data.propertyId !== property.id) {
        setIntelligenceByProperty((current) => ({
          ...current,
          [property.id]: { status: "error", message: "房产智能分析暂时不可用，请稍后重试。" },
        }));
        return;
      }
      setIntelligenceByProperty((current) => ({
        ...current,
        [property.id]: { status: "success", intelligence: validation.data },
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setIntelligenceByProperty((current) => ({
        ...current,
        [property.id]: { status: "error", message: "无法连接房产智能分析服务。" },
      }));
    } finally {
      if (intelligenceRequestsRef.current.get(property.id) === controller) {
        intelligenceRequestsRef.current.delete(property.id);
      }
    }
  }

  function generateAllPropertyIntelligence(): void {
    state.properties.forEach((property) => {
      if (intelligenceByProperty[property.id]?.status !== "success") {
        void generatePropertyIntelligence(property);
      }
    });
  }

  function handleSaveDecision(): void {
    if (!state.engine || !state.preferences) return;
    const topResult = state.engine.results[0];
    const topProperty = state.properties.find((property) => property.id === topResult?.propertyId);
    try {
      saveDecisionHistory({
        title: topProperty
          ? `${topProperty.name} 等 ${state.properties.length} 套房源对比`
          : `${state.properties.length} 套房源决策`,
        properties: state.properties,
        preferences: state.preferences,
        decisionResult: state.engine,
        recommendedPropertyId: topResult?.propertyId ?? null,
        aiOverallSummary: getAIOverallSummary(state.properties, state.preferences, state.engine),
        propertyIntelligence: Object.values(intelligenceByProperty).flatMap((item) =>
          item.status === "success" ? [item.intelligence] : []
        ),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  if (isLoading) return <div className="card mt-8 h-64 animate-pulse" aria-label="正在计算分析结果" />;

  if (!state.engine) {
    return (
      <section className="card mt-8 grid min-h-80 place-items-center p-8 text-center">
        <div className="max-w-lg">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#f2efe8] text-[#806b3e]"><AlertTriangle size={28} /></span>
          <h2 className="mt-5 text-xl font-semibold">暂时无法生成真实分析</h2>
          <p className="mt-3 text-sm leading-7 text-[#747772]">{state.message}</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild><Link href="/properties">管理房源</Link></Button>
            <Button asChild className="bg-white text-[#53674d] ring-1 ring-[#d8d8d1] hover:bg-[#f3f3ee]"><Link href="/preferences">设置购房偏好</Link></Button>
          </div>
        </div>
      </section>
    );
  }

  const propertyById = new Map(state.properties.map((property) => [property.id, property]));
  const winner = state.engine.results[0];
  const winnerProperty = propertyById.get(winner.propertyId);
  const confirmedEvidence = winner.confidence.evidenceItems.filter((item) => item.category === "confirmed");
  const aiEvidence = winner.confidence.evidenceItems.filter((item) => item.category === "ai_inferred");
  const optionalEvidence = winner.confidence.evidenceItems.filter((item) => item.category === "optional_confirmation");
  const completeness = winner.confidence.dataCompleteness;
  const hasInvalidInputs = state.engine.results.some((result) => result.confidence.invalidInputFields.length > 0);
  const intelligenceStates = Object.values(intelligenceByProperty);
  const isIntelligenceLoading = intelligenceStates.some((item) => item.status === "loading");
  const hasIntelligence = intelligenceStates.some((item) => item.status === "success");
  const hasCompleteIntelligence = state.properties.length > 0 && state.properties.every(
    (property) => intelligenceByProperty[property.id]?.status === "success",
  );

  return (
    <>
      <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#e4dfd3] bg-[#fbf8f1] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Database size={20} className="mt-0.5 shrink-0 text-[#75886d]" />
          <div>
            <p className="font-medium">本次结果仅基于已保存的真实结构化信息</p>
            <p className="mt-1 text-xs leading-5 text-[#767973]">分析日期 {state.engine.asOfDate} · 引擎 {state.engine.engineVersion} · AI 与外部证据暂未参与本次计算</p>
          </div>
        </div>
        {state.engine.rankingProvisional && <span className="shrink-0 rounded-full bg-[#efe8d9] px-4 py-2 text-xs font-medium text-[#806b3e]">阶段性排序</span>}
      </div>

      <div className="mt-7 grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {state.engine.results.map((result, index) => {
          const property = propertyById.get(result.propertyId);
          return property ? <DecisionPropertyCard key={result.propertyId} property={property} result={result} rank={index + 1} /> : null;
        })}
      </div>

      {hasInvalidInputs && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#e8ddc8] bg-[#fbf7ee] p-4 text-sm leading-6 text-[#78684a]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>部分输入信息内容较少，未纳入当前分析计算。补充具体名称可以提高分析可信度。</p>
        </div>
      )}

      {winnerProperty && (
        <section className="card mt-7 p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">当前排序第一</p>
              <h2 className="mt-2 font-serif text-2xl sm:text-3xl">{winnerProperty.name}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#696c67]">{winner.reasons.join(" ")}</p>
            </div>
            <div className="grid min-w-72 grid-cols-3 gap-3 rounded-2xl bg-[#f6f5f1] p-4 text-center text-xs">
              <div><span className="block text-[#92938f]">当前匹配度</span><b className="mt-2 block text-xl text-[#607158]">{winner.overallScore ?? "—"}</b><small className="mt-1 block text-[10px] font-normal text-[#92938f]">基于当前已知信息</small></div>
              <div><span className="block text-[#92938f]">数据完整度</span><b className="mt-2 block text-xl">{winner.confidence.dataCompletenessPercent}%</b></div>
              <div><span className="block text-[#92938f]">建议</span><b className="mt-2 block text-xl text-[#806b3e]">{RECOMMENDATION_LABELS[winner.recommendation]}</b><small className="mt-1 block text-[10px] font-normal text-[#92938f]">{winner.recommendation}</small></div>
            </div>
          </div>

          <div className="mt-5 grid gap-2 rounded-xl bg-[#faf9f6] p-4 text-xs text-[#71746f] sm:grid-cols-3">
            <span>基础房源信息：{completeness.sections.basic === 60 ? "✓ 已完成" : `${completeness.sections.basic}/60`}</span>
            <span>生活服务信息：{completeness.sections.living === 20 ? "✓ 已完成" : `${completeness.sections.living}/20 · 部分完成`}</span>
            <span>决策参考信息：{completeness.missingFields.some((field) => field.startsWith("近期有效成交参考")) ? `${completeness.sections.decision}/20 · 有效成交参考不足3条` : `${completeness.sections.decision}/20`}</span>
          </div>

          <div className="mt-7 border-t border-[#eceae5] pt-6">
            <h3 className="font-semibold">决策影响因素</h3>
            <p className="mt-2 text-xs leading-5 text-[#777a74]">系统已经基于当前信息给出判断；进一步确认只会提升可信度，不会阻塞当前推荐。</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {[
                { title: "已确认信息", items: confirmedEvidence, style: "bg-[#f5f8f3] text-[#607158]" },
                { title: `AI分析项（${winner.confidence.aiAnalysisProgress.completed}/${winner.confidence.aiAnalysisProgress.total}）`, items: aiEvidence, style: "bg-[#f7f4ed] text-[#806b3e]" },
                { title: "可进一步确认", items: optionalEvidence, style: "bg-[#f7f6f2] text-[#626560]" },
              ].map((group) => (
                <div key={group.title} className={`rounded-xl p-5 ${group.style}`}>
                  <h4 className="font-semibold">{group.title}</h4>
                  <ul className="mt-3 space-y-2 text-xs leading-5">{group.items.slice(0, 5).map((item) => <li key={item.id}>• {item.title}</li>)}</ul>
                </div>
              ))}
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {winner.decisionFactors.map((factor) => <li key={factor} className="flex items-start gap-2 rounded-xl bg-[#faf8f3] p-4 text-sm text-[#676a65]"><ArrowRight size={16} className="mt-0.5 shrink-0 text-[#75886d]" />{factor}</li>)}
            </ul>
          </div>
          <Link href={`/results/${winner.propertyId}`} className="mt-6 inline-flex items-center gap-2 text-sm text-[#607158]">查看完整 15 维证据 <ArrowRight size={16} /></Link>
        </section>
      )}

      <section className="mt-7">
        <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#75886d]">Property Intelligence</p>
            <h2 className="mt-2 font-serif text-2xl">房产智能分析</h2>
            <p className="mt-2 text-sm leading-6 text-[#70736e]">基于已提供房源信息和一般性地理知识，补充区域、产业、生活与资产价值背景。</p>
          </div>
          <Button type="button" onClick={generateAllPropertyIntelligence} disabled={isIntelligenceLoading || hasCompleteIntelligence} className="shrink-0">
            {isIntelligenceLoading ? <LoaderCircle className="animate-spin" size={16} /> : hasIntelligence ? <RefreshCcw size={16} /> : <Sparkles size={16} />}
            {isIntelligenceLoading
              ? "正在分析房产价值..."
              : hasCompleteIntelligence
                ? "已生成房产智能分析"
                : hasIntelligence
                  ? "生成未完成分析"
                  : "生成房产智能分析"}
          </Button>
        </div>

        {intelligenceStates.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-[#dcded7] p-6 text-center text-sm text-[#7b7e78]">未生成房产智能分析</div>
        )}

        <div className="mt-4 space-y-5">
          {state.properties.map((property) => {
            const intelligenceState = intelligenceByProperty[property.id];
            if (!intelligenceState) return null;
            if (intelligenceState.status === "success") {
              return <PropertyIntelligenceCard key={property.id} property={property} intelligence={intelligenceState.intelligence} />;
            }
            if (intelligenceState.status === "loading") {
              return <div key={property.id} className="card flex min-h-36 items-center justify-center gap-3 p-6 text-sm text-[#65725f]"><LoaderCircle className="animate-spin" size={20} />正在分析 {property.name} 的房产价值...</div>;
            }
            return (
              <div key={property.id} className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 text-sm text-[#78684a]"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><div><b>{property.name}</b><p className="mt-1">{intelligenceState.message}</p></div></div>
                <Button type="button" onClick={() => void generatePropertyIntelligence(property)} className="shrink-0 bg-white text-[#53674d] ring-1 ring-[#d8d8d1] hover:bg-[#f3f3ee]"><RefreshCcw size={15} />重新尝试</Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#e3e5de] bg-[#f7f9f5] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">保存当前决策快照</h2>
          <p className="mt-1 text-xs leading-5 text-[#747772]">保存当前房源、购房偏好和分析结果，后续资料变化不会影响这份记录。</p>
          {saveStatus === "error" && <p className="mt-2 text-xs text-[#9a5d50]">保存失败，请检查浏览器存储空间后重试。</p>}
        </div>
        <Button type="button" onClick={handleSaveDecision} disabled={saveStatus === "saved"} className="shrink-0">
          {saveStatus === "saved" ? <Check size={16} /> : <Save size={16} />}
          {saveStatus === "saved" ? "已保存" : "保存本次决策"}
        </Button>
      </section>

      {state.preferences && (
        <AIAnalysisPanel
          properties={state.properties}
          preferences={state.preferences}
          engine={state.engine}
        />
      )}
    </>
  );
}
