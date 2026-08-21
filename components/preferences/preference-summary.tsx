import { BriefcaseBusiness, GraduationCap, ListChecks, WalletCards } from "lucide-react";
import type {
  CommuteMode,
  SelectableCommuteMode,
  DecisionPriority,
  EducationNeed,
  EducationStage,
  PurchasePurpose,
} from "@/types/buyer-preferences";

export const PURCHASE_PURPOSE_LABELS: Record<PurchasePurpose, string> = {
  self_use: "自住优先",
  self_use_and_value: "自住兼顾长期价值",
  long_term_asset: "长期资产配置",
};

export const COMMUTE_MODE_LABELS: Record<CommuteMode, string> = {
  driving: "驾车",
  public_transit: "公共交通",
  walking: "步行",
  cycling: "骑行",
  flexible: "灵活选择",
  both: "驾车或公共交通",
  not_important: "通勤不重要",
};

export const EDUCATION_NEED_LABELS: Record<EducationNeed, string> = {
  none: "暂无教育需求",
  current: "当前有教育需求",
  future: "未来有教育需求",
};

export const EDUCATION_STAGE_LABELS: Record<EducationStage, string> = {
  kindergarten: "幼儿园",
  primary_school: "小学",
  middle_school: "初中",
  high_school: "高中",
};

export const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  commute: "通勤便利",
  price: "价格与购买安全边际",
  layout_and_space: "户型与空间",
  community_quality: "小区品质",
  property_management: "物业服务",
  education: "教育",
  commercial_amenities: "商业生活配套",
  public_transport: "轨道交通",
  liquidity: "流动性",
  value_preservation: "长期保值",
};

interface PreferenceSummaryProps {
  purchasePurpose: PurchasePurpose | "";
  maximumBudget: string;
  primaryWorkLocation: string;
  partnerWorkLocation: string;
  primaryCommuteMode: SelectableCommuteMode | "";
  primaryIdealCommuteMinutes: string;
  primaryMaxCommuteMinutes: string;
  partnerCommuteMode: SelectableCommuteMode | "";
  partnerIdealCommuteMinutes: string;
  partnerMaxCommuteMinutes: string;
  educationNeed: EducationNeed | "";
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
}

function SummaryItem({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-white/15 py-5 last:border-0">
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/25 text-[#e5dfca]">{icon}</span>
      <div>
        <p className="text-xs tracking-[0.16em] text-white/50">{label}</p>
        <div className="mt-1 text-sm leading-6 text-white/85">{children}</div>
      </div>
    </div>
  );
}

export function PreferenceSummary(props: PreferenceSummaryProps) {
  const commuteText = props.primaryCommuteMode
    ? props.primaryCommuteMode === "not_important"
      ? COMMUTE_MODE_LABELS.not_important
      : `${COMMUTE_MODE_LABELS[props.primaryCommuteMode]} · ${props.primaryWorkLocation.trim() || "待填写地点"}${props.primaryIdealCommuteMinutes ? ` · 理想 ${props.primaryIdealCommuteMinutes} 分钟` : ""}${props.primaryMaxCommuteMinutes ? ` · 最长 ${props.primaryMaxCommuteMinutes} 分钟` : ""}${props.partnerWorkLocation.trim() ? ` / 伴侣：${props.partnerWorkLocation.trim()} · ${props.partnerCommuteMode ? COMMUTE_MODE_LABELS[props.partnerCommuteMode] : "待选方式"}${props.partnerIdealCommuteMinutes ? ` · 理想 ${props.partnerIdealCommuteMinutes} 分钟` : ""}${props.partnerMaxCommuteMinutes ? ` · 最长 ${props.partnerMaxCommuteMinutes} 分钟` : ""}` : ""}`
    : "待选择通勤方式";

  const educationText = props.educationNeed
    ? `${EDUCATION_NEED_LABELS[props.educationNeed]}${props.educationStages.length ? ` · ${props.educationStages.map((stage) => EDUCATION_STAGE_LABELS[stage]).join(" / ")}` : ""}`
    : "待选择教育需求";

  return (
    <aside className="rounded-[24px] bg-[#585851] p-6 text-[#f7f3e8] shadow-[0_20px_60px_rgba(44,43,38,0.12)] sm:p-8 lg:sticky lg:top-28">
      <p className="text-xs tracking-[0.18em] text-[#d9d1b9]">实时更新</p>
      <h2 className="mt-2 font-serif text-3xl">购房偏好摘要</h2>
      <p className="mt-3 text-sm leading-6 text-white/60">这里只归纳你当前填写的结构化偏好，不包含 AI 分析或房源评分。</p>
      <div className="mt-5">
        <SummaryItem icon={<BriefcaseBusiness size={18} />} label="购房目标">
          {props.purchasePurpose ? PURCHASE_PURPOSE_LABELS[props.purchasePurpose] : "待选择"}
        </SummaryItem>
        <SummaryItem icon={<WalletCards size={18} />} label="最高可接受总价">
          {props.maximumBudget && Number(props.maximumBudget) > 0 ? `${props.maximumBudget} 万元` : "待填写"}
        </SummaryItem>
        <SummaryItem icon={<BriefcaseBusiness size={18} />} label="家庭通勤">
          {commuteText}
        </SummaryItem>
        <SummaryItem icon={<GraduationCap size={18} />} label="教育需求">
          {educationText}
        </SummaryItem>
        <SummaryItem icon={<ListChecks size={18} />} label={`决策优先级 · ${props.topPriorities.length} / 3`}>
          {props.topPriorities.length
            ? props.topPriorities.map((priority, index) => `${index + 1}. ${PRIORITY_LABELS[priority]}`).join("　")
            : "待选择 3 项"}
        </SummaryItem>
      </div>
    </aside>
  );
}
