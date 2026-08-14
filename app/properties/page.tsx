import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { PropertyList } from "@/components/property/property-list";
import { Button } from "@/components/ui/button";

export default function PropertiesPage() {
  return (
    <main className="page">
      <div>
        <h1 className="display">我的房源</h1>
        <p className="sub">管理 3–5 套候选房源，统一记录位置、价格、户型和生活配套信息。</p>
      </div>

      <PropertyList />

      <div className="mt-10 text-center">
        <Button asChild className="h-14 w-full max-w-[430px] text-base">
          <Link href="/preferences">下一步：设置我的偏好 <ArrowRight size={18} /></Link>
        </Button>
        <div className="privacy">
          <LockKeyhole size={14} />
          最多比较 5 套房源，减少决策过载
        </div>
      </div>
    </main>
  );
}
