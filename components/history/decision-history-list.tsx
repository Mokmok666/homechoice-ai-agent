"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, Home, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteDecisionHistory, getDecisionHistory } from "@/lib/decision-history-storage";
import { RECOMMENDATION_BADGE_STYLES, RECOMMENDATION_LABELS } from "@/lib/recommendation-presentation";
import type { DecisionHistoryRecord } from "@/types/decision-history";

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DecisionHistoryList() {
  const [records, setRecords] = useState<DecisionHistoryRecord[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DecisionHistoryRecord | null>(null);

  useEffect(() => setRecords(getDecisionHistory()), []);

  if (records === null) return <div className="card h-64 animate-pulse" aria-label="正在加载决策记录" />;

  if (records.length === 0) {
    return (
      <section className="card grid min-h-80 place-items-center p-8 text-center">
        <div className="max-w-md">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#f1f3ed] text-[#687a61]"><Clock3 size={28} /></span>
          <h2 className="mt-5 text-xl font-semibold">还没有保存过决策</h2>
          <p className="mt-3 text-[15px] leading-7 text-[#777a74]">完成一次房源分析后，这里会保存你的选择依据，方便之后回顾。</p>
          <Link href="/results" className="pill mx-auto mt-6 w-fit">前往分析结果 <ArrowRight size={16} /></Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="space-y-4">
        {records.map((record) => {
        const topResult = record.decisionResult.results[0];
        const topProperty = record.properties.find((property) => property.id === record.recommendedPropertyId);
        return (
          <article key={record.id} className="card grid gap-5 p-5 sm:p-6 lg:grid-cols-[190px_1fr_250px] lg:items-center">
            <div className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#f1efeb] text-[#74816d]"><CalendarDays size={21} /></span>
              <div><p className="text-[13px] text-[#8a8d87]">保存时间</p><p className="mt-1 text-[15px] font-medium">{formatSavedAt(record.createdAt)}</p></div>
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-serif text-xl">{record.title}</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-[#747772]"><Home size={15} />{record.properties.length} 套房源 · 分析日期 {record.decisionResult.asOfDate}</p>
            </div>
            <div>
              <div className="rounded-xl bg-[#f5f5f1] p-3 text-sm">
                <span className="flex items-center gap-2 text-[13px] text-[#687a61]"><Star size={14} />当时首选</span>
                <b className="mt-1 block truncate">{topProperty?.name ?? "暂无明确首选"}</b>
                {topResult && <p className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-medium ${RECOMMENDATION_BADGE_STYLES[topResult.recommendation]}`}>{RECOMMENDATION_LABELS[topResult.recommendation]} · 匹配度 {topResult.overallScore ?? "—"}</p>}
              </div>
              <div className="mt-3 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setPendingDelete(record)} className="inline-flex items-center gap-1.5 text-[13px] text-[#9b5a50] transition hover:text-[#7f4038]" aria-label={`删除 ${record.title}`}><Trash2 size={14} />删除</button>
                <Link href={`/history/${record.id}`} className="flex items-center gap-2 text-sm text-[#617359]">查看历史快照 <ArrowRight size={15} /></Link>
              </div>
            </div>
          </article>
        );
        })}
      </section>

      {pendingDelete && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/25 p-5 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="delete-history-title">
          <div className="w-full max-w-sm rounded-2xl border border-black/[0.06] bg-[#fffefa] p-6 shadow-[0_24px_70px_rgba(45,42,35,0.2)]">
            <span className="grid size-11 place-items-center rounded-full bg-[#f8eae7] text-[#984f45]"><Trash2 size={20} /></span>
            <h2 id="delete-history-title" className="mt-4 text-xl font-semibold">删除该决策记录？</h2>
            <p className="mt-2 text-sm leading-6 text-[#747772]">删除后将无法在本浏览器中恢复，但不会影响当前房源和购房偏好。</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" onClick={() => setPendingDelete(null)} className="bg-white text-[#4f544d] ring-1 ring-[#ddddd6] hover:bg-[#f4f3ee]">取消</Button>
              <Button type="button" onClick={() => {
                setRecords(deleteDecisionHistory(pendingDelete.id));
                setPendingDelete(null);
              }} className="bg-[#9b5a50] text-white hover:bg-[#864a42]">删除</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
