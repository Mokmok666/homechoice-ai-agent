import { PropertyForm } from "@/components/property/property-form";

export default function NewPropertyPage() {
  return (
    <main className="page max-w-[1120px]">
      <h1 className="display">添加房源</h1>
      <p className="sub">手动记录候选房源的关键信息。保存后将进入待分析状态。</p>
      <PropertyForm />
    </main>
  );
}
