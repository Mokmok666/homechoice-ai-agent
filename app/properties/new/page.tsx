import { PropertyForm } from "@/components/property/property-form";

export default function NewPropertyPage() {
  return (
    <main className="page max-w-[1120px]">
      <h1 className="display">添加房源</h1>
      <p className="sub">手动记录候选房源的关键信息。保存后即可生成阶段性分析。</p>
      <PropertyForm />
    </main>
  );
}
