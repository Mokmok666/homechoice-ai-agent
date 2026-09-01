# HomeChoice 数据模型规划

> **历史文档说明：** 本文件是 Phase 0.5 的概念规划；`v1.0.0` 已实现 LocalStorage、Supabase 持久化与不可变 History snapshot。当前架构请以 [Architecture](./ARCHITECTURE.md) 和实际代码为准。

## 1. 设计目的

本文档定义 HomeChoice 后续阶段的概念数据模型。当前 Phase 0.5 仅进行规划，不创建数据库、不连接 Supabase，也不实现数据持久化。

未来数据库计划使用 Supabase PostgreSQL。数据库字段采用 `snake_case`，应用层 TypeScript 类型可采用 `camelCase`。

## 2. 实体关系

```text
User 1 ─── N Property
User 1 ─── N Preference
User 1 ─── N AnalysisResult
Preference 1 ─── N AnalysisResult
AnalysisResult N ─── N Property
```

一次分析需要保存房源和偏好的快照，避免源数据后续修改导致历史结论无法复现。

## 3. User

表示使用 HomeChoice 的用户。MVP 后续计划支持 Supabase Anonymous Auth，并允许未来升级为正式账号。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | `uuid` | 用户主键，与认证系统用户标识关联 |
| `auth_user_id` | `uuid` | Supabase Auth 用户 ID，匿名用户同样拥有该标识 |
| `display_name` | `text nullable` | 用户显示名称 |
| `city` | `text nullable` | 用户当前主要购房城市 |
| `created_at` | `timestamptz` | 用户首次创建时间 |
| `updated_at` | `timestamptz` | 用户信息最后更新时间 |

## 4. Property

表示用户加入候选清单的一套房源。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | `uuid` | 房源主键 |
| `user_id` | `uuid` | 所属用户，关联 `User.id` |
| `community` | `text` | 小区或楼盘名称 |
| `city` | `text` | 城市 |
| `district` | `text nullable` | 行政区或板块 |
| `location` | `text nullable` | 房源位置描述，MVP 不要求精确坐标 |
| `listing_price` | `numeric(12,2) nullable` | 挂牌价格，单位由 `currency` 和业务约定统一 |
| `expected_price` | `numeric(12,2) nullable` | 用户认为的真实可能成交价格 |
| `comparable_transactions` | `jsonb` | 用户录入的近期成交参考，包含价格、面积、日期、来源与确认状态 |
| `currency` | `char(3)` | ISO 货币代码，默认 `CNY` |
| `area` | `numeric(8,2) nullable` | 建筑面积，单位平方米 |
| `layout` | `text nullable` | 户型，例如三室两厅 |
| `rooms` | `smallint` | 卧室数量；旧记录无法识别时为 0 |
| `living_rooms` | `smallint` | 客厅数量；旧记录无法识别时为 0 |
| `bathrooms` | `smallint` | 卫生间数量，范围 0–5 |
| `custom_layout` | `text nullable` | 选择“其他”户型时保留的自定义描述 |
| `floor` | `text nullable` | 向后兼容的楼层展示描述 |
| `floor_level` | `text nullable` | 低层、中低层、中层、中高层或高层的结构化枚举 |
| `floor_number` | `smallint nullable` | 实际所在楼层 |
| `total_floors` | `smallint nullable` | 建筑总楼层 |
| `orientation` | `text nullable` | 结构化朝向枚举 |
| `custom_orientation` | `text nullable` | 选择“其他”朝向时保留的自定义描述 |
| `completion_year` | `smallint nullable` | 交付年份，用于按分析日期确定性计算楼龄 |
| `decoration` | `text nullable` | 装修状态 |
| `images` | `jsonb` | 房源图片或截图文件引用列表 |
| `source_type` | `text` | 信息来源，例如 `manual` 或 `screenshot` |
| `extraction_status` | `text` | AI 提取状态：未提取、待确认、已确认等 |
| `data_completeness` | `numeric(5,2)` | 资料完整度，用于判断分析可信度 |
| `notes` | `text nullable` | 用户补充备注 |
| `created_at` | `timestamptz` | 房源创建时间 |
| `updated_at` | `timestamptz` | 房源最后更新时间 |

说明：`images` 在 PostgreSQL 中只保存 Supabase Storage 的对象路径和元数据，不保存二进制文件。

## 5. Preference

表示一次可复用的家庭购房偏好设置。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | `uuid` | 偏好主键 |
| `user_id` | `uuid` | 所属用户，关联 `User.id` |
| `name` | `text` | 偏好方案名称，例如“通勤优先方案” |
| `purchase_purpose` | `text` | 自住、自住兼投资或投资 |
| `maximum_budget` | `numeric(12,2)` | 家庭可接受的单套房源最高总价，仅用于预算匹配 |
| `education_need` | `text` | 暂无、当前或未来教育需求 |
| `education_stages` | `text[]` | 幼儿园、小学、初中、高中等阶段 |
| `primary_work_location` | `jsonb nullable` | 主要工作地点的结构化描述 |
| `partner_work_location` | `jsonb nullable` | 伴侣工作地点的结构化描述 |
| `commute_mode` | `text` | 驾车、公共交通、均可或不重要 |
| `top_priorities` | `text[]` | 按顺序保存用户最重视的三项因素 |
| `structured_preferences` | `jsonb` | 其他可扩展结构化偏好，不存放最终分数 |
| `created_at` | `timestamptz` | 偏好创建时间 |
| `updated_at` | `timestamptz` | 偏好最后更新时间 |

## 6. AnalysisResult

表示某次比较分析的不可变结果版本。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | `uuid` | 分析结果主键 |
| `user_id` | `uuid` | 发起分析的用户 |
| `preference_id` | `uuid nullable` | 使用的偏好方案 |
| `title` | `text` | 本次比较名称 |
| `property_ids` | `uuid[]` | 参与比较的房源 ID，数量限制为 2–5 |
| `property_snapshot` | `jsonb` | 分析时的房源数据快照 |
| `preference_snapshot` | `jsonb` | 分析时的用户偏好快照 |
| `ranking` | `jsonb` | 确定性引擎生成的排序、总分和维度分数 |
| `recommendation` | `text` | `BUY`、`WAIT` 或 `PASS` |
| `recommended_property_id` | `uuid nullable` | 当前首选房源 |
| `ideal_price_range` | `jsonb nullable` | 建议成交价格区间 |
| `key_reasons` | `jsonb` | 推荐的主要结构化理由 |
| `key_risks` | `jsonb` | 风险与待确认事项 |
| `confidence_level` | `text` | 低、中、高等推荐可信度 |
| `confidence_reasons` | `jsonb` | 影响可信度的信息缺口 |
| `data_completeness` | `numeric(5,2)` | 当前阶段可采集事实与偏好中的数据完整度，不受未来 AI 维度拖累 |
| `analysis_confidence` | `text` | 阶段性或较充分，独立于已知信息匹配分数 |
| `explanation` | `text nullable` | AI 生成的自然语言说明 |
| `engine_version` | `text` | 决策引擎版本，保证结果可追溯 |
| `prompt_version` | `text nullable` | AI 解释提示词版本 |
| `status` | `text` | 处理中、已完成、失败 |
| `created_at` | `timestamptz` | 分析创建时间 |
| `completed_at` | `timestamptz nullable` | 分析完成时间 |

## 7. 数据与 AI 边界

- 评分、权重、预算判断、排名和 BUY / WAIT / PASS 必须由确定性逻辑生成；
- AI 只负责截图理解、字段提取、用户意图理解和自然语言解释；
- AI 提取字段需要保存置信度和用户确认状态；
- API 密钥不得存储在以上任何业务表中；
- 历史分析使用快照和版本号，保证结果可解释、可复现；
- 对用户上传图片和个人偏好使用最小化收集与用户级访问控制。
