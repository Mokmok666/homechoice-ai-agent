const AMAP_DISTRICT_ENDPOINT = "https://restapi.amap.com/v3/config/district";
const AMAP_REQUEST_TIMEOUT_MS = 10_000;

export interface AdministrativeCity {
  name: string;
  province?: string;
  adcode?: string;
}

export interface AdministrativeDistrict {
  name: string;
  adcode?: string;
}

export type AMapAdministrativeErrorCode =
  | "AMAP_NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "ADMINISTRATIVE_NOT_FOUND"
  | "AMAP_API_ERROR"
  | "AMAP_TIMEOUT";

export class AMapAdministrativeError extends Error {
  constructor(public readonly code: AMapAdministrativeErrorCode, message: string) {
    super(message);
    this.name = "AMapAdministrativeError";
  }
}

interface DistrictNode {
  name: string;
  adcode?: string;
  level?: string;
  districts: DistrictNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseNode(value: unknown): DistrictNode | null {
  if (!isRecord(value) || !text(value.name)) return null;
  return {
    name: text(value.name)!,
    adcode: text(value.adcode),
    level: text(value.level),
    districts: Array.isArray(value.districts)
      ? value.districts.map(parseNode).filter((item): item is DistrictNode => item !== null)
      : [],
  };
}

function normalizeCityName(name: string): string {
  return name.trim().replace(/市$/, "");
}

function displayCityName(node: DistrictNode, province?: string): string {
  if (node.name.endsWith("城区")) {
    if (province?.endsWith("市")) return province.slice(0, -1);
    return node.name.slice(0, -2);
  }
  return normalizeCityName(node.name);
}

async function requestDistricts(keyword: string, subdistrict: 1 | 2): Promise<DistrictNode[]> {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) throw new AMapAdministrativeError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
  const normalized = keyword.trim();
  if (!normalized) throw new AMapAdministrativeError("INVALID_INPUT", "请输入城市名称。");

  const url = new URL(AMAP_DISTRICT_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("keywords", normalized);
  url.searchParams.set("subdistrict", String(subdistrict));
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "JSON");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload) || payload.status !== "1") {
      throw new AMapAdministrativeError("AMAP_API_ERROR", "高德行政区查询失败。");
    }
    const nodes = Array.isArray(payload.districts)
      ? payload.districts.map(parseNode).filter((item): item is DistrictNode => item !== null)
      : [];
    if (nodes.length === 0) throw new AMapAdministrativeError("ADMINISTRATIVE_NOT_FOUND", "未找到匹配的城市或行政区。");
    return nodes;
  } catch (error) {
    if (error instanceof AMapAdministrativeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AMapAdministrativeError("AMAP_TIMEOUT", "高德行政区查询超时。");
    }
    throw new AMapAdministrativeError("AMAP_API_ERROR", "暂时无法连接高德行政区服务。");
  } finally {
    clearTimeout(timeoutId);
  }
}

function cityNodes(nodes: DistrictNode[]): Array<{ node: DistrictNode; province?: string }> {
  const result: Array<{ node: DistrictNode; province?: string }> = [];
  for (const root of nodes) {
    if (root.level === "city") result.push({ node: root });
    for (const child of root.districts) {
      if (child.level === "city") result.push({ node: child, province: root.name });
      // Municipalities can expose districts directly below a province-level node.
      if (root.level === "province" && child.level === "district" && /市$/.test(root.name)) {
        result.push({ node: root, province: root.name });
        break;
      }
    }
  }
  return result;
}

export async function searchAdministrativeCities(keyword: string): Promise<AdministrativeCity[]> {
  const nodes = await requestDistricts(keyword, 1);
  const normalizedKeyword = normalizeCityName(keyword);
  const candidates = cityNodes(nodes)
    .map(({ node, province }) => ({ name: displayCityName(node, province), province, adcode: node.adcode }))
    .filter((item) => item.name.includes(normalizedKeyword) || normalizedKeyword.includes(item.name));
  return Array.from(new Map(candidates.map((item) => [`${item.adcode ?? ""}-${item.name}`, item])).values()).slice(0, 8);
}

export async function getAdministrativeDistricts(city: string): Promise<AdministrativeDistrict[]> {
  const nodes = await requestDistricts(city, 1);
  const targetName = normalizeCityName(city);
  const candidates = cityNodes(nodes).sort((left, right) => right.node.districts.length - left.node.districts.length);
  const target = candidates.find(({ node, province }) => displayCityName(node, province) === targetName) ?? candidates[0];
  if (!target) throw new AMapAdministrativeError("ADMINISTRATIVE_NOT_FOUND", "未找到该城市的行政区。");
  return target.node.districts
    .filter((item) => item.level === "district")
    .map((item) => ({ name: item.name, adcode: item.adcode }));
}
