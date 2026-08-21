import { properties as mockProperties } from "@/lib/mock-data";
import {
  FLOOR_LEVELS,
  ORIENTATIONS,
  PROPERTY_STATUSES,
  type Property,
  type ComparableTransaction,
  type ConfirmedPropertyLocation,
  type FloorLevel,
  type Orientation,
  type PropertyInput,
  type PropertyStatus,
} from "@/types/property";

export const PROPERTY_STORAGE_KEY = "homechoice.properties.v1";
export const MAX_PROPERTIES = 5;

const statusSet = new Set<PropertyStatus>(PROPERTY_STATUSES);
const floorLevelSet = new Set<FloorLevel>(FLOOR_LEVELS);
const orientationSet = new Set<Orientation>(ORIENTATIONS);

const legacyOrientationMap: Record<string, Orientation> = {
  "南向": "south",
  "东南向": "southeast",
  "西南向": "southwest",
  "东向": "east",
  "西向": "west",
  "东北向": "northeast",
  "西北向": "northwest",
  "北向": "north",
  "南北通透": "north_south",
  "多朝向": "multiple",
};

const legacyFloorLevelMap: Array<[string, FloorLevel]> = [
  ["中低层", "lower_middle"],
  ["中高层", "upper_middle"],
  ["低层", "low"],
  ["中层", "middle"],
  ["高层", "high"],
];

function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseLayoutCounts(layout: string): { rooms: number; livingRooms: number; bathrooms: number } {
  const match = layout.match(/(\d+)室(?:及以上)?(?:(\d+)厅)?(?:(\d+)卫)?/);
  return {
    rooms: match ? Number(match[1]) : 0,
    livingRooms: match?.[2] ? Number(match[2]) : 0,
    bathrooms: match?.[3] ? Number(match[3]) : 0,
  };
}

function formatCompleteLayout(layout: string, bathrooms: number): string {
  const trimmedLayout = layout.trim();
  if (!trimmedLayout || bathrooms <= 0 || /\d+卫/.test(trimmedLayout)) return trimmedLayout;
  return trimmedLayout === "5室及以上"
    ? `${trimmedLayout} · ${bathrooms}卫`
    : `${trimmedLayout}${bathrooms}卫`;
}

function isComparableTransaction(value: unknown): value is ComparableTransaction {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ComparableTransaction>;
  return (
    typeof item.id === "string" &&
    typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0 &&
    typeof item.area === "number" && Number.isFinite(item.area) && item.area > 0 &&
    typeof item.transactionDate === "string" &&
    typeof item.source === "string" &&
    typeof item.confirmed === "boolean"
  );
}

function normalizeConfirmedLocation(value: unknown): ConfirmedPropertyLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const location = value as Partial<ConfirmedPropertyLocation>;
  const validCoordinates = typeof location.lng === "number" && Number.isFinite(location.lng) &&
    location.lng >= -180 && location.lng <= 180 &&
    typeof location.lat === "number" && Number.isFinite(location.lat) &&
    location.lat >= -90 && location.lat <= 90;
  if (
    typeof location.name !== "string" || !location.name.trim() ||
    typeof location.formattedAddress !== "string" || !location.formattedAddress.trim() ||
    typeof location.city !== "string" || !location.city.trim() ||
    typeof location.district !== "string" || !location.district.trim() ||
    location.source !== "amap" || location.confirmedByUser !== true ||
    typeof location.confirmedAt !== "string" || !Number.isFinite(Date.parse(location.confirmedAt)) ||
    !validCoordinates
  ) return null;

  return {
    ...(typeof location.poiId === "string" && location.poiId.trim() ? { poiId: location.poiId.trim() } : {}),
    name: location.name.trim(),
    formattedAddress: location.formattedAddress.trim(),
    ...(typeof location.province === "string" && location.province.trim() ? { province: location.province.trim() } : {}),
    city: location.city.trim(),
    district: location.district.trim(),
    lng: location.lng!,
    lat: location.lat!,
    source: "amap",
    confirmedByUser: true,
    confirmedAt: location.confirmedAt,
  };
}

function normalizeProperty(value: unknown): Property | null {
  if (!value || typeof value !== "object") return null;
  const property = value as Partial<Property>;

  const isValidBase = (
    typeof property.id === "string" &&
    typeof property.name === "string" &&
    typeof property.city === "string" &&
    typeof property.district === "string" &&
    typeof property.address === "string" &&
    typeof property.totalPrice === "number" &&
    Number.isFinite(property.totalPrice) &&
    typeof property.area === "number" &&
    Number.isFinite(property.area) &&
    typeof property.layout === "string" &&
    typeof property.floor === "string" &&
    (property.metroDistance === null ||
      (typeof property.metroDistance === "number" &&
        Number.isFinite(property.metroDistance))) &&
    typeof property.schoolInformation === "string" &&
    typeof property.propertyManagementInformation === "string" &&
    typeof property.status === "string" &&
    statusSet.has(property.status as PropertyStatus) &&
    (property.source === "mock" || property.source === "manual") &&
    typeof property.createdAt === "string" &&
    typeof property.updatedAt === "string"
  );
  if (!isValidBase) return null;

  const normalized = { ...property } as Property;
  const legacyLayoutCounts = parseLayoutCounts(property.layout!);
  normalized.rooms = typeof property.rooms === "number" && Number.isInteger(property.rooms) && property.rooms >= 0
    ? property.rooms
    : legacyLayoutCounts.rooms;
  normalized.livingRooms = typeof property.livingRooms === "number" && Number.isInteger(property.livingRooms) && property.livingRooms >= 0
    ? property.livingRooms
    : legacyLayoutCounts.livingRooms;
  normalized.bathrooms = typeof property.bathrooms === "number" && Number.isInteger(property.bathrooms) && property.bathrooms >= 0 && property.bathrooms <= 5
    ? property.bathrooms
    : legacyLayoutCounts.bathrooms;
  normalized.layout = formatCompleteLayout(property.layout!, normalized.bathrooms);
  normalized.listingPrice = typeof property.listingPrice === "number" && Number.isFinite(property.listingPrice) && property.listingPrice > 0
    ? property.listingPrice
    : null;
  normalized.deliveryYear = typeof property.deliveryYear === "number" && Number.isInteger(property.deliveryYear) && property.deliveryYear >= 1900 && property.deliveryYear <= 2100
    ? property.deliveryYear
    : null;
  normalized.customLayout = typeof property.customLayout === "string" && property.customLayout.trim()
    ? formatCompleteLayout(property.customLayout.trim(), normalized.bathrooms)
    : null;
  normalized.floorLevel = typeof property.floorLevel === "string" && floorLevelSet.has(property.floorLevel as FloorLevel)
    ? property.floorLevel as FloorLevel
    : legacyFloorLevelMap.find(([label]) => property.floor!.includes(label))?.[1] ?? null;
  normalized.floorNumber = optionalPositiveInteger(property.floorNumber);
  normalized.totalFloors = optionalPositiveInteger(property.totalFloors);
  if (normalized.floorNumber !== null && normalized.totalFloors !== null && normalized.floorNumber > normalized.totalFloors) {
    normalized.floorNumber = null;
  }
  if (typeof property.orientation === "string" && orientationSet.has(property.orientation as Orientation)) {
    normalized.orientation = property.orientation as Orientation;
    normalized.customOrientation = typeof property.customOrientation === "string" && property.customOrientation.trim()
      ? property.customOrientation.trim()
      : null;
  } else if (typeof property.orientation === "string" && property.orientation.trim()) {
    normalized.orientation = legacyOrientationMap[property.orientation.trim()] ?? "other";
    normalized.customOrientation = legacyOrientationMap[property.orientation.trim()]
      ? null
      : property.orientation.trim();
  } else {
    normalized.orientation = null;
    normalized.customOrientation = null;
  }
  normalized.comparableTransactions = Array.isArray(property.comparableTransactions)
    ? property.comparableTransactions.filter(isComparableTransaction)
    : [];
  normalized.confirmedLocation = normalizeConfirmedLocation(property.confirmedLocation);
  return normalized;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `property-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMockSeed(): Property[] {
  const timestamp = new Date().toISOString();

  return mockProperties.map((property) => {
    const layoutCounts = parseLayoutCounts(property.layout);
    return ({
    id: property.id,
    name: property.name,
    city: property.city,
    district: property.district,
    address: `${property.district} · ${property.name.split("·")[0]}`,
    totalPrice: property.price.expected,
    area: property.area,
    layout: property.layout,
    rooms: layoutCounts.rooms,
    livingRooms: layoutCounts.livingRooms,
    bathrooms: layoutCounts.bathrooms,
    floor: property.floor,
    metroDistance: Math.max(300, property.commute.transit * 20),
    schoolInformation: `${property.education.school}（${property.education.status}）`,
    propertyManagementInformation: `${property.management.company} · ${property.management.maintenance}`,
    status: "pending_analysis",
    imageUrl: property.image,
    source: "mock",
    createdAt: timestamp,
    updatedAt: timestamp,
    });
  });
}

function writeProperties(properties: Property[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROPERTY_STORAGE_KEY, JSON.stringify(properties));
}

export function getProperties(): Property[] {
  if (typeof window === "undefined") return [];

  const stored = window.localStorage.getItem(PROPERTY_STORAGE_KEY);
  if (stored === null) {
    const seed = createMockSeed();
    writeProperties(seed);
    return seed;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeProperty)
      .filter((property): property is Property => property !== null);
  } catch {
    return [];
  }
}

export function getProperty(id: string): Property | undefined {
  return getProperties().find((property) => property.id === id);
}

export function createProperty(input: PropertyInput): Property {
  const properties = getProperties();
  if (properties.length >= MAX_PROPERTIES) {
    throw new Error(`每次最多添加 ${MAX_PROPERTIES} 套候选房源。`);
  }

  const timestamp = new Date().toISOString();
  const property: Property = {
    ...input,
    name: input.confirmedLocation?.confirmedByUser
      ? input.confirmedLocation.name
      : input.name,
    id: createId(),
    status: "pending_analysis",
    source: "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeProperties([...properties, property]);
  return property;
}

export function updateProperty(id: string, input: PropertyInput): Property {
  const properties = getProperties();
  const existing = properties.find((property) => property.id === id);
  if (!existing) throw new Error("未找到需要更新的房源。");

  const updated: Property = {
    ...existing,
    ...input,
    name: input.confirmedLocation?.confirmedByUser
      ? input.confirmedLocation.name
      : input.name,
    status: "pending_analysis",
    updatedAt: new Date().toISOString(),
  };

  writeProperties(
    properties.map((property) => (property.id === id ? updated : property)),
  );
  return updated;
}

export function deleteProperty(id: string): Property[] {
  const properties = getProperties().filter((property) => property.id !== id);
  writeProperties(properties);
  return properties;
}
