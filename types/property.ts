export const PROPERTY_STATUSES = [
  "draft",
  "pending_analysis",
  "analyzing",
  "completed",
  "failed",
] as const;

export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const FLOOR_LEVELS = [
  "low",
  "lower_middle",
  "middle",
  "upper_middle",
  "high",
] as const;

export const ORIENTATIONS = [
  "south",
  "southeast",
  "southwest",
  "east",
  "west",
  "northeast",
  "northwest",
  "north",
  "north_south",
  "multiple",
  "other",
] as const;

export type FloorLevel = (typeof FLOOR_LEVELS)[number];
export type Orientation = (typeof ORIENTATIONS)[number];

export const SUBJECTIVE_QUALITY_LEVELS = ["very_poor", "poor", "average", "good", "very_good", "unknown"] as const;
export const NOISE_EXPERIENCE_LEVELS = ["severe", "noticeable", "occasional", "low", "minimal", "unknown"] as const;
export type SubjectiveQualityLevel = (typeof SUBJECTIVE_QUALITY_LEVELS)[number];
export type NoiseExperienceLevel = (typeof NOISE_EXPERIENCE_LEVELS)[number];

export interface ComparableTransaction {
  id: string;
  price: number;
  area: number;
  transactionDate: string;
  source: string;
  confirmed: boolean;
}

export interface ConfirmedPropertyLocation {
  poiId?: string;
  name: string;
  formattedAddress: string;
  province?: string;
  city: string;
  district: string;
  lng: number;
  lat: number;
  source: "amap";
  confirmedByUser: boolean;
  confirmedAt: string;
}

export interface Property {
  id: string;
  name: string;
  city: string;
  district: string;
  address: string;
  totalPrice: number;
  area: number;
  layout: string;
  rooms: number;
  livingRooms: number;
  bathrooms: number;
  customLayout?: string | null;
  floor: string;
  floorLevel?: FloorLevel | null;
  floorNumber?: number | null;
  totalFloors?: number | null;
  metroDistance: number | null;
  schoolInformation: string;
  propertyManagementInformation: string;
  propertyCompany?: string | null;
  propertyFee?: number | null;
  greenRatio?: number | null;
  parkingRatio?: number | null;
  propertyManagementExperience?: SubjectiveQualityLevel;
  publicAreaMaintenance?: SubjectiveQualityLevel;
  communityEnvironmentExperience?: SubjectiveQualityLevel;
  noiseExperience?: NoiseExperienceLevel;
  parkingExperience?: SubjectiveQualityLevel;
  maintenanceCondition?: SubjectiveQualityLevel;
  /** Legacy free-text observations retained as contextual notes. */
  propertyExperience?: string | null;
  environment?: string | null;
  noise?: string | null;
  parking?: string | null;
  publicArea?: string | null;
  actualCommuteExperience?: string | null;
  recentDealPrice?: number | null;
  listingPrice?: number | null;
  comparableTransactions?: ComparableTransaction[];
  deliveryYear?: number | null;
  orientation?: Orientation | null;
  customOrientation?: string | null;
  confirmedLocation?: ConfirmedPropertyLocation | null;
  status: PropertyStatus;
  imageUrl?: string;
  source: "mock" | "manual";
  createdAt: string;
  updatedAt: string;
}

export type PropertyInput = Pick<
  Property,
  | "name"
  | "city"
  | "district"
  | "address"
  | "totalPrice"
  | "area"
  | "layout"
  | "rooms"
  | "livingRooms"
  | "bathrooms"
  | "customLayout"
  | "floor"
  | "floorLevel"
  | "floorNumber"
  | "totalFloors"
  | "metroDistance"
  | "schoolInformation"
  | "propertyManagementInformation"
  | "propertyCompany"
  | "propertyFee"
  | "greenRatio"
  | "parkingRatio"
  | "propertyManagementExperience"
  | "publicAreaMaintenance"
  | "communityEnvironmentExperience"
  | "noiseExperience"
  | "parkingExperience"
  | "maintenanceCondition"
  | "propertyExperience"
  | "environment"
  | "noise"
  | "parking"
  | "publicArea"
  | "actualCommuteExperience"
  | "recentDealPrice"
  | "listingPrice"
  | "comparableTransactions"
  | "deliveryYear"
  | "orientation"
  | "customOrientation"
  | "confirmedLocation"
>;
