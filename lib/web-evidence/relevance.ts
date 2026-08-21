import { canonicalSourceDomain, sourceCredibility } from "./normalize";
import type {
  NormalizedWebSearchResult,
  WebEvidenceDimensionKey,
  WebEvidencePropertyIdentity,
} from "./types";

const DIMENSION_TERMS: Record<WebEvidenceDimensionKey, RegExp> = {
  location_maturity: /规划|板块|配套|交通|公共服务|区域|发展/,
  community_quality: /小区|社区|品质|开发商|项目|交付|园林|建筑/,
  property_management: /物业|服务|物业费|管理公司/,
  transaction_price_reasonableness: /成交|网签|成交价|二手房|挂牌|在售|报价/,
  liquidity: /成交|网签|二手房|挂牌|去化|流通|近一年/,
  value_preservation: /规划|产业|交通|区域发展|人口|就业|保值|长期/,
};

export function normalizePropertyName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s·•・･—–\-_，,。．()（）【】\[\]]+/g, "");
}

function normalizeAdmin(value: string): string {
  return normalizePropertyName(value).replace(/(?:特别行政区|自治州|自治区|省|市|区|县)$/g, "");
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|spm|from|source|ref)/i.test(key)) url.searchParams.delete(key);
    });
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch { return value.trim(); }
}

function containsAdmin(text: string, value: string): boolean {
  const normalized = normalizeAdmin(value);
  return normalized.length >= 2 && normalizePropertyName(text).includes(normalized);
}

function explicitAdministrativeConflict(text: string, identity: WebEvidencePropertyIdentity): boolean {
  const compact = normalizePropertyName(text);
  const expectedCity = normalizeAdmin(identity.city);
  const expectedDistrict = normalizeAdmin(identity.district);
  const cityMentions = text.match(/[\u4e00-\u9fa5]{2,8}市/g) ?? [];
  const districtMentions = text.match(/[\u4e00-\u9fa5]{2,8}(?:区|县)/g) ?? [];
  const municipalityConflict = ["北京", "上海", "天津", "重庆", "香港", "澳门"]
    .some((name) => compact.includes(name) && !expectedCity.includes(name));
  const cityConflict = cityMentions.length > 0 && !compact.includes(expectedCity) && !cityMentions.some((item) => normalizeAdmin(item).endsWith(expectedCity));
  const districtConflict = districtMentions.length > 0 && !compact.includes(expectedDistrict) && !districtMentions.some((item) => normalizeAdmin(item).endsWith(expectedDistrict));
  return municipalityConflict || cityConflict || districtConflict;
}

function recencyScore(publishedAt: string | undefined): number {
  if (!publishedAt) return 0;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return ageDays <= 365 ? 5 : ageDays <= 365 * 3 ? 2 : 0;
}

export function filterAndRankSearchResults(
  results: NormalizedWebSearchResult[],
  identity: WebEvidencePropertyIdentity,
  dimensionKey: WebEvidenceDimensionKey,
): NormalizedWebSearchResult[] {
  const targetName = normalizePropertyName(identity.name);
  const contextualDimension = dimensionKey === "location_maturity" || dimensionKey === "value_preservation";
  const ranked = results.flatMap((result) => {
    const text = `${result.title} ${result.snippet ?? ""}`;
    const compactText = normalizePropertyName(text);
    const compactTitle = normalizePropertyName(result.title);
    const nameMatch = targetName.length >= 2 && compactText.includes(targetName);
    const titleNameMatch = targetName.length >= 2 && compactTitle.includes(targetName);
    const nearNamePrefix = targetName.slice(0, Math.min(4, Math.max(0, targetName.length - 1)));
    const cityMatch = containsAdmin(text, identity.city);
    const districtMatch = containsAdmin(text, identity.district);
    const credibility = sourceCredibility(result);
    if (explicitAdministrativeConflict(text, identity)) return [];
    // Reject likely sibling-project pages (for example 招商臻玥府 vs 招商臻园) even when an
    // aggregator snippet happens to mention the target property later in the page.
    if (!titleNameMatch && nearNamePrefix.length >= 3 && compactTitle.includes(nearNamePrefix)) return [];
    // Context-only planning evidence is accepted only from a high-confidence source with matching city and district.
    if (!nameMatch && !(contextualDimension && cityMatch && districtMatch && credibility === "high")) return [];
    // Same-name properties exist nationwide. A property-specific result must contain at least one expected administrative signal.
    if (nameMatch && !cityMatch && !districtMatch) return [];
    const score =
      (nameMatch ? 60 : 0) +
      (cityMatch ? 15 : 0) +
      (districtMatch ? 15 : 0) +
      (DIMENSION_TERMS[dimensionKey].test(text) ? 10 : 0) +
      (credibility === "high" ? 12 : credibility === "medium" ? 6 : 0) +
      ((dimensionKey === "transaction_price_reasonableness" || dimensionKey === "liquidity" || dimensionKey === "value_preservation") ? recencyScore(result.publishedAt) : 0);
    return [{ result, score }];
  });
  ranked.sort((left, right) => right.score - left.score || left.result.title.localeCompare(right.result.title, "zh-CN"));

  const seenUrls = new Set<string>();
  const seenDomainTitles = new Set<string>();
  return ranked.flatMap(({ result }) => {
    const normalizedUrl = normalizeUrl(result.url);
    const domainTitle = `${canonicalSourceDomain(result.sourceDomain) ?? ""}::${normalizePropertyName(result.title)}`;
    if (seenUrls.has(normalizedUrl) || seenDomainTitles.has(domainTitle)) return [];
    seenUrls.add(normalizedUrl);
    seenDomainTitles.add(domainTitle);
    return [{ ...result, url: normalizedUrl }];
  });
}
