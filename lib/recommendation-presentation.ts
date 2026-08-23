import type { Recommendation } from "@/types/decision";

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  CONSIDER: "优先考虑",
  WAIT: "谨慎考虑",
  PASS: "暂不推荐",
};

export const RECOMMENDATION_BADGE_STYLES: Record<Recommendation, string> = {
  CONSIDER: "bg-[#e7f1ea] text-[#477056]",
  WAIT: "bg-[#f5eddc] text-[#80682f]",
  PASS: "bg-[#f7e8e5] text-[#914f46]",
};

export const RECOMMENDATION_TEXT_STYLES: Record<Recommendation, string> = {
  CONSIDER: "text-[#477056]",
  WAIT: "text-[#80682f]",
  PASS: "text-[#914f46]",
};
