"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Save } from "lucide-react";
import { AIAnalysisPanel } from "@/components/ai/ai-analysis-panel";
import { Button } from "@/components/ui/button";
import { useSupabaseAuth } from "@/components/providers/supabase-auth-provider";
import { findAIAnalysisBySignature } from "@/lib/ai-analysis-storage";
import { refreshGeoEvidenceForProperties } from "@/lib/amap/evidence-client";
import { createAIAnalysisRequest } from "@/lib/ai/request";
import { BUYER_PREFERENCES_STORAGE_KEY } from "@/lib/buyer-preferences-storage";
import { DEMO_ACTIVE_STORAGE_KEY, DEMO_PREFERENCES_STORAGE_KEY, getEffectiveBuyerPreferences, getEffectiveProperties } from "@/lib/demo/demo-mode";
import { runDecisionEngine } from "@/lib/decision/engine";
import { generateDecisionReasons } from "@/lib/decision/reason-generator";
import { buildDecisionSummary, buildQuickComparison } from "@/lib/decision-presentation";
import { savePersistedDecisionHistory } from "@/lib/decision-history-storage";
import { GEO_EVIDENCE_STORAGE_KEY, loadCachedGeoEvidenceForProperties } from "@/lib/geo-evidence-storage";
import { PROPERTY_STORAGE_KEY } from "@/lib/property-storage";
import { RECOMMENDATION_BADGE_STYLES, RECOMMENDATION_LABELS } from "@/lib/recommendation-presentation";
import { WEB_EVIDENCE_STORAGE_KEY, loadCachedWebEvidenceForProperties } from "@/lib/web-evidence-storage";
import { refreshWebEvidenceForProperties } from "@/lib/web-evidence/client";
import { externalEvidenceCoverage, mergeWebEvidenceIntoEngine } from "@/lib/web-evidence/merge";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { DecisionEngineResult } from "@/types/decision";
import type { GeoEvidenceByProperty } from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import type { WebEvidenceByProperty } from "@/lib/web-evidence/types";

interface ResultsState {
  properties: Property[];
  preferences: BuyerPreferences | null;
  engine: DecisionEngineResult | null;
  message: string | null;
  geoEvidenceCount: number;
  geoEvidenceByProperty: GeoEvidenceByProperty;
  webEvidenceByProperty: WebEvidenceByProperty;
}

function countUsableGeoEvidence(evidenceByProperty: Parameters<typeof runDecisionEngine>[0]["geoEvidenceByProperty"]): number {
  return Object.values(evidenceByProperty ?? {}).reduce(
    (count, evidence) => count + Object.values(evidence).filter((item) => item?.status !== "insufficient").length,
    0,
  );
}

function getAIOverallSummary(
  properties: Property[],
  preferences: BuyerPreferences,
  engine: DecisionEngineResult,
  geoEvidenceByProperty: GeoEvidenceByProperty,
  webEvidenceByProperty: WebEvidenceByProperty,
): string | null {
  if (engine.ranking.length === 0) return null;
  const inputSignature = createAIAnalysisRequest({ properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty }).inputSignature;
  const cached = findAIAnalysisBySignature(engine.ranking[0], inputSignature, engine.engineVersion);
  return cached?.analysis.decisionSummary ?? null;
}

export function DecisionResults() {
  const { authReady, userId } = useSupabaseAuth();
  const [state, setState] = useState<ResultsState>({ properties: [], preferences: null, engine: null, message: null, geoEvidenceCount: 0, geoEvidenceByProperty: {}, webEvidenceByProperty: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const geoRequestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!authReady) return;
    geoRequestRef.current?.abort();
    const geoController = new AbortController();
    geoRequestRef.current = geoController;
    setSaveStatus("idle");
    setIsLoading(true);
    const [allProperties, preferencesResult] = await Promise.all([
      getEffectiveProperties(userId),
      getEffectiveBuyerPreferences(userId),
    ]);
    const manualProperties = allProperties.filter((property) => property.source === "manual");
    if (preferencesResult.status !== "valid") {
      setState({
        properties: manualProperties,
        preferences: null,
        engine: null,
        message: preferencesResult.status === "invalid" ? preferencesResult.message : "请先完成并保存购房偏好。",
        geoEvidenceCount: 0,
        geoEvidenceByProperty: {},
        webEvidenceByProperty: {},
      });
      setIsLoading(false);
      return;
    }
    if (manualProperties.length === 0) {
      setState({ properties: [], preferences: preferencesResult.preferences, engine: null, message: "当前没有可用于真实分析的手动录入房源。演示 Mock 房源不会参与真实排序。", geoEvidenceCount: 0, geoEvidenceByProperty: {}, webEvidenceByProperty: {} });
      setIsLoading(false);
      return;
    }

    const asOfDate = new Date().toISOString().slice(0, 10);
    try {
      const cachedGeoEvidence = loadCachedGeoEvidenceForProperties(manualProperties, preferencesResult.preferences);
      const cachedWebEvidence = loadCachedWebEvidenceForProperties(manualProperties);
      let latestGeoEvidence = { ...cachedGeoEvidence };
      let latestWebEvidence = { ...cachedWebEvidence };
      const engine = mergeWebEvidenceIntoEngine(runDecisionEngine({
        properties: manualProperties,
        preferences: preferencesResult.preferences,
        asOfDate,
        geoEvidenceByProperty: cachedGeoEvidence,
        webEvidenceByProperty: cachedWebEvidence,
      }), cachedWebEvidence);
      setState({
        properties: manualProperties,
        preferences: preferencesResult.preferences,
        engine,
        message: null,
        geoEvidenceCount: countUsableGeoEvidence(cachedGeoEvidence),
        geoEvidenceByProperty: cachedGeoEvidence,
        webEvidenceByProperty: cachedWebEvidence,
      });
      void refreshGeoEvidenceForProperties(manualProperties, preferencesResult.preferences, (propertyId, evidence) => {
        if (geoController.signal.aborted) return;
        latestGeoEvidence = { ...latestGeoEvidence, [propertyId]: evidence };
        const progressivelyUpdatedEngine = mergeWebEvidenceIntoEngine(runDecisionEngine({
          properties: manualProperties,
          preferences: preferencesResult.preferences,
          asOfDate,
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        }), latestWebEvidence);
        setState({
          properties: manualProperties,
          preferences: preferencesResult.preferences,
          engine: progressivelyUpdatedEngine,
          message: null,
          geoEvidenceCount: countUsableGeoEvidence(latestGeoEvidence),
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        });
      })
        .then((geoEvidenceByProperty) => {
          if (geoController.signal.aborted) return;
          const engineWithGeoEvidence = mergeWebEvidenceIntoEngine(runDecisionEngine({
            properties: manualProperties,
            preferences: preferencesResult.preferences,
            asOfDate,
            geoEvidenceByProperty,
            webEvidenceByProperty: latestWebEvidence,
          }), latestWebEvidence);
          setState({
            properties: manualProperties,
            preferences: preferencesResult.preferences,
            engine: engineWithGeoEvidence,
            message: null,
            geoEvidenceCount: countUsableGeoEvidence(geoEvidenceByProperty),
            geoEvidenceByProperty,
            webEvidenceByProperty: latestWebEvidence,
          });
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === "AbortError")) {
            // External evidence is optional; the deterministic base result remains visible.
          }
        });
      void refreshWebEvidenceForProperties(manualProperties, preferencesResult.preferences, (propertyId, evidence) => {
        if (geoController.signal.aborted) return;
        latestWebEvidence = { ...latestWebEvidence, [propertyId]: evidence };
        const engineWithWebEvidence = mergeWebEvidenceIntoEngine(runDecisionEngine({
          properties: manualProperties,
          preferences: preferencesResult.preferences,
          asOfDate,
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        }), latestWebEvidence);
        setState({
          properties: manualProperties,
          preferences: preferencesResult.preferences,
          engine: engineWithWebEvidence,
          message: null,
          geoEvidenceCount: countUsableGeoEvidence(latestGeoEvidence),
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        });
      }, geoController.signal).catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          // Web evidence is optional; cached and deterministic results remain visible.
        }
      });
    } catch (error) {
      setState({ properties: manualProperties, preferences: preferencesResult.preferences, engine: null, message: error instanceof Error ? error.message : "无法生成分析结果。", geoEvidenceCount: 0, geoEvidenceByProperty: {}, webEvidenceByProperty: {} });
    }
    setIsLoading(false);
  }, [authReady, userId]);

  useEffect(() => {
    void refresh();
    function handleStorage(event: StorageEvent) {
      if (event.key === PROPERTY_STORAGE_KEY || event.key === BUYER_PREFERENCES_STORAGE_KEY || event.key === DEMO_ACTIVE_STORAGE_KEY || event.key === DEMO_PREFERENCES_STORAGE_KEY || event.key === GEO_EVIDENCE_STORAGE_KEY || event.key === WEB_EVIDENCE_STORAGE_KEY) void refresh();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refresh]);

  useEffect(() => () => geoRequestRef.current?.abort(), []);

  async function handleSaveDecision(): Promise<void> {
    if (!state.engine || !state.preferences) return;
    const topResult = state.engine.results[0];
    const topProperty = state.properties.find((property) => property.id === topResult?.propertyId);
    try {
      await savePersistedDecisionHistory({
        title: topProperty
          ? `${topProperty.name} 等 ${state.properties.length} 套房源对比`
          : `${state.properties.length} 套房源决策`,
        properties: state.properties,
        preferences: state.preferences,
        decisionResult: state.engine,
        recommendedPropertyId: topResult?.propertyId ?? null,
        aiOverallSummary: getAIOverallSummary(state.properties, state.preferences, state.engine, state.geoEvidenceByProperty, state.webEvidenceByProperty),
        decisionReasons: generateDecisionReasons({
          currentPreferences: state.preferences,
          preferenceWeights: state.engine.weights,
          rankedProperties: state.properties,
          rankedResults: state.engine.results,
          geoEvidenceByProperty: state.geoEvidenceByProperty,
        }),
      }, userId);
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
  const winnerWebEvidence = state.webEvidenceByProperty[winner.propertyId];
  const winnerExternalCoverage = externalEvidenceCoverage(winnerWebEvidence, { educationApplicable: state.preferences?.educationNeed !== "none" });
  const hasInvalidInputs = state.engine.results.some((result) => result.confidence.invalidInputFields.length > 0);
  const winningReasons = state.preferences ? generateDecisionReasons({
    currentPreferences: state.preferences,
    preferenceWeights: state.engine.weights,
    rankedProperties: state.properties,
    rankedResults: state.engine.results,
    geoEvidenceByProperty: state.geoEvidenceByProperty,
  }) : [];
  const decisionSummary = buildDecisionSummary(winningReasons);
  const comparisons = buildQuickComparison(state.properties, state.engine.results, state.geoEvidenceByProperty, state.preferences ?? undefined);

  return (
    <>
      {winnerProperty && (
        <section className="card mt-7 overflow-hidden">
          <div className="bg-[linear-gradient(135deg,#f8f6ef_0%,#eef3eb_100%)] p-6 sm:p-8">
            <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">当前最适合您的房源</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h2 className="font-serif text-3xl sm:text-4xl">{winnerProperty.name}</h2>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${RECOMMENDATION_BADGE_STYLES[winner.recommendation]}`}>{winner.recommendation} · {RECOMMENDATION_LABELS[winner.recommendation]}</span>
                </div>
                <p className="mt-4 text-base leading-8 text-[#60655e]">“{decisionSummary}”</p>
              </div>
              <div className="flex items-center gap-4 rounded-2xl bg-white/75 p-4 shadow-sm">
                <div className="text-right"><span className="text-[13px] text-[#8a8c87]">当前匹配度</span><b className="mt-1 block font-serif text-4xl text-[#607158]">{winner.overallScore ?? "—"}<small className="ml-1 text-base">{winner.overallScore !== null ? "%" : ""}</small></b><small className="text-xs text-[#92948f]">基于当前已知信息</small></div>
              </div>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
              <PriceBlock label="挂牌价" value={winnerProperty.listingPrice} />
              <PriceBlock label="预期成交价" value={winnerProperty.totalPrice} emphasized />
            </div>
            {winnerProperty.listingPrice && <p className="mt-3 text-[13px] leading-5 text-[#777b74]">挂牌与预期成交相差约 {Math.abs(Math.round(winnerProperty.listingPrice - winnerProperty.totalPrice))} 万元（{Math.abs(((winnerProperty.listingPrice - winnerProperty.totalPrice) / winnerProperty.listingPrice) * 100).toFixed(1)}%），仅为当前决策假设差额。</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#ebe8e0] px-6 py-4 text-[13px] text-[#7a7d77] sm:px-8">
            <span>已确认信息 {winner.confidence.dataCompletenessPercent}%</span>
            <span>外部证据覆盖 {winnerExternalCoverage.completed}/{winnerExternalCoverage.total}</span>
            <span>本次判断 {state.engine.effectiveComparableDimensions?.length ?? 0} 个可比维度</span>
            <span>分析日期 {state.engine.asOfDate}</span>
            {state.engine.rankingProvisional && <span className="rounded-full bg-[#efe8d9] px-3 py-1 text-[#806b3e]">阶段性排序</span>}
          </div>
        </section>
      )}

      {hasInvalidInputs && <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#e8ddc8] bg-[#fbf7ee] p-4 text-sm leading-6 text-[#78684a]"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>部分输入内容较少，未纳入当前分析。补充具体名称可提高可信度。</p></div>}

      {state.preferences && <AIAnalysisPanel properties={state.properties} preferences={state.preferences} engine={state.engine} geoEvidenceByProperty={state.geoEvidenceByProperty} webEvidenceByProperty={state.webEvidenceByProperty} />}

      {winningReasons.length > 0 && <section className="mt-6"><SectionHeading eyebrow="Decision reasons" title="为什么更适合您" description="结合您的购房偏好、当前权重和候选房源的实际差异，以下是该房源排名第一的主要原因。" /><div className="mt-4 grid gap-4 md:grid-cols-3">{winningReasons.map((reason, index) => <article key={reason.title} className="card p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className="grid size-8 place-items-center rounded-full bg-[#eef2eb] text-sm font-semibold text-[#607158]">{index + 1}</span>{reason.label && <span className="rounded-full bg-[#f3f4ef] px-2.5 py-1 text-xs font-medium text-[#677360]">{reason.label}</span>}</div><h3 className="mt-4 text-[17px] font-semibold">{reason.title}</h3><p className="mt-2 text-[15px] leading-[1.7] text-[#6d706b]">{reason.description}</p></article>)}</div></section>}

      <section className="mt-6">
        <SectionHeading eyebrow="Quick comparison" title="候选房源快速比较" />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {comparisons.map((item) => <ComparisonCard key={item.property.id} item={item} />)}
        </div>
      </section>

      <details className="card group mt-6 p-6 sm:p-7">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#75886d]">Detailed evidence</p><h2 className="mt-1 font-serif text-2xl">查看完整 15 维分析</h2><p className="mt-2 text-sm leading-6 text-[#7b7e78]">按房源查看全部维度、证据来源、权重与仍需确认的信息。</p></div><ChevronDown className="shrink-0 text-[#75886d] transition group-open:rotate-180" /></summary>
        <div className="mt-5 grid gap-3 border-t border-[#eceae5] pt-5 sm:grid-cols-2 lg:grid-cols-3">{comparisons.map((item) => <Link key={item.property.id} href={`/results/${item.property.id}`} className="flex items-center justify-between rounded-xl bg-[#f7f6f2] p-4 text-sm font-medium text-[#607158]"><span>第 {item.rank} 位 · {item.property.name}</span><ArrowRight size={16} /></Link>)}</div>
      </details>

      <section className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#e3e5de] bg-[#f7f9f5] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">保存当前决策快照</h2>
          <p className="mt-1 text-sm leading-6 text-[#747772]">保存当前房源、购房偏好和分析结果，后续资料变化不会影响这份记录。</p>
          {saveStatus === "error" && <p className="mt-2 text-[13px] text-[#9a5d50]">保存失败，请检查浏览器存储空间后重试。</p>}
        </div>
        <Button type="button" onClick={handleSaveDecision} disabled={saveStatus === "saved"} className="shrink-0">
          {saveStatus === "saved" ? <Check size={16} /> : <Save size={16} />}
          {saveStatus === "saved" ? "已保存" : "保存本次决策"}
        </Button>
      </section>

    </>
  );
}

function PriceBlock({ label, value, emphasized = false }: { label: string; value: number | null | undefined; emphasized?: boolean }) {
  return <div className={`rounded-xl border p-4 ${emphasized ? "border-[#cfd8ca] bg-white" : "border-[#e3ded2] bg-[#fbf8f1]"}`}><span className="text-xs text-[#858882]">{label}</span><b className={`mt-1 block font-serif text-2xl ${emphasized ? "text-[#53674d]" : "text-[#655f52]"}`}>{value ?? "未填写"}{value ? <small className="ml-1 text-sm">万</small> : null}</b></div>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#75886d]">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl">{title}</h2>{description && <p className="mt-2 text-sm leading-6 text-[#7b7e78]">{description}</p>}</div>;
}

function ComparisonCard({ item }: { item: ReturnType<typeof buildQuickComparison>[number] }) {
  const recommendation = RECOMMENDATION_LABELS[item.result.recommendation];
  return <Link href={`/results/${item.property.id}`} className={`card p-4 transition hover:-translate-y-0.5 sm:p-5 ${item.rank === 1 ? "ring-1 ring-[#aebda8]" : ""}`}><div className="flex items-start justify-between gap-3"><div><span className="text-[13px] font-medium text-[#75886d]">第 {item.rank} 位</span><h3 className="mt-1 text-lg font-semibold">{item.property.name}</h3></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${RECOMMENDATION_BADGE_STYLES[item.result.recommendation]}`}>{item.result.overallScore ?? "—"}% · {recommendation}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><CompactFact label="挂牌价" value={item.property.listingPrice ? `${item.property.listingPrice} 万` : "未填写"} /><CompactFact label="预期成交" value={`${item.property.totalPrice} 万`} /><CompactFact label="面积 / 户型" value={`${item.property.area}㎡ · ${item.property.layout}`} /><CompactFact label="家庭通勤" value={formatCommute(item.primaryCommuteMinutes, item.partnerCommuteMinutes)} /></div><div className="mt-4 space-y-2 border-t border-[#eceae5] pt-4 text-sm leading-6"><p><b className="text-[#607158]">优势：</b>{item.keyAdvantage}</p><p><b className="text-[#8a7046]">待确认：</b>{item.keyRisk}</p></div></Link>;
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="block text-[#92948f]">{label}</span><b className="mt-1 block truncate font-medium text-[#5f625d]">{value}</b></div>;
}

function formatCommute(primary: number | null, partner: number | null): string {
  if (primary !== null && partner !== null) return `本人约 ${primary} 分钟 · 伴侣约 ${partner} 分钟`;
  if (primary !== null) return `本人约 ${primary} 分钟`;
  if (partner !== null) return `伴侣约 ${partner} 分钟`;
  return "路线仍待确认";
}
