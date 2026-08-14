export const PROPERTY_STATUSES = [
  "draft",
  "pending_analysis",
  "analyzing",
  "completed",
  "failed",
] as const;

export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export interface Property {
  id: string;
  name: string;
  city: string;
  district: string;
  address: string;
  totalPrice: number;
  area: number;
  layout: string;
  floor: string;
  metroDistance: number | null;
  schoolInformation: string;
  propertyManagementInformation: string;
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
  | "floor"
  | "metroDistance"
  | "schoolInformation"
  | "propertyManagementInformation"
>;
