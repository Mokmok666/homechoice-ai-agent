import { properties as mockProperties } from "@/lib/mock-data";
import {
  PROPERTY_STATUSES,
  type Property,
  type PropertyInput,
  type PropertyStatus,
} from "@/types/property";

export const PROPERTY_STORAGE_KEY = "homechoice.properties.v1";
export const MAX_PROPERTIES = 5;

const statusSet = new Set<PropertyStatus>(PROPERTY_STATUSES);

function isProperty(value: unknown): value is Property {
  if (!value || typeof value !== "object") return false;
  const property = value as Partial<Property>;

  return (
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
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `property-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMockSeed(): Property[] {
  const timestamp = new Date().toISOString();

  return mockProperties.map((property) => ({
    id: property.id,
    name: property.name,
    city: property.city,
    district: property.district,
    address: `${property.district} · ${property.name.split("·")[0]}`,
    totalPrice: property.price.expected,
    area: property.area,
    layout: property.layout,
    floor: property.floor,
    metroDistance: Math.max(300, property.commute.transit * 20),
    schoolInformation: `${property.education.school}（${property.education.status}）`,
    propertyManagementInformation: `${property.management.company} · ${property.management.maintenance}`,
    status: "pending_analysis",
    imageUrl: property.image,
    source: "mock",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
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
    return parsed.filter(isProperty);
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
