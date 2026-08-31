import type { WebEvidenceInterpretationRequest } from "@/lib/web-evidence/types";

const DIMENSION_CONTRACTS = {
  location_maturity: {
    question: "这个区域现在是否已经形成稳定、可实际使用的城市生活功能？",
    relevant: "已营业的商业与社区零售、现有医疗和公共服务、已开通交通、已交付城市设施、片区已基本建成等现状证据。",
    prohibited: "未来规划、拟建交通或商场、区域口号、开发商营销及单个孤立 POI 不能证明当前成熟。",
  },
  community_quality: {
    question: "公开证据是否能说明这个住宅社区本身的实际居住品质？",
    relevant: "项目级社区规模、公共空间、社区设施、建筑密度、可信景观信息、交付质量及可信住户或媒体环境记录。",
    prohibited: "开发商品牌、高端定位、通用项目介绍及周边城市规划不能单独证明小区品质。",
  },
  property_management: {
    question: "是否有证据说明这个楼盘实际由谁管理，以及日常物业服务表现如何？",
    relevant: "优先使用本项目的维护、保洁、安保、响应、投诉或住户体验；其次是同一物业公司在当地具体项目的服务记录；公司一般声誉只能作弱背景。",
    prohibited: "物业公司名称、开发商品牌、头部物业宣传、住宅/商业类型和项目定位不能单独证明服务质量。",
  },
  building_age: {
    question: "是否有可信资料确认项目实际交付、竣工或建成年份？",
    relevant: "明确的交付年份、竣工年份或建成年份，并能区分开盘、预售、拿地和施工开始日期。",
    prohibited: "开盘、预售、营销、拿地或施工开始日期不能替代实际交付、竣工或建成年份。",
  },
  layout_design: {
    question: "是否有项目及面积段对应的客观户型结构资料？",
    relevant: "房间结构、朝向、阳台、梯户比、开间进深及户型图中的客观信息。",
    prohibited: "仅凭面积更大、房间更多或营销户型名称不能证明户型设计更好。",
  },
  education: {
    question: "是否有当前有效的官方证据连接该房源、招生服务范围与用户关注的教育需求？",
    relevant: "政府或教育部门发布的招生政策、学校服务范围、对口或划片关系及政策有效时间。",
    prohibited: "附近有学校、开发商或中介称学区房、直线距离和非官方转载不能证明入学资格。",
  },
  transaction_price_reasonableness: {
    question: "现有证据是否足以判断用户预计成交价处于合理区间？",
    relevant: "近期、可靠、户型面积和时间可比的真实成交或网签记录。",
    prohibited: "挂牌价、在售价、营销报价、单个随机价格和过时或不可比价格不能证明成交价合理。",
  },
  liquidity: {
    question: "未来出售时，这类房源是否有足够真实市场需求和成交活跃度？",
    relevant: "真实成交活跃度、成交频率、成交周期、可靠成交趋势；持续挂牌或转售供给只能作为部分线索。",
    prohibited: "单条挂牌、只有挂牌数量或泛称区域热门，不能推出流动性好；挂牌不等于成交。",
  },
  value_preservation: {
    question: "公开资料是否提供已兑现、可核验的长期结构性支撑或风险？",
    relevant: "已建成交通和商业、稳定产业就业或需求、供给压力、已交付公共设施及真实成交活动。",
    prohibited: "单个未来规划、核心资产或升值潜力营销、价格预测、绿化景观不能直接推出长期保值能力或分数。",
  },
} as const;

export function createWebEvidenceInterpretationPrompt(request: WebEvidenceInterpretationRequest): string {
  const dimensions = request.evidence.dimensions
    .filter((dimension) => dimension.status !== "unavailable" && dimension.facts.length > 0)
    .map((dimension) => ({
      dimensionKey: dimension.dimensionKey,
      status: dimension.status,
      dimensionQuestion: DIMENSION_CONTRACTS[dimension.dimensionKey].question,
      allowedRelevantEvidence: DIMENSION_CONTRACTS[dimension.dimensionKey].relevant,
      prohibitedWeakInference: DIMENSION_CONTRACTS[dimension.dimensionKey].prohibited,
      facts: dimension.facts.slice(0, 3).map((fact) => ({
        claim: fact.claim.slice(0, 180),
        sourceTitle: fact.sourceTitle,
        sourceDomain: fact.sourceDomain ?? null,
        confidence: fact.confidence,
        transactionKind: fact.transactionKind ?? null,
      })),
    }));
  return `你是房产公开证据解释器，只负责解释给定来源对指定维度意味着什么。

严格规则：
1. 只能使用输入 facts 中明确出现的信息；不得补充常识、模型记忆或外部事实。
2. 不评分、不排名、不改变推荐，不出现“建议购买”“排名第一”“综合评分”等措辞。
3. 不预测升值，不保证入学，不把知名物业公司等同于服务质量好。
4. 挂牌信息不是成交记录；不得把 listing 转为 transaction。
5. partial 必须使用“现有资料显示 / 目前可初步判断 / 但仍缺少”等谨慎语气。
6. 每个 conclusion 为一个自然中文句子，25–70字，绝不超过100字；直接说明对该房源该维度的含义。
7. supportingFacts 最多3条，每条必须是输入事实的简短忠实提炼，不含来源之外的新数字。
8. 不输出推理过程，不输出 source URL，不输出输入中没有的维度。
9. dimensions 必须逐一包含输入中每个可用维度，不能遗漏，也不能重复。
10. 不要汇总每一条输入事实。先在内部把事实分为 DIRECT、PARTIAL、IRRELEVANT，只能使用真正回答 dimensionQuestion 的 DIRECT 和有帮助的 PARTIAL。
11. PROPERTY FACT 不等于 DIMENSION-RELEVANT EVIDENCE。有效但与维度问题无关的事实不得进入 conclusion 或 supportingFacts。
12. 如果输入事实不能有意义地回答 dimensionQuestion，必须使用谨慎的“当前公开资料不足以判断……”结论，不得硬凑分析。
13. evidence status 不能替代语义相关性判断；即使 status=verified，也不能用无关事实形成确定结论。

只返回以下 JSON：
{"propertyId":"原样返回","dimensions":[{"dimensionKey":"允许的维度键","conclusion":"一句结论","supportingFacts":["事实1"]}]}

房源：${JSON.stringify(request.property)}
证据：${JSON.stringify(dimensions)}`;
}
