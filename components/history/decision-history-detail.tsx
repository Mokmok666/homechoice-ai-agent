"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Building2, CalendarDays, MapPin, Sparkles } from "lucide-react";
import { ScoreRing } from "@/components/decision/score-ring";
import { StructuredNarrative } from "@/components/ai/structured-narrative";
import { PropertyIntelligenceCard } from "@/components/intelligence/property-intelligence-card";
import { useSupabaseAuth } from "@/components/providers/supabase-auth-provider";
import { loadDecisionHistoryById } from "@/lib/decision-history-storage";
import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import { RECOMMENDATION_BADGE_STYLES, RECOMMENDATION_LABELS, RECOMMENDATION_TEXT_STYLES } from "@/lib/recommendation-presentation";
import type { DecisionHistoryRecord } from "@/types/decision-history";

function normalizeCommuteDurationCopy(value: string): string {
  return value
    .replace(/本人\s*(?:约)?\s*(\d+)\s*分(?!钟)/g, "本人约$1分钟")
    .replace(/伴侣\s*(?:约)?\s*(\d+)\s*分(?!钟)/g, "伴侣约$1分钟");
}

function historicalDimensionLabel(key: string): string {
  if (key === "daily_life_amenities") return "日常生活便利";
  if (key === "medical_amenities") return "医疗配套";
  return DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS] ?? key;
}

export function DecisionHistoryDetail({ historyId }: { historyId: string }) {
  const { authReady, userId } = useSupabaseAuth();
  const [record, setRecord] = useState<DecisionHistoryRecord | null | undefined>(undefined);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    void loadDecisionHistoryById(historyId, userId).then((loaded) => {
      if (active) setRecord(loaded);
    });
    return () => { active = false; };
  }, [authReady, historyId, userId]);

  if (record === undefined) return <main className="page"><div className="card h-80 animate-pulse" aria-label="正在加载历史决策" /></main>;
  if (record === null) {
    return (
      <main className="page">
        <Link href="/history" className="pill w-fit"><ArrowLeft size={16} />返回决策记录</Link>
        <section className="card mt-8 grid min-h-80 place-items-center p-8 text-center">
          <div><AlertCircle size={36} className="mx-auto text-[#9a684f]" /><h1 className="mt-5 text-2xl font-semibold">历史决策不可用</h1><p className="mt-3 text-sm text-[#747772]">该记录不存在、已被删除或数据格式无法读取。</p></div>
        </section>
      </main>
    );
  }

  const propertyById = new Map(record.properties.map((property) => [property.id, property]));
  const topResult = record.decisionResult.results[0];
  const topProperty = topResult ? propertyById.get(topResult.propertyId) : null;

  return (
    <main className="page">
      <Link href="/history" className="pill w-fit"><ArrowLeft size={16} />返回决策记录</Link>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.18em] text-[#75886d]">Decision Snapshot</p><h1 className="display mt-2">{record.title}</h1><p className="sub flex items-center gap-2"><CalendarDays size={16} />保存于 {new Date(record.createdAt).toLocaleString("zh-CN")}</p></div>
        <span className="rounded-full bg-[#f1efe8] px-4 py-2 text-xs text-[#75776f]">只读历史快照</span>
      </div>

      {topResult && topProperty && (
        <section className="card mt-6 p-6 sm:p-7">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">当时排序第一</p>
          <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-serif text-2xl">{topProperty.name}</h2><p className="mt-2 text-sm text-[#72756f]"><span className={`font-medium ${RECOMMENDATION_TEXT_STYLES[topResult.recommendation]}`}>{RECOMMENDATION_LABELS[topResult.recommendation]}</span> · 基于当时已确认事实和家庭偏好，该房源是当时排序最靠前的候选。</p></div>
            {topResult.overallScore === null ? <b className="text-[#75886d]">阶段性判断</b> : <ScoreRing score={topResult.overallScore} size={88} label="当时匹配" />}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {record.decisionResult.results.map((result, index) => {
          const property = propertyById.get(result.propertyId);
          if (!property) return null;
          return (
            <article key={result.propertyId} className="card p-5">
              <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[#eef2eb] px-3 py-1 text-xs text-[#5c7055]">第 {index + 1} 位</span><b className={`rounded-full px-2.5 py-1 text-xs ${RECOMMENDATION_BADGE_STYLES[result.recommendation]}`}>{result.recommendation} · {RECOMMENDATION_LABELS[result.recommendation]}</b></div>
              <div className="mt-5 flex gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#f1f2ed] text-[#75886d]"><Building2 size={23} /></span><div className="min-w-0"><h2 className="truncate text-[17px] font-semibold">{property.name}</h2><p className="mt-1 flex items-center gap-1 text-sm text-[#7d807a]"><MapPin size={13} />{property.city} · {property.district}</p></div></div>
              <p className="mt-4 text-[15px] text-[#696c67]">{property.layout} · {property.area}㎡</p>
              <div className="mt-3 rounded-xl bg-[#faf8f3] p-3 text-sm leading-6 text-[#696c67]">
                <span>挂牌价 <b>{property.listingPrice ?? "未记录"}{property.listingPrice ? " 万" : ""}</b></span>
                <span className="mx-2 text-[#a2a39f]">→</span>
                <span>预期成交价 <b>{property.totalPrice} 万</b></span>
                {property.listingPrice && property.listingPrice > 0 && (
                  <span className="mt-1 block text-[#858782]">当前决策假设差额约 {Math.abs(property.listingPrice - property.totalPrice).toFixed(1).replace(/\.0$/, "")} 万（{(Math.abs(property.listingPrice - property.totalPrice) / property.listingPrice * 100).toFixed(1)}%）</span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#f7f6f2] p-3 text-[13px]"><span>匹配度 <b className="block text-lg">{result.overallScore ?? "—"}</b></span><span>完整度 <b className="block text-lg">{result.confidence.dataCompletenessPercent}%</b></span></div>
            </article>
          );
        })}
      </section>

      <details className="card mt-6 p-6 sm:p-7">
        <summary className="cursor-pointer font-serif text-xl">查看当时保存的15维结果</summary>
        <p className="mt-2 text-sm leading-6 text-[#777a74]">以下内容直接读取保存时的只读快照，不会按当前规则重新计算。</p>
        <div className="mt-5 space-y-5">
          {record.decisionResult.results.map((result) => {
            const property = propertyById.get(result.propertyId);
            return (
              <section key={result.propertyId}>
                <h3 className="text-[17px] font-semibold">{property?.name ?? result.propertyId}</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {result.dimensions.map((dimension) => (
                    <div key={String(dimension.key)} className="flex items-center justify-between rounded-xl bg-[#f7f6f2] px-4 py-3 text-sm">
                      <span>{historicalDimensionLabel(String(dimension.key))}</span>
                      <b className="text-[#617359]">{dimension.score ?? "—"}</b>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </details>

      {record.aiOverallSummary && (
        <section className="card mt-6 p-6 sm:p-7">
          <h2 className="flex items-center gap-3 font-serif text-2xl"><Sparkles className="text-[#75886d]" />当时的 AI 解读摘要</h2>
          <StructuredNarrative value={normalizeCommuteDurationCopy(record.aiOverallSummary)} className="mt-4 leading-[1.75] text-[#696c67]" />
        </section>
      )}

      {record.decisionReasons && record.decisionReasons.length > 0 && (
        <section className="card mt-6 p-6 sm:p-7">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">Saved decision reasons</p>
          <h2 className="mt-2 font-serif text-2xl">当时的主要决策理由</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {record.decisionReasons.map((reason) => (
              <article key={`${reason.dimension}-${reason.title}`} className="rounded-xl bg-[#f7f6f2] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[17px] font-semibold">{reason.title}</h3>
                  {reason.label && <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[#687563]">{reason.label}</span>}
                </div>
                <p className="mt-2 text-[15px] leading-[1.7] text-[#70736e]">{normalizeCommuteDurationCopy(reason.description)}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {record.propertyIntelligence && record.propertyIntelligence.length > 0 && (
        <section className="mt-6">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[#75886d]">Saved Property Intelligence</p>
            <h2 className="mt-2 font-serif text-2xl">当时的房产智能分析</h2>
            <p className="mt-2 text-sm leading-6 text-[#777a74]">以下内容来自保存决策时的只读快照，不会根据当前房源资料重新生成。</p>
          </div>
          <div className="space-y-5">
            {record.propertyIntelligence.map((intelligence) => {
              const property = propertyById.get(intelligence.propertyId);
              return property ? (
                <PropertyIntelligenceCard
                  key={intelligence.propertyId}
                  property={property}
                  intelligence={intelligence}
                />
              ) : null;
            })}
          </div>
        </section>
      )}
    </main>
  );
}
