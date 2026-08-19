import { DecisionHistoryDetail } from "@/components/history/decision-history-detail";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ historyId: string }>;
}) {
  const { historyId } = await params;
  return <DecisionHistoryDetail historyId={historyId} />;
}
