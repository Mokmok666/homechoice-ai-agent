import type { Property } from "@/types/property";
import type { WebEvidencePropertyIdentity, WebEvidenceQuery } from "./types";

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function projectWebEvidencePropertyIdentity(property: Property): WebEvidencePropertyIdentity {
  const confirmed = property.confirmedLocation?.confirmedByUser ? property.confirmedLocation : null;
  return {
    propertyId: property.id,
    name: clean(confirmed?.name ?? property.name),
    city: clean(confirmed?.city ?? property.city),
    district: clean(confirmed?.district ?? property.district),
    formattedAddress: clean(confirmed?.formattedAddress ?? property.address) || undefined,
    poiId: clean(confirmed?.poiId) || undefined,
    lng: confirmed?.lng,
    lat: confirmed?.lat,
  };
}

export function createPropertyIdentitySignature(identity: WebEvidencePropertyIdentity): string {
  const stableIdentity = identity.poiId
    ? ["poi", identity.poiId, identity.city, identity.district, identity.name]
    : ["location", identity.lng ?? null, identity.lat ?? null, identity.city, identity.district, identity.name];
  return `web-v1-${hash(JSON.stringify(stableIdentity))}`;
}

export function buildPropertyWebQueries(identity: WebEvidencePropertyIdentity): WebEvidenceQuery[] {
  const base = [identity.name, identity.city, identity.district].filter(Boolean).join(" ");
  return [
    { dimensionKey: "location_maturity", query: `${base} 板块 规划 周边配套` },
    { dimensionKey: "location_maturity", query: `${base} 区域发展 交通 公共服务` },
    { dimensionKey: "community_quality", query: `${base} 小区品质 开发商 项目交付` },
    { dimensionKey: "property_management", query: `${base} 物业公司 物业服务` },
    { dimensionKey: "transaction_price_reasonableness", query: `${base} 二手房 成交 成交价` },
    { dimensionKey: "liquidity", query: `${base} 二手房 挂牌 成交 近一年` },
    { dimensionKey: "value_preservation", query: `${base} 板块规划 产业 交通 区域发展` },
  ];
}
