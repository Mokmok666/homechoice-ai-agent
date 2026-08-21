"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfirmedPropertyLocation } from "@/types/property";

interface CityCandidate { name: string; province?: string; adcode?: string }
interface DistrictCandidate { name: string; adcode?: string }
interface LocationCandidate {
  poiId?: string;
  name: string;
  formattedAddress: string;
  province?: string;
  city: string;
  district: string;
  lng: number;
  lat: number;
}

interface LocationConfirmationProps {
  city: string;
  district: string;
  keyword: string;
  confirmedLocation: ConfirmedPropertyLocation | null;
  errors: { city?: string; district?: string; address?: string };
  onCityChange: (city: string) => void;
  onDistrictChange: (district: string) => void;
  onKeywordChange: (keyword: string) => void;
  onConfirm: (location: ConfirmedPropertyLocation | null) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function LocationConfirmation({
  city, district, keyword, confirmedLocation, errors,
  onCityChange, onDistrictChange, onKeywordChange, onConfirm,
}: LocationConfirmationProps) {
  const [cityQuery, setCityQuery] = useState(city);
  const [districtQuery, setDistrictQuery] = useState(district);
  const [cities, setCities] = useState<CityCandidate[]>([]);
  const [districts, setDistricts] = useState<DistrictCandidate[]>([]);
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [districtLoading, setDistrictLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [districtOpen, setDistrictOpen] = useState(false);

  useEffect(() => {
    const query = cityQuery.trim();
    if (!query || query === city) { setCities([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCityLoading(true);
      try {
        const response = await fetch("/api/amap/administrative", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ mode: "cities", keyword: query }),
        });
        const payload: unknown = await response.json().catch(() => null);
        setCities(response.ok && isRecord(payload) && Array.isArray(payload.cities) ? payload.cities as CityCandidate[] : []);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) setCities([]);
      } finally { if (!controller.signal.aborted) setCityLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cityQuery, city]);

  useEffect(() => {
    if (!city) { setDistricts([]); return; }
    const controller = new AbortController();
    setDistrictLoading(true);
    void fetch("/api/amap/administrative", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ mode: "districts", city }),
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(payload) && Array.isArray(payload.districts)) {
        setDistricts(payload.districts as DistrictCandidate[]);
      } else setDistricts([]);
    }).catch(() => setDistricts([])).finally(() => { if (!controller.signal.aborted) setDistrictLoading(false); });
    return () => controller.abort();
  }, [city]);

  const filteredDistricts = useMemo(() => {
    const query = districtQuery.trim();
    return districts.filter((item) => !query || item.name.includes(query)).slice(0, 12);
  }, [districtQuery, districts]);

  function chooseCity(candidate: CityCandidate) {
    setCityQuery(candidate.name);
    setCities([]);
    setDistrictQuery("");
    setCandidates([]);
    onConfirm(null);
    onCityChange(candidate.name);
  }

  function chooseDistrict(candidate: DistrictCandidate) {
    setDistrictQuery(candidate.name);
    setDistrictOpen(false);
    setCandidates([]);
    onConfirm(null);
    onDistrictChange(candidate.name);
  }

  async function searchLocations() {
    if (!city || !district || keyword.trim().length < 2) {
      setSearchError("请先选择城市和行政区，并输入至少 2 个字的房源或小区名称。");
      return;
    }
    setLocationLoading(true);
    setSearchError("");
    setCandidates([]);
    try {
      const response = await fetch("/api/amap/property-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, district, keyword: keyword.trim() }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload) || !Array.isArray(payload.candidates)) {
        const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message : "暂时无法查找位置，请稍后重试。";
        setSearchError(message);
        return;
      }
      const next = payload.candidates as LocationCandidate[];
      setCandidates(next);
      if (next.length === 0) setSearchError("没有找到匹配位置，请调整关键词后重试。");
    } catch { setSearchError("暂时无法查找位置，请稍后重试。"); }
    finally { setLocationLoading(false); }
  }

  function confirm(candidate: LocationCandidate) {
    onConfirm({ ...candidate, source: "amap", confirmedByUser: true, confirmedAt: new Date().toISOString() });
    setCandidates([]);
    setSearchError("");
  }

  return (
    <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
      <div className="relative">
        <Label htmlFor="city-search">城市 *</Label>
        <div className="relative mt-2">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
          <Input id="city-search" className="pl-10" value={cityQuery} onChange={(event) => {
            setCityQuery(event.target.value);
            if (event.target.value !== city) { onCityChange(""); onConfirm(null); }
          }} placeholder="搜索城市，例如杭州、成都" aria-invalid={Boolean(errors.city)} />
          {cityLoading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8f75]" />}
        </div>
        {errors.city && <p className="mt-2 text-xs text-[#a34f43]">{errors.city}</p>}
        {cities.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[#deddd8] bg-white p-1 shadow-lg">
          {cities.map((item) => <button type="button" key={`${item.adcode}-${item.name}`} onClick={() => chooseCity(item)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f3f5f1]"><span>{item.name}</span><span className="text-xs text-[#8a8d87]">{item.province}</span></button>)}
        </div>}
      </div>

      <div className="relative">
        <Label htmlFor="district-search">行政区 *</Label>
        <div className="relative mt-2">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
          <Input id="district-search" className="pl-10" value={districtQuery} disabled={!city} onFocus={() => setDistrictOpen(true)} onChange={(event) => {
            setDistrictOpen(true);
            setDistrictQuery(event.target.value);
            if (event.target.value !== district) { onDistrictChange(""); onConfirm(null); }
          }} placeholder={city ? "搜索或选择行政区" : "请先选择城市"} aria-invalid={Boolean(errors.district)} />
          {districtLoading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8f75]" />}
        </div>
        {errors.district && <p className="mt-2 text-xs text-[#a34f43]">{errors.district}</p>}
        {city && districtOpen && filteredDistricts.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[#deddd8] bg-white p-1 shadow-lg">
          {filteredDistricts.map((item) => <button type="button" key={`${item.adcode}-${item.name}`} onClick={() => chooseDistrict(item)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f3f5f1]">{item.name}</button>)}
        </div>}
      </div>

      <div className="lg:col-span-2">
        <Label htmlFor="property-keyword">房源 / 小区名称 *</Label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <MapPin size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
            <Input id="property-keyword" className="pl-11" value={keyword} onChange={(event) => {
              onKeywordChange(event.target.value); onConfirm(null); setCandidates([]); setSearchError("");
            }} placeholder="例如：保利天悦、大壮名城、某某家属院" aria-invalid={Boolean(errors.address)} />
          </div>
          <Button type="button" className="h-12 border border-[#9cac94] bg-white text-[#5f7357] hover:bg-[#f2f5f0] sm:w-36" onClick={() => void searchLocations()} disabled={locationLoading}>
            {locationLoading ? <><Loader2 size={16} className="animate-spin" /> 正在查找</> : <><Search size={16} /> 查找位置</>}
          </Button>
        </div>
        {errors.address && <p className="mt-2 text-xs text-[#a34f43]">{errors.address}</p>}
        <p className="mt-2 text-xs leading-5 text-[#777a74]">无需填写门牌号。确认后，后续位置分析将优先使用该高德位置。</p>
        {searchError && <p className="mt-3 rounded-lg bg-[#fff7f5] px-4 py-3 text-sm text-[#934b40]">{searchError}</p>}
      </div>

      {confirmedLocation ? <div className="lg:col-span-2 rounded-xl border border-[#aebaa8] bg-[#f4f7f2] p-5">
        <div className="flex items-start justify-between gap-4">
          <div><p className="flex items-center gap-2 text-sm font-semibold text-[#53664d]"><CheckCircle2 size={17} /> 已确认位置</p><p className="mt-2 font-medium text-[#252822]">{confirmedLocation.name}</p><p className="mt-1 text-sm text-[#6f736d]">{confirmedLocation.formattedAddress}</p></div>
          <Button type="button" className="h-9 bg-transparent px-3 text-[#65775e] hover:bg-white" onClick={() => onConfirm(null)}><X size={15} /> 重新选择</Button>
        </div>
      </div> : <div className="lg:col-span-2 rounded-xl border border-dashed border-[#d7d5ce] bg-[#faf9f6] px-5 py-4 text-sm text-[#777a74]">该房源尚未确认地图位置。仍可保存，但位置分析准确性可能较低。</div>}

      {candidates.length > 0 && <div className="lg:col-span-2 space-y-3">
        <p className="text-sm font-semibold text-[#31342f]">请选择正确的位置</p>
        {candidates.map((candidate) => <div key={candidate.poiId ?? `${candidate.name}-${candidate.lng}`} className="flex flex-col gap-4 rounded-xl border border-[#e4e2dc] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium text-[#252822]">{candidate.name}</p><p className="mt-1 text-sm text-[#747871]">{candidate.formattedAddress}</p><p className="mt-1 text-xs text-[#8b8e88]">{candidate.district}</p></div>
          <Button type="button" className="h-9 border border-[#9cac94] bg-white px-4 text-[#5f7357] hover:bg-[#f2f5f0]" onClick={() => confirm(candidate)}>选择此位置</Button>
        </div>)}
        <button type="button" className="text-sm text-[#6d8065] hover:underline" onClick={() => { setCandidates([]); setSearchError(""); }}>没有找到正确位置，重新填写</button>
      </div>}
    </div>
  );
}
