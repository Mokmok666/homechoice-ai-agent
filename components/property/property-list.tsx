"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, MapPin, Pencil, Plus, Trash2, TrainFront } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteProperty, getProperties, MAX_PROPERTIES } from "@/lib/property-storage";
import type { Property, PropertyStatus } from "@/types/property";

const STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: "Draft",
  pending_analysis: "Waiting for AI Analysis",
  analyzing: "Analyzing",
  completed: "Analysis Completed",
  failed: "Analysis Failed",
};

const STATUS_STYLES: Record<PropertyStatus, string> = {
  draft: "bg-[#f0efeb] text-[#686a66]",
  pending_analysis: "bg-[#eef2eb] text-[#5e7356]",
  analyzing: "bg-[#f5f0e5] text-[#806b3e]",
  completed: "bg-[#e7f1ea] text-[#477056]",
  failed: "bg-[#f8eae7] text-[#984f45]",
};

export function PropertyList() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setProperties(getProperties());
    setIsLoading(false);
  }, []);

  function handleDelete(property: Property) {
    if (!window.confirm(`确定删除“${property.name}”吗？`)) return;
    setProperties(deleteProperty(property.id));
  }

  if (isLoading) {
    return (
      <div className="mt-8 grid gap-5 lg:grid-cols-2" aria-label="正在加载房源">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-56 animate-pulse rounded-[20px] border border-black/[0.06] bg-white/60" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#e5e3dd] bg-white/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">已添加 {properties.length} / {MAX_PROPERTIES} 套候选房源</p>
          <p className="mt-1 text-xs text-[#858782]">房源保存在当前浏览器中，清除浏览器数据后将无法恢复。</p>
        </div>
        {properties.length < MAX_PROPERTIES ? (
          <Button asChild className="shrink-0 bg-white text-[#353833] ring-1 ring-[#dbdad5] hover:bg-[#f4f3ee]">
            <Link href="/properties/new"><Plus size={18} /> 添加房源</Link>
          </Button>
        ) : (
          <Button type="button" disabled className="shrink-0 bg-[#ebeae5] text-[#969792] disabled:cursor-not-allowed">已达到 5 套上限</Button>
        )}
      </div>

      {properties.length === 0 ? (
        <Card className="mt-8 grid min-h-80 place-items-center p-8 text-center">
          <div>
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#f0f2ed] text-[#687b60]"><Building2 size={28} /></span>
            <h2 className="mt-5 text-xl font-semibold">还没有候选房源</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#777a75]">添加第一套房源，统一记录价格、位置、户型和生活配套信息。</p>
            <Button asChild className="mt-6"><Link href="/properties/new"><Plus size={17} /> 添加房源</Link></Button>
          </div>
        </Card>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {properties.map((property) => (
            <Card key={property.id} className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgba(58,55,46,0.08)]">
              <article className="grid min-h-56 sm:grid-cols-[190px_1fr]">
                <div className="relative min-h-44 overflow-hidden bg-[#ecebe6] sm:min-h-full">
                  {property.imageUrl ? (
                    <img src={property.imageUrl} alt={property.name} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,#f7f5ef,#dfdfd7)] text-[#899183]"><Building2 size={44} strokeWidth={1.3} /></div>
                  )}
                </div>

                <div className="flex min-w-0 flex-col p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold">{property.name}</h2>
                      <p className="mt-2 flex items-start gap-2 text-sm text-[#737671]">
                        <MapPin size={15} className="mt-0.5 shrink-0" />
                        <span>{property.city} · {property.district} · {property.address}</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium ${STATUS_STYLES[property.status]}`}>{STATUS_LABELS[property.status]}</span>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[#eceae5] py-4">
                    <div><span className="block text-xs text-[#92938f]">总价</span><b className="mt-1 block font-serif text-xl text-[#53674d]">{property.totalPrice} 万</b></div>
                    <div><span className="block text-xs text-[#92938f]">面积</span><b className="mt-1 block text-sm">{property.area}㎡</b></div>
                    <div><span className="block text-xs text-[#92938f]">户型</span><b className="mt-1 block text-sm">{property.layout}</b></div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-[#757873]">
                    <span>{property.floor}</span>
                    <span className="flex items-center gap-1.5"><TrainFront size={14} />{property.metroDistance === null ? "地铁距离待补充" : `距地铁约 ${property.metroDistance} 米`}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Link href={`/properties/new?id=${property.id}`} className="inline-flex size-9 items-center justify-center rounded-full border border-[#dfddd7] transition hover:bg-[#f2f1ec]" aria-label={`编辑 ${property.name}`}><Pencil size={15} /></Link>
                      <button type="button" onClick={() => handleDelete(property)} className="inline-flex size-9 items-center justify-center rounded-full border border-[#eadedb] text-[#9b5a50] transition hover:bg-[#fcf2f0]" aria-label={`删除 ${property.name}`}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              </article>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
