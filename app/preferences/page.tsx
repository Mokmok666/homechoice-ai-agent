import { BuyerPreferencesForm } from "@/components/preferences/buyer-preferences-form";
import { DemoBanner } from "@/components/demo/demo-banner";

export default function PreferencesPage() {
  return (
    <main className="page">
      <div className="max-w-3xl">
        <p className="text-xs tracking-[0.18em] text-[#74846e]">PHASE 2 · BUYER PREFERENCES</p>
        <h1 className="display mt-3">设置我的偏好</h1>
        <p className="sub">告诉我们家庭的购买目标、资金边界与生活需求，为后续可解释的房源比较建立依据。</p>
      </div>
      <DemoBanner page="preferences" />
      <BuyerPreferencesForm />
    </main>
  );
}
