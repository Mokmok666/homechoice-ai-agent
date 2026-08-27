import { BarChart3, Home, LockKeyhole, UserRound } from "lucide-react";
import { DemoCta } from "@/components/demo/demo-cta";
import { PropertyImage } from "@/components/property/property-image";
import { properties } from "@/lib/mock-data";

export default function HomePage() {
  const steps = [
    [Home, "01", "放入候选房源", "支持手动录入，一次添加 3–5 套"],
    [UserRound, "02", "理解你的偏好", "预算、通勤与家庭生活方式"],
    [BarChart3, "03", "给出明确建议", "解释优劣并给出购买条件"],
  ] as const;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-black/5">
        <div className="page relative min-h-[440px]">
          <div className="relative z-10 max-w-[700px] pt-8">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f2f0ec] px-4 py-2 text-xs">⌘ 用数据与 AI，做更明智的房产选择</span>
            <h1 className="display mt-7 text-[58px]">帮你选出更适合的一套房</h1>
            <p className="mt-5 max-w-[600px] text-lg leading-8 text-[#626560]">放入 3–5 套候选房源，AI 将基于预算、通勤、家庭需求、居住体验与长期价值进行客观分析，给出清晰的对比与建议。</p>
            <DemoCta />
            <div className="mt-4 flex gap-2 text-xs text-[#999b97]"><LockKeyhole size={14} />你的信息仅用于分析，不会对外公开</div>
          </div>
          <div className="absolute inset-y-0 right-0 hidden w-[52%] bg-[url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=85')] bg-cover bg-center lg:block"><div className="absolute inset-0 bg-gradient-to-r from-[#faf9f6] via-[#faf9f6]/35 to-transparent" /></div>
        </div>
      </section>

      <div className="page -mt-2">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(([Icon, number, title, description]) => <div className="card flex items-center gap-5 p-6" key={number}><span className="grid size-16 place-items-center rounded-full bg-[#f2f0ec]"><Icon size={29} /></span><div><span className="text-[#a8a696]">{number}</span><h3 className="mt-1 text-lg font-medium">{title}</h3><p className="mt-1 text-sm text-[#7d7f7a]">{description}</p></div></div>)}
        </div>
        <section className="card mt-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><span className="rounded-full bg-[#eef2eb] px-3 py-1 text-xs font-medium text-[#607158]">示例展示</span><h2 className="section-title mt-3">比较体验预览 · 示例数据</h2></div>
            <p className="text-sm text-[#858782]">以下内容仅用于展示产品界面，不代表实时市场信息。</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {properties.map((property, index) => <div key={property.id} className="overflow-hidden rounded-xl border border-[#e5e3dd]"><div className="relative h-32"><PropertyImage src={property.image} alt={property.name} /><span className="absolute left-2 top-2 rounded-full bg-[#3e3d37]/80 px-3 py-1 text-xs text-white">候选 {index + 1}</span></div><div className="p-3"><b>{property.name}</b><p className="mt-1 text-xs text-[#777]">{property.layout} · {property.area}㎡ · {property.floor}</p><p className="sage mt-2 text-sm">预期成交价 {property.price.expected} 万</p><p className="mt-1 text-xs text-[#999]">挂牌价 {property.price.listing} 万</p></div></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
