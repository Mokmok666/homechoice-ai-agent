import { DecisionHistoryList } from "@/components/history/decision-history-list";

export default function HistoryPage() {
  return (
    <main className="page">
      <h1 className="display">决策记录</h1>
      <p className="sub">保存重要的房源比较结果，随时回看当时的选择依据。</p>
      <div className="mt-7"><DecisionHistoryList /></div>
    </main>
  );
}
