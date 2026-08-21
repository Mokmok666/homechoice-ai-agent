const AMAP_PLACE_TEXT_ENDPOINT = "https://restapi.amap.com/v3/place/text";
const AMAP_REQUEST_TIMEOUT_MS = 10_000;

export interface PropertyLocationCandidate {
  poiId?: string;
  name: string;
  formattedAddress: string;
  province?: string;
  city: string;
  district: string;
  lng: number;
  lat: number;
}

export type AMapPropertySearchErrorCode =
  | "AMAP_NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "AMAP_API_ERROR"
  | "AMAP_TIMEOUT";

export class AMapPropertySearchError extends Error {
  constructor(public readonly code: AMapPropertySearchErrorCode, message: string) {
    super(message);
    this.name = "AMapPropertySearchError";
  }
}

interface RankedCandidate extends PropertyLocationCandidate { rank: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAdmin(value: string): string {
  return value.trim().replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治州|地区|盟|省|市|区|县)$/u, "");
}

function adminMatches(expected: string, actual: string): boolean {
  const left = normalizeAdmin(expected);
  const right = normalizeAdmin(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function normalizeKeyword(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s·・()（）\-—_]/g, "");
}

function parseCoordinates(value: unknown): { lng: number; lat: number } | null {
  if (typeof value !== "string") return null;
  const [lngText, latText, ...rest] = value.split(",");
  if (rest.length > 0) return null;
  const lng = Number(lngText);
  const lat = Number(latText);
  return Number.isFinite(lng) && lng >= -180 && lng <= 180 && Number.isFinite(lat) && lat >= -90 && lat <= 90
    ? { lng, lat }
    : null;
}

function buildFormattedAddress(province: string | undefined, city: string, district: string, address: string | undefined, name: string): string {
  const suffix = address && address !== "[]" ? address : name;
  const segments = [province, city, district, suffix].filter((item): item is string => Boolean(item));
  let result = "";
  for (const segment of segments) {
    if (!result.endsWith(segment) && !segment.startsWith(result)) result += segment;
    else if (!result) result = segment;
  }
  return result;
}

function accessoryPenalty(name: string): number {
  if (/(停车场|[东南西北](?:\d+)?门|出入口|入口|出口|\d+(座|栋|幢|号楼)|售楼处)/u.test(name)) return 55;
  return 0;
}

function candidateRank(keyword: string, name: string, type: string): number {
  const query = normalizeKeyword(keyword);
  const candidate = normalizeKeyword(name);
  let score = candidate === query ? 120 : candidate.includes(query) ? 95 : query.includes(candidate) ? 75 : 30;
  if (/(住宅区|住宅小区|小区|商务住宅|楼盘)/u.test(type)) score += 25;
  if (/(购物|餐饮|生活服务|公司企业|道路附属)/u.test(type)) score -= 20;
  return score - accessoryPenalty(name);
}

function workCandidateRank(keyword: string, name: string, type: string): number {
  const query = normalizeKeyword(keyword);
  const candidate = normalizeKeyword(name);
  let score = candidate === query ? 120 : candidate.includes(query) ? 95 : query.includes(candidate) ? 75 : 35;
  if (/(公司企业|商务楼宇|产业园区|科教文化|医疗保健|政府机构|购物服务|风景名胜)/u.test(type)) score += 15;
  return score - accessoryPenalty(name);
}

async function requestPlaceCandidates(
  keyword: string,
  city: string | undefined,
): Promise<Record<string, unknown>[]> {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) throw new AMapPropertySearchError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
  const url = new URL(AMAP_PLACE_TEXT_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("keywords", keyword);
  if (city) {
    url.searchParams.set("city", city);
    url.searchParams.set("citylimit", "true");
  }
  url.searchParams.set("offset", "25");
  url.searchParams.set("page", "1");
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "JSON");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload) || payload.status !== "1") {
      throw new AMapPropertySearchError("AMAP_API_ERROR", "高德位置搜索失败。");
    }
    return Array.isArray(payload.pois) ? payload.pois.filter(isRecord) : [];
  } catch (error) {
    if (error instanceof AMapPropertySearchError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AMapPropertySearchError("AMAP_TIMEOUT", "高德位置搜索超时。");
    throw new AMapPropertySearchError("AMAP_API_ERROR", "暂时无法连接高德位置搜索服务。");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function searchWorkLocations(input: {
  keyword: string;
  city?: string;
}): Promise<PropertyLocationCandidate[]> {
  const keyword = input.keyword.trim();
  const city = input.city?.trim() || undefined;
  if (keyword.length < 2) throw new AMapPropertySearchError("INVALID_INPUT", "请输入至少 2 个字的工作地点关键词。");
  const pois = await requestPlaceCandidates(keyword, city);
  const candidates: RankedCandidate[] = [];
  for (const poi of pois) {
    const name = providerText(poi.name);
    const actualCity = providerText(poi.cityname);
    const actualDistrict = providerText(poi.adname) ?? "";
    const coordinates = parseCoordinates(poi.location);
    if (!name || !actualCity || !coordinates || (city && !adminMatches(city, actualCity))) continue;
    const province = providerText(poi.pname);
    const address = providerText(poi.address);
    const type = providerText(poi.type) ?? "";
    candidates.push({
      ...(providerText(poi.id) ? { poiId: providerText(poi.id) } : {}),
      name,
      formattedAddress: buildFormattedAddress(province, actualCity, actualDistrict, address, name),
      ...(province ? { province } : {}),
      city: normalizeAdmin(actualCity),
      district: actualDistrict,
      ...coordinates,
      rank: workCandidateRank(keyword, name, type),
    });
  }
  return Array.from(new Map(candidates.map((item) => [item.poiId ?? `${item.name}-${item.lng}-${item.lat}`, item])).values())
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 5)
    .map(({ rank: _rank, ...candidate }) => candidate);
}

export async function searchPropertyLocations(input: {
  city: string;
  district: string;
  keyword: string;
}): Promise<PropertyLocationCandidate[]> {
  const city = input.city.trim();
  const district = input.district.trim();
  const keyword = input.keyword.trim();
  if (!city || !district || keyword.length < 2) {
    throw new AMapPropertySearchError("INVALID_INPUT", "请选择城市、行政区，并输入至少 2 个字的房源或小区名称。");
  }
  try {
    const pois = await requestPlaceCandidates(keyword, city);
    const candidates: RankedCandidate[] = [];
    for (const poi of pois) {
      if (!isRecord(poi)) continue;
      const name = providerText(poi.name);
      const actualCity = providerText(poi.cityname);
      const actualDistrict = providerText(poi.adname);
      const coordinates = parseCoordinates(poi.location);
      if (!name || !actualCity || !actualDistrict || !coordinates) continue;
      if (!adminMatches(city, actualCity) || !adminMatches(district, actualDistrict)) continue;
      const province = providerText(poi.pname);
      const address = providerText(poi.address);
      const type = providerText(poi.type) ?? "";
      candidates.push({
        ...(providerText(poi.id) ? { poiId: providerText(poi.id) } : {}),
        name,
        formattedAddress: buildFormattedAddress(province, actualCity, actualDistrict, address, name),
        ...(province ? { province } : {}),
        city: normalizeAdmin(actualCity),
        district: actualDistrict,
        ...coordinates,
        rank: candidateRank(keyword, name, type),
      });
    }
    const deduplicated = Array.from(new Map(candidates.map((item) => [item.poiId ?? `${item.name}-${item.lng}-${item.lat}`, item])).values());
    return deduplicated.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, "zh-CN"))
      .slice(0, 5)
      .map(({ rank: _rank, ...candidate }) => candidate);
  } catch (error) {
    if (error instanceof AMapPropertySearchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AMapPropertySearchError("AMAP_TIMEOUT", "高德位置搜索超时。");
    }
    throw new AMapPropertySearchError("AMAP_API_ERROR", "暂时无法连接高德位置搜索服务。");
  }
}
