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

export interface ComparableTransaction {
  id: string;
  price: number;
  area: number;
  transactionDate: string;
  source: string;
  confirmed: boolean;
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
  listingPrice?: number | null;
  comparableTransactions?: ComparableTransaction[];
  deliveryYear?: number | null;
  orientation?: Orientation | null;
  customOrientation?: string | null;
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
  | "listingPrice"
  | "comparableTransactions"
  | "deliveryYear"
  | "orientation"
  | "customOrientation"
>;
