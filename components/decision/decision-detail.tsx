"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Database, HelpCircle, Sparkles } from "lucide-react";
import { ScoreRing } from "@/components/decision/score-ring";
import { refreshGeoEvidenceForProperties } from "@/lib/amap/evidence-client";
import { loadBuyerPreferences } from "@/lib/buyer-preferences-storage";
import { DIMENSION_LABELS, DIMENSION_TYPE_LABELS, DIMENSION_TYPES } from "@/lib/decision/dimensions";
import { runDecisionEngine } from "@/lib/decision/engine";
import { loadCachedGeoEvidenceForProperties } from "@/lib/geo-evidence-storage";
import { getProperties } from "@/lib/property-storage";
import { RECOMMENDATION_BADGE_STYLES, RECOMMENDATION_LABELS } from "@/lib/recommendation-presentation";
import { loadCachedWebEvidenceForProperties } from "@/lib/web-evidence-storage";
import { refreshWebEvidenceForProperties } from "@/lib/web-evidence/client";
import { externalEvidenceCoverageDetails, externalEvidenceCoverageDimensions, mergeWebEvidenceIntoEngine } from "@/lib/web-evidence/merge";
import type { WebEvidenceStatus } from "@/lib/web-evidence/types";
import type { DimensionEvaluation, PropertyDecisionResult } from "@/types/decision";
import type { Property } from "@/types/property";
import type { PropertyWebEvidence } from "@/lib/web-evidence/types";

const ANALYSIS_CONFIDENCE_LABELS = { provisional: "阶段性", supported: "较充分" } as const;
function dimensionStatusLabel(dimension: DimensionEvaluation, webStatus?: WebEvidenceStatus): string {
  if (dimension.key === "value_preservation") return dimension.status === "unknown" ? "结构派生 · 证据不足" : "结构派生";
  if (webStatus === "verified") return "公开来源 · 已核验";
  if (webStatus === "partial") return "公开来源 · 部分证据";
  if (dimension.evidence.some((item) => item.source === "amap")) {
    return dimension.status === "known" ? "高德已核验" : "部分证据";
  }
  if (DIMENSION_TYPES[dimension.key] === "ai") return "AI分析";
  if (dimension.status === "known") return "已知";
  if (dimension.status === "partial") return "部分证据";
  return "可进一步确认";
}

function conciseSourceTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized;
}

interface DetailState {
  property: Property;
  result: PropertyDecisionResult;
  asOfDate: string;
  rankingProvisional: boolean;
  webEvidence: PropertyWebEvidence | null;
  educationApplicable: boolean;
}

export function DecisionDetail({ propertyId }: { propertyId: string }) {
  const [state, setState] = useState<DetailState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const properties = getProperties().filter((property) => property.source === "manual");
    const property = properties.find((item) => item.id === propertyId);
    if (!property) {
      setMessage("该房源已被删除、不可用，或属于不参与真实分析的演示数据。");
      return () => controller.abort();
    }
    const preferences = loadBuyerPreferences();
    if (preferences.status !== "valid") {
      setMessage("购房偏好不可用，请重新保存偏好后再查看分析。");
      return () => controller.abort();
    }
    const asOfDate = new Date().toISOString().slice(0, 10);
    try {
      const cachedGeoEvidence = loadCachedGeoEvidenceForProperties(properties, preferences.preferences);
      const cachedWebEvidence = loadCachedWebEvidenceForProperties(properties);
      let latestGeoEvidence = { ...cachedGeoEvidence };
      let latestWebEvidence = { ...cachedWebEvidence };
      let latestEngine = runDecisionEngine({
        properties,
        preferences: preferences.preferences,
        asOfDate,
        geoEvidenceByProperty: cachedGeoEvidence,
        webEvidenceByProperty: cachedWebEvidence,
      });
      const engine = mergeWebEvidenceIntoEngine(latestEngine, cachedWebEvidence);
      const result = engine.results.find((item) => item.propertyId === propertyId);
      if (!result) {
        setMessage("该房源没有可用的分析结果。");
        return () => controller.abort();
      }
      setState({ property, result, asOfDate, rankingProvisional: engine.rankingProvisional, webEvidence: cachedWebEvidence[property.id] ?? null, educationApplicable: preferences.preferences.educationNeed !== "none" });
      const refreshOrder = [property, ...properties.filter((item) => item.id !== property.id)];
      void refreshGeoEvidenceForProperties(refreshOrder, preferences.preferences, (updatedPropertyId, evidence) => {
        if (controller.signal.aborted) return;
        latestGeoEvidence = { ...latestGeoEvidence, [updatedPropertyId]: evidence };
        latestEngine = runDecisionEngine({
          properties,
          preferences: preferences.preferences,
          asOfDate,
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        });
        const progressivelyUpdatedEngine = mergeWebEvidenceIntoEngine(latestEngine, latestWebEvidence);
        const progressivelyUpdatedResult = progressivelyUpdatedEngine.results.find((item) => item.propertyId === propertyId);
        if (progressivelyUpdatedResult) setState({
          property,
          result: progressivelyUpdatedResult,
          asOfDate,
          rankingProvisional: progressivelyUpdatedEngine.rankingProvisional,
          webEvidence: latestWebEvidence[property.id] ?? null,
          educationApplicable: preferences.preferences.educationNeed !== "none",
        });
      })
        .then((geoEvidenceByProperty) => {
          if (controller.signal.aborted) return;
          latestEngine = runDecisionEngine({
            properties,
            preferences: preferences.preferences,
            asOfDate,
            geoEvidenceByProperty,
            webEvidenceByProperty: latestWebEvidence,
          });
          const engineWithGeoEvidence = mergeWebEvidenceIntoEngine(latestEngine, latestWebEvidence);
          const resultWithGeoEvidence = engineWithGeoEvidence.results.find((item) => item.propertyId === propertyId);
          if (resultWithGeoEvidence) {
            setState({
              property,
              result: resultWithGeoEvidence,
              asOfDate,
              rankingProvisional: engineWithGeoEvidence.rankingProvisional,
              webEvidence: latestWebEvidence[property.id] ?? null,
              educationApplicable: preferences.preferences.educationNeed !== "none",
            });
          }
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === "AbortError")) {
            // AMap evidence is optional; keep the base Decision Engine result.
          }
        });
      void refreshWebEvidenceForProperties(properties, (updatedPropertyId, evidence) => {
        if (controller.signal.aborted) return;
        latestWebEvidence = { ...latestWebEvidence, [updatedPropertyId]: evidence };
        latestEngine = runDecisionEngine({
          properties,
          preferences: preferences.preferences,
          asOfDate,
          geoEvidenceByProperty: latestGeoEvidence,
          webEvidenceByProperty: latestWebEvidence,
        });
        const engineWithWebEvidence = mergeWebEvidenceIntoEngine(latestEngine, latestWebEvidence);
        const updatedResult = engineWithWebEvidence.results.find((item) => item.propertyId === propertyId);
        if (updatedResult) setState({
          property,
          result: updatedResult,
          asOfDate,
          rankingProvisional: engineWithWebEvidence.rankingProvisional,
          webEvidence: latestWebEvidence[property.id] ?? null,
          educationApplicable: preferences.preferences.educationNeed !== "none",
        });
      }, controller.signal).catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          // Public Web evidence is optional; keep cached and deterministic evidence.
        }
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成房源分析。");
    }
    return () => controller.abort();
  }, [propertyId]);

  if (message) {
    return (
      <main className="page">
        <Link href="/results" className="pill w-fit"><ArrowLeft size={16} />返回分析结果</Link>
        <section className="card mt-8 grid min-h-80 place-items-center p-8 text-center">
          <div><AlertCircle size={36} className="mx-auto text-[#9a684f]" /><h1 className="mt-5 text-2xl font-semibold">房源分析不可用</h1><p className="mt-3 text-sm leading-7 text-[#747772]">{message}</p></div>
        </section>
      </main>
    );
  }
  if (!state) return <main className="page"><div className="card h-80 animate-pulse" aria-label="正在加载详细分析" /></main>;

  const { property, result } = state;
  const confirmedEvidence = result.confidence.evidenceItems.filter((item) => item.category === "confirmed");
  const optionalEvidence = result.confidence.evidenceItems.filter((item) => item.category === "optional_confirmation");
  const completeness = result.confidence.dataCompleteness;
  const coverageOptions = { educationApplicable: state.educationApplicable };
  const coverage = externalEvidenceCoverageDetails(state.webEvidence ?? undefined, coverageOptions);
  const coverageDimensions = externalEvidenceCoverageDimensions(coverageOptions);
  const coveredDimensions = state.webEvidence?.dimensions.filter((item) => coverageDimensions.includes(item.dimensionKey) && item.status !== "unavailable" && item.facts.length > 0) ?? [];
  return (
    <main className="page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="display text-[38px]">详细分析</h1><p className="sub">真实结构化证据 / {property.name}</p></div>
        <Link className="pill h-11 w-fit" href="/results"><ArrowLeft size={16} />返回推荐列表</Link>
      </div>

      <section className="card mt-6 p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-semibold">{property.name}</h2><span className={`rounded-full px-4 py-2 text-xs font-medium ${RECOMMENDATION_BADGE_STYLES[result.recommendation]}`}>{result.recommendation} · {RECOMMENDATION_LABELS[result.recommendation]}</span>{state.rankingProvisional && <span className="rounded-full bg-[#efeee9] px-4 py-2 text-xs">阶段性排序</span>}</div>
            <p className="mt-3 text-sm text-[#727570]">{property.city} · {property.district} · {property.address}</p>
            <p className="mt-3 text-sm text-[#555]">{property.area}㎡ · {property.layout} · {property.floor} · 预期成交价 {property.totalPrice} 万{property.listingPrice ? ` · 挂牌价 ${property.listingPrice} 万` : ""}</p>
          </div>
          <div className="flex items-center gap-5">
            {result.overallScore === null ? <div className="grid size-28 place-items-center rounded-full border border-dashed border-[#d9d8d2] text-center text-sm text-[#868983]">当前信息<br />阶段性判断</div> : <ScoreRing score={result.overallScore} size={120} label="当前匹配" />}
            <div className="text-sm"><p className="text-[#92938f]">当前匹配度</p><b className="mt-1 block text-2xl text-[#617359]">{result.overallScore ?? "阶段性"}</b><small className="mt-1 block text-[#92938f]">基于当前已知信息</small></div>
          </div>
        </div>

        <div className="mt-7 grid gap-4 border-t border-[#eceae5] pt-6 sm:grid-cols-3">
          <div className="rounded-xl bg-[#f7f6f2] p-4"><span className="text-xs text-[#92938f]">数据完整度</span><b className="mt-2 block text-xl">{result.confidence.dataCompletenessPercent}%</b><small className="mt-2 block leading-5 text-[#858782]">基础 {completeness.sections.basic}/60 · 生活 {completeness.sections.living}/20 · 决策 {completeness.sections.decision}/20</small></div>
          <div className="rounded-xl bg-[#f7f6f2] p-4"><span className="text-xs text-[#92938f]">分析可信度</span><b className="mt-2 block text-xl">{ANALYSIS_CONFIDENCE_LABELS[result.confidence.analysisConfidence]}</b></div>
          <div className="rounded-xl bg-[#f7f6f2] p-4"><span className="text-xs text-[#92938f]">分析日期</span><b className="mt-2 block text-xl">{state.asOfDate}</b></div>
        </div>
      </section>

      <section className="card mt-5 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl"><Sparkles className="text-[#75886d]" />分析状态</h2>
        {result.confidence.invalidInputFields.length > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#e8ddc8] bg-[#fbf7ee] p-4 text-sm leading-6 text-[#78684a]">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>部分输入信息内容较少，未纳入当前分析计算。补充具体名称可以提高分析可信度。</p>
          </div>
        )}
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl bg-[#f5f8f3] p-5"><h3 className="font-semibold text-[#607158]">已确认信息</h3><ul className="mt-3 space-y-3 text-xs leading-5 text-[#686b66]">{confirmedEvidence.map((item) => <li key={item.id}><b>✓ {item.title}</b><span className="mt-0.5 block text-[#858782]">{item.description}</span></li>)}</ul></div>
          <div className="rounded-xl bg-[#f7f4ed] p-5"><h3 className="font-semibold text-[#806b3e]">外部证据覆盖（{coverage.completed}/{coverage.total}）</h3><ul className="mt-3 space-y-3 text-xs leading-5 text-[#746b59]">{coveredDimensions.map((item) => <li key={item.dimensionKey}><b>○ {DIMENSION_LABELS[item.dimensionKey]}</b><span className="mt-0.5 block text-[#8a806d]">{item.status === "verified" ? "已有可靠公开来源支持" : "已有公开来源，仍需交叉核验"}</span></li>)}</ul>{coverage.uncovered.length > 0 && <p className="mt-3 text-xs leading-5 text-[#8a806d]">尚未覆盖：{coverage.uncovered.map((key) => DIMENSION_LABELS[key]).join("、")}</p>}</div>
          <div className="rounded-xl bg-[#f7f6f2] p-5"><h3 className="font-semibold">可进一步确认</h3><ul className="mt-3 space-y-3 text-xs leading-5 text-[#686b66]">{optionalEvidence.map((item) => <li key={item.id}><b>△ {item.title}</b><span className="mt-0.5 block text-[#858782]">{item.description}</span></li>)}</ul></div>
        </div>
      </section>

      <section className="card mt-5 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4"><div><h2 className="font-serif text-2xl">15 维证据明细</h2><p className="mt-2 text-xs text-[#83857f]">分数仅在证据足够时显示；权重来自购房目的与 Top 3 优先级。</p></div><Database className="text-[#75886d]" /></div>
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {result.dimensions.map((dimension) => {
            const webDimension = state.webEvidence?.dimensions.find((item) => item.dimensionKey === dimension.key);
            const hasWebEvidence = Boolean(webDimension && webDimension.status !== "unavailable" && webDimension.facts.length > 0);
            const isWebTarget = coverageDimensions.includes(dimension.key as never);
            return <article key={dimension.key} className="rounded-xl border border-[#e8e6e0] p-4">
              <div className="flex items-center justify-between gap-4"><div><h3 className="font-medium">{DIMENSION_LABELS[dimension.key]}</h3><p className="mt-1 text-[11px] text-[#93948f]">{dimension.key === "value_preservation" ? "结构派生" : dimension.evidence.some((item) => item.source === "amap") ? "高德地图证据" : dimension.evidence.some((item) => item.source === "web") ? "公开来源证据" : DIMENSION_TYPE_LABELS[DIMENSION_TYPES[dimension.key]]} · 最终权重 {dimension.finalWeight.toFixed(1)}%</p></div><div className="text-right"><b className="text-xl text-[#617359]">{dimension.score ?? "—"}</b><span className="ml-2 rounded-full bg-[#f1f0eb] px-2 py-1 text-[10px] text-[#737570]">{dimensionStatusLabel(dimension, webDimension?.status)}</span></div></div>
              {dimension.score !== null && <div className="progress mt-3"><span style={{ width: `${dimension.score}%` }} /></div>}
              {dimension.evidence.length > 0 && <ul className="mt-3 space-y-1 text-xs leading-5 text-[#6f726d]">{dimension.evidence.map((item) => <li key={`${item.source}-${item.description}`} className="flex gap-2"><CheckCircle2 size={13} className="mt-1 shrink-0 text-[#75886d]" />{item.description}</li>)}</ul>}
              {hasWebEvidence && webDimension && <details className="mt-3 text-xs text-[#617359]"><summary className="w-fit cursor-pointer select-none font-medium">查看来源 →</summary><ul className="mt-2 space-y-2 rounded-lg bg-[#f7f8f5] p-3 text-[#6f726d]">{webDimension.facts.slice(0, 2).map((fact) => <li key={fact.sourceUrl} className="leading-5"><a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-[#617359] underline decoration-[#bdc7b8] underline-offset-2">{conciseSourceTitle(fact.sourceTitle)}</a><span className="block text-[10px] text-[#92948f]">{fact.sourceDomain ?? "公开来源"}{fact.publishedAt ? ` · ${fact.publishedAt.slice(0, 10)}` : ""}</span></li>)}</ul></details>}
              {!hasWebEvidence && isWebTarget && !(dimension.status === "known" && dimension.missingInputs.length === 0) && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#8a7046]"><HelpCircle size={13} className="mt-1 shrink-0" />当前暂无可用公开来源，仍需进一步核验。</p>}
              {!isWebTarget && dimension.missingInputs.length > 0 && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#8a7046]"><HelpCircle size={13} className="mt-1 shrink-0" />{dimension.key === "value_preservation" || dimension.evidence.some((item) => item.source === "amap") || DIMENSION_TYPES[dimension.key] !== "ai" ? "可进一步确认" : "AI分析"}：{dimension.missingInputs.join("、")}</p>}
            </article>;
          })}
        </div>
      </section>

      <section className="card mt-5 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl"><Clock3 className="text-[#75886d]" />决策影响因素</h2>
        <p className="mt-2 text-xs leading-5 text-[#777a74]">当前推荐已经生成；可进一步确认的信息只影响可信度，不是继续分析的前置条件。</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">{result.decisionFactors.map((factor) => <li key={factor} className="rounded-xl bg-[#faf8f3] p-4 text-sm leading-6">{factor}</li>)}</ul>
        {result.hardMismatches.length > 0 && <ul className="mt-5 space-y-3">{result.hardMismatches.map((item) => <li key={item.dimension} className="rounded-xl bg-[#fcf2f0] p-4 text-sm text-[#934f45]">{item.reason}</li>)}</ul>}
        <p className="mt-5 text-sm leading-7 text-[#656862]">{result.reasons.join(" ")}</p>
      </section>
    </main>
  );
}
