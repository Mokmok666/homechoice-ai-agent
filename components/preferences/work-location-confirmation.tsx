"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfirmedWorkLocation } from "@/types/buyer-preferences";

interface WorkLocationCandidate {
  poiId?: string;
  name: string;
  formattedAddress: string;
  province?: string;
  city?: string;
  district?: string;
  lng: number;
  lat: number;
}

interface WorkLocationConfirmationProps {
  id: string;
  label: string;
  required?: boolean;
  keyword: string;
  confirmedLocation: ConfirmedWorkLocation | null;
  error?: string;
  onKeywordChange: (value: string) => void;
  onConfirm: (location: ConfirmedWorkLocation | null) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function WorkLocationConfirmation({
  id, label, required = false, keyword, confirmedLocation, error, onKeywordChange, onConfirm,
}: WorkLocationConfirmationProps) {
  const [candidates, setCandidates] = useState<WorkLocationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  async function searchLocations() {
    if (keyword.trim().length < 2) {
      setSearchError("请输入至少 2 个字的工作地点关键词。");
      return;
    }
    setLoading(true);
    setSearchError("");
    setCandidates([]);
    try {
      const response = await fetch("/api/amap/work-location-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim() }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload) || !Array.isArray(payload.candidates)) {
        const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message : "暂时无法查找工作地点，请稍后重试。";
        setSearchError(message);
        return;
      }
      const next = payload.candidates as WorkLocationCandidate[];
      setCandidates(next);
      if (next.length === 0) setSearchError("没有找到匹配地点，请输入更具体的公司、园区或地标名称。");
    } catch {
      setSearchError("暂时无法查找工作地点，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function confirm(candidate: WorkLocationCandidate) {
    onKeywordChange(candidate.name);
    onConfirm({
      ...candidate,
      source: "amap",
      confirmedByUser: true,
      confirmedAt: new Date().toISOString(),
    });
    setCandidates([]);
    setSearchError("");
  }

  function reset(clearKeyword = false) {
    onConfirm(null);
    if (clearKeyword) onKeywordChange("");
    setCandidates([]);
    setSearchError("");
  }

  return (
    <div className="sm:col-span-2">
      <Label htmlFor={id}>{label}{required ? " *" : ""}</Label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <MapPin size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
          <Input id={id} className="pl-11" value={keyword} onChange={(event) => {
            onKeywordChange(event.target.value); onConfirm(null); setCandidates([]); setSearchError("");
          }} placeholder="例如：千灯湖、珠江新城、某某科技园" aria-invalid={Boolean(error)} />
        </div>
        <Button type="button" className="h-12 border border-[#9cac94] bg-white text-[#5f7357] hover:bg-[#f2f5f0] sm:w-36" onClick={() => void searchLocations()} disabled={loading || !keyword.trim()}>
          {loading ? <><Loader2 size={16} className="animate-spin" /> 正在查找</> : <><Search size={16} /> 查找位置</>}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-[#a34f43]" role="alert">{error}</p>}
      {searchError && <p className="mt-3 rounded-lg bg-[#fff7f5] px-4 py-3 text-sm text-[#934b40]">{searchError}</p>}

      {confirmedLocation && <div className="mt-3 rounded-xl border border-[#aebaa8] bg-[#f4f7f2] p-4">
        <div className="flex items-start justify-between gap-4">
          <div><p className="flex items-center gap-2 text-sm font-semibold text-[#53664d]"><CheckCircle2 size={16} /> 已确认工作地点</p><p className="mt-2 font-medium">{confirmedLocation.name}</p><p className="mt-1 text-xs leading-5 text-[#72766f]">{confirmedLocation.formattedAddress}</p></div>
          <Button type="button" className="h-9 bg-transparent px-3 text-[#65775e] hover:bg-white" onClick={() => reset()}><X size={15} /> 重新选择</Button>
        </div>
      </div>}

      {candidates.length > 0 && <div className="mt-3 space-y-2">
        {candidates.map((candidate) => <div key={candidate.poiId ?? `${candidate.name}-${candidate.lng}-${candidate.lat}`} className="flex flex-col gap-3 rounded-xl border border-[#e4e2dc] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium">{candidate.name}</p><p className="mt-1 text-xs leading-5 text-[#747871]">{candidate.formattedAddress}</p><p className="mt-1 text-[11px] text-[#92948f]">{[candidate.city, candidate.district].filter(Boolean).join(" · ")}</p></div>
          <Button type="button" className="h-9 border border-[#9cac94] bg-white px-4 text-[#5f7357] hover:bg-[#f2f5f0]" onClick={() => confirm(candidate)}>选择此位置</Button>
        </div>)}
      </div>}
      {!required && keyword && <button type="button" className="mt-2 text-xs text-[#7b8277] hover:underline" onClick={() => reset(true)}>移除伴侣工作地点</button>}
    </div>
  );
}
