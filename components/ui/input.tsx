import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-[10px] border border-[#deddd8] bg-white px-4 text-sm outline-none transition placeholder:text-[#a1a29e] focus:border-[#7d8f75] focus:ring-4 focus:ring-[#7d8f75]/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
