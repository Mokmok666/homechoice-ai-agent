import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { DecisionResults } from "@/components/decision/decision-results";
import { DemoBanner } from "@/components/demo/demo-banner";

export default function ResultsPage() {
  return (
    <main className="page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="display">分析结果</h1>
          <p className="sub">根据当前房源、家庭偏好与可验证证据生成的阶段性决策支持。</p>
        </div>
        <Link href="/preferences" className="pill h-12 w-fit"><RefreshCcw size={16} />调整偏好并重算</Link>
      </div>
      <DemoBanner page="results" />
      <DecisionResults />
    </main>
  );
}
