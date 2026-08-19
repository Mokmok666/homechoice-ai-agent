"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Building2, CalendarDays, MapPin, Sparkles } from "lucide-react";
import { ScoreRing } from "@/components/decision/score-ring";
import { getDecisionHistoryById } from "@/lib/decision-history-storage";
import type { DecisionHistoryRecord } from "@/types/decision-history";

const RECOMMENDATION_LABELS = {
  CONSIDER: "优先考虑",
  WAIT: "谨慎考虑",
  PASS: "暂不推荐",
} as const;

export function DecisionHistoryDetail({ historyId }: { historyId: string }) {
  const [record, setRecord] = useState<DecisionHistoryRecord | null | undefined>(undefined);

  useEffect(() => setRecord(getDecisionHistoryById(historyId)), [historyId]);

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
      <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.18em] text-[#75886d]">Decision Snapshot</p><h1 className="display mt-2">{record.title}</h1><p className="sub flex items-center gap-2"><CalendarDays size={16} />保存于 {new Date(record.createdAt).toLocaleString("zh-CN")}</p></div>
        <span className="rounded-full bg-[#f1efe8] px-4 py-2 text-xs text-[#75776f]">只读历史快照</span>
      </div>

      {topResult && topProperty && (
        <section className="card mt-7 p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#75886d]">当时排序第一</p>
          <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-serif text-2xl">{topProperty.name}</h2><p className="mt-2 text-sm text-[#72756f]">{RECOMMENDATION_LABELS[topResult.recommendation]} · {topResult.reasons.join(" ")}</p></div>
            {topResult.overallScore === null ? <b className="text-[#75886d]">阶段性判断</b> : <ScoreRing score={topResult.overallScore} size={88} label="当时匹配" />}
          </div>
        </section>
      )}

      <section className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {record.decisionResult.results.map((result, index) => {
          const property = propertyById.get(result.propertyId);
          if (!property) return null;
          return (
            <article key={result.propertyId} className="card p-5">
              <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[#eef2eb] px-3 py-1 text-xs text-[#5c7055]">第 {index + 1} 位</span><b className="text-xs text-[#806b3e]">{result.recommendation} · {RECOMMENDATION_LABELS[result.recommendation]}</b></div>
              <div className="mt-5 flex gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#f1f2ed] text-[#75886d]"><Building2 size={23} /></span><div className="min-w-0"><h2 className="truncate font-semibold">{property.name}</h2><p className="mt-1 flex items-center gap-1 text-xs text-[#7d807a]"><MapPin size={13} />{property.city} · {property.district}</p></div></div>
              <p className="mt-4 text-sm text-[#696c67]">{property.layout} · {property.area}㎡ · 预期成交价 {property.totalPrice} 万</p>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#f7f6f2] p-3 text-xs"><span>匹配度 <b className="block text-lg">{result.overallScore ?? "—"}</b></span><span>完整度 <b className="block text-lg">{result.confidence.dataCompletenessPercent}%</b></span></div>
            </article>
          );
        })}
      </section>

      {record.aiOverallSummary && (
        <section className="card mt-7 p-6 sm:p-8"><h2 className="flex items-center gap-3 font-serif text-2xl"><Sparkles className="text-[#75886d]" />当时的 AI 解读摘要</h2><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#696c67]">{record.aiOverallSummary}</p></section>
      )}
    </main>
  );
}
