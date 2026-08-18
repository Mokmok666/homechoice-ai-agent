const AI_ANALYSIS_ENDPOINT = "http://localhost:3000/api/ai/analyze";

const requestBody = {
  schemaVersion: 1,
  locale: "zh-CN",
  inputSignature: "phase-4b-live-api-test-v1",
  context: {
    asOfDate: "2026-08-18",
    property: {
      propertyId: "phase-4b-test-property",
      name: "珠江新城测试房源",
      location: {
        city: "广州",
        district: "天河区",
        address: "珠江新城示例地址",
      },
      expectedTransactionPrice: 220,
      listingPrice: 228,
      area: 89,
      layout: "3室2厅2卫",
      floor: "中高层",
      orientation: "south",
      deliveryYear: 2018,
      metroDistance: 600,
      schoolInformation: null,
      propertyManagementInformation: "保利物业",
      comparableTransactions: [],
    },
    preferences: {
      purchasePurpose: "self_use_and_value",
      maximumBudget: 250,
      primaryWorkLocation: "珠江新城",
      partnerWorkLocation: null,
      commuteMode: "public_transit",
      idealCommuteMinutes: 30,
      maxCommuteMinutes: 45,
      educationNeed: "none",
      educationStages: [],
      topPriorities: ["commute", "price", "layout_and_space"],
    },
    decision: {
      decisionVersion: "decision-engine-v1",
      propertyId: "phase-4b-test-property",
      matchScore: 82,
      recommendation: "CONSIDER",
      provisional: true,
      analysisConfidence: "provisional",
      dataCompletenessPercent: 72,
      reasons: ["当前已知信息下，房源预算与户型较符合家庭偏好。"],
      decisionFactors: ["预算匹配", "户型结构"],
      hardMismatches: [],
      dimensions: [],
      excludedInputFields: [],
    },
  },
} as const;

async function run(): Promise<void> {
  console.log(`POST ${AI_ANALYSIS_ENDPOINT}`);

  try {
    const response = await fetch(AI_ANALYSIS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const rawBody = await response.text();
    let parsedBody: unknown = rawBody;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      // Keep the raw response visible when the endpoint returns non-JSON content.
    }

    console.log(`HTTP ${response.status} ${response.statusText}`);
    console.log(JSON.stringify(parsedBody, null, 2));

    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error("无法连接本地 AI Analysis API：", error);
    process.exitCode = 1;
  }
}

void run();
