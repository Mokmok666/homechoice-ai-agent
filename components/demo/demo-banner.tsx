"use client";

import { useEffect, useState } from "react";
import { LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exitDemoMode, isDemoModeActive } from "@/lib/demo/demo-mode";

const COPY = {
  properties: { title: "当前正在使用示例数据", description: "仅用于演示产品流程，不代表实时挂牌或成交信息。" },
  preferences: { title: "当前使用示例购房偏好", description: "这组偏好可以自由修改，用于体验不同家庭取舍对结果的影响。" },
  results: { title: "示例数据 · 仅用于演示决策流程", description: "分数、排序与建议仍由当前决策规则和可用证据实时生成。" },
  history: { title: "当前正在使用示例数据", description: "已保存的决策记录不会因退出示例体验而删除。" },
} as const;

export function DemoBanner({ page }: { page: keyof typeof COPY }) {
  const [active, setActive] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setActive(isDemoModeActive()), []);
  if (!active) return null;

  const copy = COPY[page];
  return (
    <aside className="mt-5 flex flex-col gap-4 rounded-2xl border border-[#dfe5db] bg-[#f4f7f1] p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="示例体验状态">
      <div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#6d8065]"><Sparkles size={17} /></span><div><p className="text-sm font-semibold text-[#53664d]">{copy.title}</p><p className="mt-1 text-sm leading-6 text-[#747a71]">{copy.description}</p>{error && <p className="mt-1 text-sm text-[#9b5a50]" role="alert">{error}</p>}</div></div>
      <Button type="button" disabled={isExiting} onClick={async () => {
        setIsExiting(true);
        setError(null);
        try {
          await exitDemoMode();
          window.location.assign("/properties");
        } catch {
          setError("退出示例体验失败，请重试。");
          setIsExiting(false);
        }
      }} className="h-10 shrink-0 border border-[#d4d9d1] bg-white px-4 text-sm text-[#63705e] hover:bg-[#eef2eb]"><LogOut size={15} />{isExiting ? "正在退出…" : "退出示例体验"}</Button>
    </aside>
  );
}
