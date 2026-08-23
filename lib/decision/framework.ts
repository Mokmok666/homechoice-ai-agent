import type { DimensionKey, DimensionType } from "@/types/decision";

export type DecisionDimensionGroup = "location_and_family" | "home_and_living" | "price_and_margin" | "long_term_value";
export type DimensionScoringMode = "deterministic" | "hybrid" | "derived";

export interface DecisionDimensionFramework {
  key: DimensionKey;
  label: string;
  group: DecisionDimensionGroup;
  definition: string;
  decisionQuestion: string;
  scoringMode: DimensionScoringMode;
  preferredEvidence: readonly string[];
  weakEvidence: readonly string[];
  missingBehavior: string;
  baseWeight: number;
  dimensionType: DimensionType;
}

export const DECISION_FRAMEWORK: readonly DecisionDimensionFramework[] = [
  { key: "location_maturity", label: "地段成熟度", group: "location_and_family", definition: "区域当前已经形成并可实际使用的城市生活功能。", decisionQuestion: "片区现在能否稳定支持家庭生活与就业活动？", scoringMode: "hybrid", preferredEvidence: ["已运营商业与公共服务", "已开通交通", "可信现状资料"], weakEvidence: ["单一未来规划", "开发商营销"], missingBehavior: "证据不足时保持未知，不将地址已知等同于成熟度已知。", baseWeight: 6, dimensionType: "fact" },
  { key: "commute", label: "通勤匹配", group: "location_and_family", definition: "真实路线时间与家庭理想及最大通勤边界的匹配程度。", decisionQuestion: "家庭成员的真实通勤是否处于各自可接受范围？", scoringMode: "deterministic", preferredEvidence: ["高德路线时长", "本人和伴侣通勤阈值"], weakEvidence: ["直线距离", "主观估计"], missingBehavior: "路线缺失时保持未知或部分证据，不按零分处理。", baseWeight: 10, dimensionType: "preference" },
  { key: "public_transport", label: "公共交通便利度", group: "location_and_family", definition: "步行可达地铁与周边公交覆盖共同形成的日常公共交通能力。", decisionQuestion: "不依赖驾车时，地铁或公交是否足以支持日常出行？", scoringMode: "hybrid", preferredEvidence: ["最近地铁直线距离", "最近公交站距离", "500米和800米公交站覆盖"], weakEvidence: ["远距离地铁存在", "缺失公交数据"], missingBehavior: "公交证据缺失不等于无公交；远地铁且公交未知时不生成低分。", baseWeight: 6, dimensionType: "fact" },
  { key: "commercial_amenities", label: "商业配套", group: "location_and_family", definition: "一公里生活圈内可实际使用的商业设施覆盖。", decisionQuestion: "日常消费与集中商业需求是否方便满足？", scoringMode: "deterministic", preferredEvidence: ["高德商业POI", "主要商场或商业综合体"], weakEvidence: ["规划商业", "重复POI"], missingBehavior: "外部请求失败时保持未知。", baseWeight: 5, dimensionType: "ai" },
  { key: "education", label: "教育需求", group: "location_and_family", definition: "房源与家庭当前或未来教育需求之间经官方政策支持的关系。", decisionQuestion: "是否有当前有效的官方证据连接房源、招生范围与家庭教育阶段？", scoringMode: "hybrid", preferredEvidence: ["官方招生政策", "官方服务范围", "当前有效的项目学校关系"], weakEvidence: ["附近有名校", "学区房营销", "直线距离"], missingBehavior: "未核验学校关系不扣分；无教育需求时不参与评分。", baseWeight: 6, dimensionType: "preference" },
  { key: "daily_life_amenities", label: "日常生活便利", group: "location_and_family", definition: "超市、医疗与公园等基础服务的覆盖程度。", decisionQuestion: "家庭日常生活所需的基础服务是否容易获得？", scoringMode: "deterministic", preferredEvidence: ["高德超市、医疗、公园POI"], weakEvidence: ["单一设施", "失败类别的零计数"], missingBehavior: "任一分类请求失败时不把该分类视为零。", baseWeight: 3, dimensionType: "ai" },
  { key: "layout_design", label: "户型设计", group: "home_and_living", definition: "房间、厅卫及功能空间结构的可用性。", decisionQuestion: "户型结构是否支持家庭的实际使用方式？", scoringMode: "deterministic", preferredEvidence: ["结构化室厅卫", "户型图"], weakEvidence: ["营销户型名称"], missingBehavior: "只有户型字符串时可记录，证据不足不强行评分。", baseWeight: 8, dimensionType: "fact" },
  { key: "space_match", label: "空间匹配", group: "home_and_living", definition: "建筑面积和房间数量对家庭空间需求的匹配。", decisionQuestion: "房源空间是否满足当前及可预见的家庭需求？", scoringMode: "deterministic", preferredEvidence: ["面积", "室厅卫", "家庭空间需求"], weakEvidence: ["面积单项"], missingBehavior: "缺少家庭需求时只记录房源事实。", baseWeight: 8, dimensionType: "fact" },
  { key: "building_age", label: "楼龄", group: "home_and_living", definition: "交付年份反映的建筑年龄与维护压力。", decisionQuestion: "楼龄是否符合家庭对维护成本和居住周期的预期？", scoringMode: "deterministic", preferredEvidence: ["有效交付年份"], weakEvidence: ["模糊新旧描述"], missingBehavior: "交付年份缺失时保持未知。", baseWeight: 5, dimensionType: "fact" },
  { key: "community_quality", label: "小区品质", group: "home_and_living", definition: "社区公共空间、维护、密度与实际居住体验。", decisionQuestion: "项目本身是否具有可验证的稳定居住品质？", scoringMode: "hybrid", preferredEvidence: ["项目级交付与维护记录", "可信社区环境资料"], weakEvidence: ["开发商品牌", "高端定位"], missingBehavior: "项目介绍不能单独形成品质分。", baseWeight: 7, dimensionType: "ai" },
  { key: "property_management", label: "物业服务", group: "home_and_living", definition: "项目实际物业服务、维护与响应表现。", decisionQuestion: "该项目的日常物业服务是否有可信的项目级证据支持？", scoringMode: "hybrid", preferredEvidence: ["项目级服务记录", "维护与投诉记录", "可信住户体验"], weakEvidence: ["物业公司名称", "开发商品牌", "头部物业营销"], missingBehavior: "仅知道管理公司时只记录事实，分数保持未知。", baseWeight: 5, dimensionType: "fact" },
  { key: "budget_match", label: "预算匹配", group: "price_and_margin", definition: "预期成交价与家庭最高预算之间的安全边界。", decisionQuestion: "购买总价是否处于家庭能够承担的范围？", scoringMode: "deterministic", preferredEvidence: ["预期成交价", "最高预算"], weakEvidence: ["仅挂牌价"], missingBehavior: "任一核心价格缺失时保持未知。", baseWeight: 10, dimensionType: "fact" },
  { key: "transaction_price_reasonableness", label: "成交价合理性", group: "price_and_margin", definition: "预期成交单价与近期同类已确认成交样本的关系。", decisionQuestion: "预期成交价是否得到足够近期可比成交支持？", scoringMode: "hybrid", preferredEvidence: ["至少3条近24个月已确认可比成交"], weakEvidence: ["挂牌价", "营销报价", "单条成交线索"], missingBehavior: "样本不足时保持部分证据且分数为空。", baseWeight: 8, dimensionType: "fact" },
  { key: "liquidity", label: "流动性", group: "long_term_value", definition: "房源未来再次交易时的实际成交活跃度与受众宽度。", decisionQuestion: "这类房源是否有真实、持续的成交需求？", scoringMode: "hybrid", preferredEvidence: ["真实成交频率", "成交周期", "主流面积和总价带"], weakEvidence: ["单条挂牌", "只有挂牌数量"], missingBehavior: "缺少成交活动证据时保持未知或部分证据。", baseWeight: 6, dimensionType: "ai" },
  { key: "value_preservation", label: "长期保值", group: "long_term_value", definition: "由多项已验证结构因素共同形成的长期价值韧性，而非房价上涨预测。", decisionQuestion: "现有结构性条件是否足以支撑价值相对稳定？", scoringMode: "derived", preferredEvidence: ["地段成熟度", "公共交通", "商业配套", "流动性", "楼龄", "小区品质"], weakEvidence: ["单一未来规划", "核心资产营销", "升值预测"], missingBehavior: "底层有效评分不足时保持未知。", baseWeight: 7, dimensionType: "ai" },
] as const;

export const DECISION_FRAMEWORK_BY_KEY = Object.fromEntries(
  DECISION_FRAMEWORK.map((dimension) => [dimension.key, dimension]),
) as Record<DimensionKey, DecisionDimensionFramework>;

