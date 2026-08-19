import type {
  CommuteMode,
  DecisionPriority,
  EducationNeed,
  PurchasePurpose,
} from "./buyer-preferences";

export interface PropertyIntelligence {
  propertyId: string;
  generatedAt: string;
  analysisConfidence: number;
  locationProfile: {
    cityLevel: string;
    districtPosition: string;
    developmentStage: string;
  };
  industry: {
    industries: string[];
    employmentOpportunity: string;
  };
  lifestyle: {
    commercialMaturity: string;
    transportation: string;
    dailyConvenience: string;
    communityQuality: string;
  };
  assetValue: {
    liquidity: string;
    preservationPotential: string;
  };
  risks: {
    risks: string[];
    verificationPoints: string[];
  };
}

export interface PropertyIntelligenceRequest {
  property: {
    id: string;
    name: string;
    city: string;
    district: string;
    address: string;
    totalPrice: number;
    listingPrice: number | null;
    area: number;
    layout: string;
    floor: string;
    metroDistance: number | null;
    schoolInformation: string | null;
    propertyManagementInformation: string | null;
    deliveryYear: number | null;
    orientation: string | null;
  };
  preferences: {
    purchasePurpose: PurchasePurpose;
    maximumBudget: number;
    commuteMode: CommuteMode;
    primaryWorkLocation: string | null;
    educationNeed: EducationNeed;
    topPriorities: DecisionPriority[];
  };
}

export interface PropertyIntelligenceErrorResponse {
  ok: false;
  error: {
    code: "INVALID_REQUEST" | "INVALID_AI_OUTPUT" | "AI_PROVIDER_ERROR" | "AI_NOT_CONFIGURED" | "AI_TIMEOUT";
    message: string;
    retryable: boolean;
  };
}
