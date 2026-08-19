import { AlertTriangle, BriefcaseBusiness, Building2, MapPinned, ShieldQuestion, ShoppingBag, TrainFront, TrendingUp } from "lucide-react";
import type { PropertyIntelligence } from "@/types/property-intelligence";
import type { Property } from "@/types/property";

interface PropertyIntelligenceCardProps {
  property: Property;
  intelligence: PropertyIntelligence;
}

export function PropertyIntelligenceCard({ property, intelligence }: PropertyIntelligenceCardProps) {
  const sections = [
    { icon: MapPinned, title: "区域定位", text: `${intelligence.locationProfile.cityLevel} ${intelligence.locationProfile.districtPosition} ${intelligence.locationProfile.developmentStage}` },
    { icon: BriefcaseBusiness, title: "产业就业", text: `${intelligence.industry.industries.join("、")}。${intelligence.industry.employmentOpportunity}` },
    { icon: ShoppingBag, title: "商业成熟度", text: intelligence.lifestyle.commercialMaturity },
    { icon: TrainFront, title: "交通便利", text: intelligence.lifestyle.transportation },
    { icon: Building2, title: "小区品质", text: intelligence.lifestyle.communityQuality },
    { icon: TrendingUp, title: "流动性", text: intelligence.assetValue.liquidity },
    { icon: TrendingUp, title: "长期价值", text: intelligence.assetValue.preservationPotential },
  ];

  return (
    <article className="card overflow-hidden">
      <div className="border-b border-[#ebe8e0] bg-[#f7f8f4] p-5 sm:p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-[#75886d]">Property Intelligence</p>
        <h3 className="mt-2 font-serif text-2xl">{property.name}</h3>
        <p className="mt-2 text-xs leading-5 text-[#777a74]">用户确认：{property.city} · {property.district} · {property.area}㎡ · 预期成交价 {property.totalPrice} 万</p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2 sm:p-6">
        {sections.map(({ icon: Icon, title, text }) => (
          <section key={title} className="rounded-xl border border-[#e9e7e0] p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} className="text-[#718169]" />{title}</h4>
            <p className="mt-2 text-xs leading-6 text-[#6d706a]">{text}</p>
          </section>
        ))}
        <section className="rounded-xl border border-[#e9e7e0] p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><ShoppingBag size={16} className="text-[#718169]" />日常便利</h4>
          <p className="mt-2 text-xs leading-6 text-[#6d706a]">{intelligence.lifestyle.dailyConvenience}</p>
        </section>
      </div>
      <div className="grid gap-4 border-t border-[#ebe8e0] bg-[#fbfaf7] p-5 md:grid-cols-2 sm:p-6">
        <section><h4 className="flex items-center gap-2 text-sm font-semibold text-[#806b3e]"><AlertTriangle size={16} />风险提示</h4><ul className="mt-3 space-y-2 text-xs leading-5 text-[#706c62]">{intelligence.risks.risks.map((risk) => <li key={risk}>• {risk}</li>)}</ul></section>
        <section><h4 className="flex items-center gap-2 text-sm font-semibold text-[#607158]"><ShieldQuestion size={16} />需要核实</h4><ul className="mt-3 space-y-2 text-xs leading-5 text-[#6d706a]">{intelligence.risks.verificationPoints.map((point) => <li key={point}>• {point}</li>)}</ul></section>
      </div>
      <p className="border-t border-[#ebe8e0] px-5 py-4 text-[11px] leading-5 text-[#8a8d87] sm:px-6">本内容是基于已提供房源信息和一般性地理知识生成的 AI 房产评估，不代表实时市场检索结果；重要事实请进一步核实。</p>
    </article>
  );
}
