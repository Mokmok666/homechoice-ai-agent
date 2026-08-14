import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full resize-y rounded-[10px] border border-[#deddd8] bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-[#a1a29e] focus:border-[#7d8f75] focus:ring-4 focus:ring-[#7d8f75]/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
