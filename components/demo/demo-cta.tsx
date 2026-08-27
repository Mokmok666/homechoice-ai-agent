"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, PlayCircle } from "lucide-react";
import { useSupabaseAuth } from "@/components/providers/supabase-auth-provider";
import { Button } from "@/components/ui/button";
import { hasPersistedUserInput, initializeDemoMode } from "@/lib/demo/demo-mode";

export function DemoCta() {
  const router = useRouter();
  const { authReady, userId } = useSupabaseAuth();
  const [isPreparing, setIsPreparing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepareDemo(): Promise<void> {
    setIsPreparing(true);
    setError(null);
    try {
      await initializeDemoMode();
      router.push("/properties");
    } catch {
      setError("示例数据加载失败，请重试。");
      setIsPreparing(false);
    }
  }

  async function handleDemoClick(): Promise<void> {
    if (!authReady || isPreparing) return;
    setError(null);
    setIsPreparing(true);
    try {
      if (await hasPersistedUserInput(userId)) {
        setShowConfirmation(true);
        setIsPreparing(false);
        return;
      }
      await initializeDemoMode();
      router.push("/properties");
    } catch {
      setError("示例数据加载失败，请重试。");
      setIsPreparing(false);
    }
  }

  return (
    <>
      <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <Button asChild className="h-14 px-8 text-base sm:px-10">
          <Link href="/properties">开始我的房源分析 <ArrowRight size={18} /></Link>
        </Button>
        <Button type="button" onClick={() => void handleDemoClick()} disabled={!authReady || isPreparing} className="h-14 border border-[#ccd3c8] bg-white/75 px-8 text-base text-[#5d7056] hover:bg-[#f1f4ef] disabled:cursor-not-allowed disabled:opacity-60">
          <PlayCircle size={18} />{isPreparing ? "正在准备示例数据…" : "使用示例数据体验"}
        </Button>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#777b75]">自动载入3套示例房源与一组购房偏好，快速体验完整决策流程</p>
      {error && <p className="mt-2 text-sm text-[#9b5a50]" role="alert">{error}</p>}

      {showConfirmation && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/25 p-5 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="demo-confirmation-title">
          <div className="w-full max-w-md rounded-2xl border border-black/[0.06] bg-[#fffefa] p-6 shadow-[0_24px_70px_rgba(45,42,35,0.2)]">
            <span className="grid size-11 place-items-center rounded-full bg-[#eef2eb] text-[#607158]"><PlayCircle size={21} /></span>
            <h2 id="demo-confirmation-title" className="mt-4 text-xl font-semibold">进入示例体验？</h2>
            <p className="mt-2 text-sm leading-6 text-[#747772]">示例体验会临时展示3套示例房源和一组示例偏好。您的真实房源、偏好和决策记录不会被修改。</p>
            {error && <p className="mt-3 text-sm text-[#9b5a50]" role="alert">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" onClick={() => setShowConfirmation(false)} disabled={isPreparing} className="bg-white text-[#4f544d] ring-1 ring-[#ddddd6] hover:bg-[#f4f3ee]">取消</Button>
              <Button type="button" onClick={() => void prepareDemo()} disabled={isPreparing}>{isPreparing ? "正在准备示例数据…" : "进入示例体验"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
