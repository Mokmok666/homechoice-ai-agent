import type { Property } from "../../types/property";

export type DataQualityStatus = "empty" | "invalid" | "valid";

const INVALID_TEXT_VALUES = new Set([
  "ok",
  "test",
  "xxx",
  "无",
  "暂无",
  "不知道",
  "未知",
]);

export function validateTextField(value: string | null | undefined): { status: DataQualityStatus } {
  if (value === null || value === undefined || value.trim() === "") return { status: "empty" };
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 2 || INVALID_TEXT_VALUES.has(normalized) || normalized.includes("xxx")) {
    return { status: "invalid" };
  }
  return { status: "valid" };
}

export function validateMetroDistance(value: number | null | undefined): { status: DataQualityStatus } {
  if (value === null || value === undefined) return { status: "empty" };
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return { status: "invalid" };
  return { status: "valid" };
}

export function getInvalidPropertyInputFields(property: Property): string[] {
  const fields: string[] = [];
  if (validateTextField(property.schoolInformation).status === "invalid") fields.push("学校信息");
  if (validateTextField(property.propertyManagementInformation).status === "invalid") fields.push("物业管理信息");
  if (validateMetroDistance(property.metroDistance).status === "invalid") fields.push("最近地铁距离");
  if ((property.comparableTransactions ?? []).some((item) => validateTextField(item.source).status !== "valid")) {
    fields.push("成交参考来源");
  }
  return fields;
}

export function createDecisionPropertyView(property: Property): Property {
  return {
    ...property,
    city: validateTextField(property.city).status === "valid" ? property.city : "",
    district: validateTextField(property.district).status === "valid" ? property.district : "",
    address: validateTextField(property.address).status === "valid" ? property.address : "",
    layout: validateTextField(property.layout).status === "valid" ? property.layout : "",
    schoolInformation: validateTextField(property.schoolInformation).status === "valid" ? property.schoolInformation : "",
    propertyManagementInformation: validateTextField(property.propertyManagementInformation).status === "valid" ? property.propertyManagementInformation : "",
    metroDistance: validateMetroDistance(property.metroDistance).status === "valid" ? property.metroDistance : null,
    comparableTransactions: (property.comparableTransactions ?? []).filter(
      (item) => validateTextField(item.source).status === "valid",
    ),
  };
}
