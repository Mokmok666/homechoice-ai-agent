import Link from "next/link";
import { ArrowRight, Building2, MapPin, Sparkles } from "lucide-react";
import { ScoreRing } from "@/components/decision/score-ring";
import type { PropertyDecisionResult } from "@/types/decision";
import type { Property } from "@/types/property";

const ANALYSIS_CONFIDENCE_LABELS = { provisional: "阶段性", supported: "较充分" } as const;
const RECOMMENDATION_LABELS = {
  CONSIDER: "优先考虑",
  WAIT: "谨慎考虑",
  PASS: "暂不推荐",
} as const;

const RECOMMENDATION_STYLES = {
  CONSIDER: "bg-[#e7f1ea] text-[#477056]",
  WAIT: "bg-[#f5f0e5] text-[#806b3e]",
  PASS: "bg-[#f8e9e6] text-[#934f45]",
} as const;

export function DecisionPropertyCard({
  property,
  result,
  rank,
  externalEvidenceCoverage,
}: {
  property: Property;
  result: PropertyDecisionResult;
  rank: number;
  externalEvidenceCoverage: { completed: number; total: number };
}) {
  const completeness = result.confidence.dataCompleteness;
  return (
    <Link href={`/results/${property.id}`} className="card flex h-full min-w-0 flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgba(58,55,46,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <span className="rounded-full bg-[#eef2eb] px-3 py-1 text-xs font-medium text-[#5c7055]">当前第 {rank} 位</span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${RECOMMENDATION_STYLES[result.recommendation]}`}>{result.recommendation} · {RECOMMENDATION_LABELS[result.recommendation]}</span>
      </div>

      <div className="mt-5 flex min-w-0 items-start gap-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#f0f1ec] text-[#75886d]"><Building2 size={28} /></div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{property.name}</h2>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-[#7d807a]"><MapPin size={14} className="mt-0.5 shrink-0" />{property.city} · {property.district}</p>
          <p className="mt-2 text-sm text-[#696c67]">{property.layout} · {property.area}㎡ · {property.floor}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_76px] items-end gap-4 border-t border-[#eceae5] pt-5">
        <div className="min-w-0">
          <p className="text-[11px] text-[#92938f]">预期成交价</p>
          <p className="mt-1 whitespace-nowrap font-serif text-2xl text-[#53674d]">{property.totalPrice}<small className="ml-1 text-sm">万</small></p>
          {property.listingPrice && <p className="mt-1 text-[11px] text-[#9a9b97]">挂牌价 {property.listingPrice} 万</p>}
        </div>
        {result.overallScore === null ? (
          <div className="grid size-[76px] place-items-center rounded-full border border-dashed border-[#d9d8d2] text-center text-[11px] leading-4 text-[#8a8c87]">阶段性<br />判断</div>
        ) : (
          <ScoreRing score={result.overallScore} size={76} label="当前匹配" />
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-[#f7f6f2] p-3 text-xs">
        <div><span className="block text-[#92938f]">数据完整度</span><b className="mt-1 block">{result.confidence.dataCompletenessPercent}%</b></div>
        <div><span className="block text-[#92938f]">分析可信度</span><b className="mt-1 block">{ANALYSIS_CONFIDENCE_LABELS[result.confidence.analysisConfidence]}</b></div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] leading-4 text-[#777a74]">
        <span>基础 {completeness.sections.basic}/60</span>
        <span>生活 {completeness.sections.living}/20</span>
        <span>决策 {completeness.sections.decision}/20</span>
      </div>

      <div className="mt-4 space-y-1.5 text-xs leading-5 text-[#747772]">
        <p>✓ 已确认信息 {result.confidence.recordedInputs.length} 项</p>
        <p>○ 外部证据覆盖 {externalEvidenceCoverage.completed} / {externalEvidenceCoverage.total}</p>
        <p className="flex items-start gap-1.5 text-[#896e42]"><Sparkles size={13} className="mt-1 shrink-0" />可进一步确认 {result.confidence.improvementInputs.length} 项</p>
      </div>
      <span className="mt-auto flex items-center gap-2 pt-5 text-sm text-[#617359]">查看依据与行动建议 <ArrowRight size={15} /></span>
    </Link>
  );
}
