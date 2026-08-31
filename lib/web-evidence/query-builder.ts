import type { Property } from "@/types/property";
import type { DecisionPriority } from "@/types/buyer-preferences";
import { getPriorityDimensions } from "@/lib/decision/weights";
import type { WebEvidencePropertyIdentity, WebEvidenceQuery } from "./types";
import { WEB_EVIDENCE_TARGET_DIMENSIONS, type WebEvidenceDimensionKey } from "./types";

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
  return `web-v2-${hash(JSON.stringify(stableIdentity))}`;
}

function priorityOrder(topPriorities: readonly DecisionPriority[]): WebEvidenceDimensionKey[] {
  const ordered = topPriorities.flatMap((priority) => getPriorityDimensions(priority))
    .filter((key): key is WebEvidenceDimensionKey => WEB_EVIDENCE_TARGET_DIMENSIONS.includes(key as WebEvidenceDimensionKey));
  return [...new Set(ordered)];
}

export function buildPropertyWebQueries(
  identity: WebEvidencePropertyIdentity,
  topPriorities: readonly DecisionPriority[] = [],
): WebEvidenceQuery[] {
  const base = [identity.name, identity.city, identity.district].filter(Boolean).join(" ");
  const areaContext = identity.formattedAddress ? ` ${identity.formattedAddress}` : "";
  const queries: WebEvidenceQuery[] = [
    { dimensionKey: "location_maturity", query: `${base} 板块 规划 周边配套` },
    { dimensionKey: "community_quality", query: `${base} 容积率 绿化率 户数 楼栋` },
    { dimensionKey: "community_quality", query: `${base} 小区 户数 容积率 绿化率` },
    { dimensionKey: "property_management", query: `${base} 物业公司 物业费` },
    { dimensionKey: "property_management", query: `${base} 物业 服务` },
    { dimensionKey: "building_age", query: `${base} 交付时间 建成年份 竣工` },
    { dimensionKey: "building_age", query: `${base} 交房 年份` },
    { dimensionKey: "layout_design", query: `${base}${areaContext} 户型 朝向 梯户比` },
    { dimensionKey: "education", query: `${base} 招生范围 对口学校 教育局` },
    { dimensionKey: "transaction_price_reasonableness", query: `${base} 二手房 成交 成交价` },
    { dimensionKey: "transaction_price_reasonableness", query: `${base} 近一年 成交价` },
    { dimensionKey: "liquidity", query: `${base} 二手挂牌 成交 套数` },
    { dimensionKey: "liquidity", query: `${base} 在售 二手房` },
    { dimensionKey: "value_preservation", query: `${base} 已建成 产业 交通 真实成交 区域现状` },
  ];
  const preferred = priorityOrder(topPriorities);
  const dimensionRank = new Map(preferred.map((dimension, index) => [dimension, index]));
  return [...new Map(queries.map((item) => [`${item.dimensionKey}:${clean(item.query)}`, item])).values()]
    .sort((left, right) => {
      const leftRank = dimensionRank.get(left.dimensionKey) ?? preferred.length;
      const rightRank = dimensionRank.get(right.dimensionKey) ?? preferred.length;
      return leftRank - rightRank;
    });
}
