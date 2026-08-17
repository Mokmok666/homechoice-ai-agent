import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  MapPin,
  MessageCircle,
  RefreshCcw,
  ShoppingBag,
  Tag,
} from "lucide-react";
import { PropertyImage } from "@/components/property/property-image";
import { ScoreRing } from "@/components/decision/score-ring";
import { properties } from "@/lib/mock-data";

export default function ResultsPage() {
  const winner = properties[0];

  return (
    <main className="page">
      <div className="flex justify-between">
        <div>
          <h1 className="display">分析结果</h1>
          <p className="sub">基于你的候选房源与偏好，AI 给出当前最适合你的建议。</p>
        </div>
        <Link href="/preferences" className="pill h-12">
          <RefreshCcw size={16} />重新分析
        </Link>
      </div>

      <div className="mt-8 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        {properties.map((property, index) => (
          <Link
            href={`/results/${property.id}`}
            key={property.id}
            className={`card flex h-full min-w-0 flex-col overflow-hidden p-4 ${index === 0 ? "border-[#74886d] ring-1 ring-[#74886d]" : ""}`}
          >
            <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-xl">
              <PropertyImage src={property.image} alt={property.name} />
              {index === 0 && (
                <span className="absolute left-0 top-0 rounded-br-lg bg-[#74886d] px-3 py-1 text-xs text-white">
                  AI 推荐
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col pt-4">
              <h2 className="truncate text-lg font-semibold">{property.name}</h2>
              <p className="mt-2 text-sm text-[#858782]">
                {property.layout} · {property.area}㎡ · {property.floor}
              </p>
              <p className="mt-2 flex items-center gap-1 text-xs text-[#858782]">
                <MapPin size={14} className="shrink-0" />{property.district}
              </p>
              <div className="mt-auto grid grid-cols-[minmax(0,1fr)_72px] items-end gap-3 pt-5">
                <div className="min-w-0">
                  <p className="text-[11px] text-[#92938f]">预期成交价</p>
                  <p className="mt-1 whitespace-nowrap text-xl">
                    {property.price.expected}<small className="text-sm"> 万</small>
                  </p>
                  <p className="mt-1 text-[11px] text-[#a09f9a]">挂牌价 {property.price.listing} 万</p>
                </div>
                <div className="flex justify-end">
                  <ScoreRing score={property.score} size={72} />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="desktop-grid mt-7 grid grid-cols-[1.8fr_.85fr] gap-7">
        <section className="card p-7">
          <h2 className="font-serif text-2xl">AI 推荐：<span className="sage">{winner.name}</span></h2>
          <div className="mt-5 flex items-center gap-9">
            <div className="font-serif text-[86px] leading-none sage">84<small className="text-xl text-black"> 分</small></div>
            <div>
              <p className="text-lg">综合表现最优，能更好地满足你在地段、通勤与生活便利性上的需求。</p>
              <div className="mt-5 flex flex-wrap gap-3">
                {winner.tags.map((tag, index) => (
                  <span className="pill" key={tag}>
                    {index === 0 ? <MapPin size={18} /> : index === 1 ? <Clock3 size={18} /> : <ShoppingBag size={18} />} {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <hr className="my-6 border-[#e9e6df]" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#e5e2dc] p-5"><Clock3 className="inline" /> <span className="ml-3">建议：<b className="text-xl sage">WAIT</b></span></div>
            <div className="rounded-xl border border-[#e5e2dc] p-5"><Tag className="inline" /> <span className="ml-3">理想成交区间：<b className="text-xl sage">{winner.price.ideal}</b></span></div>
          </div>
          <div className="mt-5 rounded-xl bg-[#faf4eb] p-4 text-sm text-[#87693d]"><b>主要风险：</b>当前预期成交价略高于近期同类成交中位水平，建议保留议价空间。</div>
          <Link href={`/results/${winner.id}`} className="mt-5 inline-flex items-center gap-2 sage">查看 15 维详细分析 <ArrowRight size={16} /></Link>
        </section>
        <aside className="card p-7">
          <h2 className="font-serif text-2xl">✦ 继续问 AI</h2>
          <div className="mt-6 space-y-3">
            {["如果我以后去广州工作呢？", "如果价格再降 10 万呢？", "如果我更看重保值呢？", "如果未来需要小学学位呢？"].map((question) => (
              <Link href="/chat" key={question} className="flex items-center rounded-xl border border-[#e6e3dc] p-4 text-sm">
                <MessageCircle className="mr-3" size={18} />{question}<ArrowRight className="ml-auto" size={16} />
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
