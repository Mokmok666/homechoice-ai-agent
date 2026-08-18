import { DecisionDetail } from "@/components/decision/decision-detail";

export default async function DetailPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <DecisionDetail propertyId={propertyId} />;
}
