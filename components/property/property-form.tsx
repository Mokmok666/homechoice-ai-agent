"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Building2, Plus, School, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LocationConfirmation } from "@/components/property/location-confirmation";
import { isDemoModeActive } from "@/lib/demo/demo-mode";
import { createPersistedProperty, loadProperty, updatePersistedProperty } from "@/lib/property-storage";
import { useSupabaseAuth } from "@/components/providers/supabase-auth-provider";
import type { ComparableTransaction, ConfirmedPropertyLocation, FloorLevel, NoiseExperienceLevel, Orientation, PropertyInput, SubjectiveQualityLevel } from "@/types/property";

const LAYOUT_OPTIONS = [
  "1室1厅1卫",
  "2室1厅1卫",
  "2室2厅1卫",
  "2室2厅2卫",
  "3室1厅1卫",
  "3室2厅1卫",
  "3室2厅2卫",
  "4室2厅2卫",
  "4室2厅3卫",
  "5室及以上",
  "其他",
] as const;

const FLOOR_LEVEL_OPTIONS: Array<{ value: FloorLevel; label: string }> = [
  { value: "low", label: "低层" },
  { value: "lower_middle", label: "中低层" },
  { value: "middle", label: "中层" },
  { value: "upper_middle", label: "中高层" },
  { value: "high", label: "高层" },
];

const ORIENTATION_OPTIONS: Array<{ value: Orientation; label: string }> = [
  { value: "south", label: "南向" },
  { value: "southeast", label: "东南向" },
  { value: "southwest", label: "西南向" },
  { value: "east", label: "东向" },
  { value: "west", label: "西向" },
  { value: "northeast", label: "东北向" },
  { value: "northwest", label: "西北向" },
  { value: "north", label: "北向" },
  { value: "north_south", label: "南北通透" },
  { value: "multiple", label: "多朝向" },
  { value: "other", label: "其他" },
];

const PROPERTY_MANAGEMENT_OPTIONS = [
  "中海物业",
  "保利物业",
  "招商积余 / 招商物业",
  "华润万象生活",
  "万物云",
  "龙湖智创生活",
  "绿城服务",
  "金地智慧服务",
  "碧桂园服务",
  "雅生活",
] as const;

const QUALITY_OPTIONS: Array<{ value: SubjectiveQualityLevel; label: string }> = [
  { value: "unknown", label: "暂未判断" }, { value: "very_poor", label: "很差" }, { value: "poor", label: "较差" },
  { value: "average", label: "一般" }, { value: "good", label: "较好" }, { value: "very_good", label: "很好" },
];
const NOISE_OPTIONS: Array<{ value: NoiseExperienceLevel; label: string }> = [
  { value: "unknown", label: "暂未判断" }, { value: "severe", label: "严重" }, { value: "noticeable", label: "明显" },
  { value: "occasional", label: "偶尔" }, { value: "low", label: "较少" }, { value: "minimal", label: "很少" },
];

const SELECT_CLASS = "mt-2 h-12 w-full rounded-lg border border-[#deddd8] bg-white px-4 text-[15px] outline-none focus:border-[#7d8f75] focus:ring-2 focus:ring-[#7d8f75]/10";

interface ComparableFormRow {
  id: string;
  price: string;
  area: string;
  transactionDate: string;
  source: string;
  confirmed: boolean;
}

interface PropertyFormState {
  name: string;
  city: string;
  district: string;
  address: string;
  totalPrice: string;
  area: string;
  layout: string;
  customLayout: string;
  floorLevel: string;
  floorNumber: string;
  totalFloors: string;
  metroDistance: string;
  schoolInformation: string;
  propertyManagementInformation: string;
  propertyFee: string;
  greenRatio: string;
  parkingRatio: string;
  propertyManagementExperience: string;
  publicAreaMaintenance: string;
  communityEnvironmentExperience: string;
  noiseExperience: string;
  parkingExperience: string;
  maintenanceCondition: string;
  propertyExperience: string;
  environment: string;
  noise: string;
  parking: string;
  publicArea: string;
  actualCommuteExperience: string;
  recentDealPrice: string;
  listingPrice: string;
  deliveryYear: string;
  orientation: string;
  customOrientation: string;
  comparableTransactions: ComparableFormRow[];
}

type PropertyTextField = Exclude<keyof PropertyFormState, "comparableTransactions">;

type FormErrors = Partial<Record<keyof PropertyFormState | "form", string>>;

const EMPTY_FORM: PropertyFormState = {
  name: "",
  city: "",
  district: "",
  address: "",
  totalPrice: "",
  area: "",
  layout: "",
  customLayout: "",
  floorLevel: "",
  floorNumber: "",
  totalFloors: "",
  metroDistance: "",
  schoolInformation: "",
  propertyManagementInformation: "",
  propertyFee: "",
  greenRatio: "",
  parkingRatio: "",
  propertyManagementExperience: "unknown",
  publicAreaMaintenance: "unknown",
  communityEnvironmentExperience: "unknown",
  noiseExperience: "unknown",
  parkingExperience: "unknown",
  maintenanceCondition: "unknown",
  propertyExperience: "",
  environment: "",
  noise: "",
  parking: "",
  publicArea: "",
  actualCommuteExperience: "",
  recentDealPrice: "",
  listingPrice: "",
  deliveryYear: "",
  orientation: "",
  customOrientation: "",
  comparableTransactions: [],
};

function createComparableRow(): ComparableFormRow {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `comparable-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, price: "", area: "", transactionDate: "", source: "", confirmed: false };
}

function getLayoutSelection(layout: string, customLayout?: string | null): string {
  if (customLayout) return "其他";
  return LAYOUT_OPTIONS.includes(layout as (typeof LAYOUT_OPTIONS)[number]) ? layout : "其他";
}

function parseLayoutCounts(layout: string): { rooms: number; livingRooms: number; bathrooms: number } {
  const match = layout.match(/(\d+)室(?:及以上)?(?:(\d+)厅)?(?:(\d+)卫)?/);
  return {
    rooms: match ? Number(match[1]) : 0,
    livingRooms: match?.[2] ? Number(match[2]) : 0,
    bathrooms: match?.[3] ? Number(match[3]) : 0,
  };
}

function validateForm(form: PropertyFormState): FormErrors {
  const errors: FormErrors = {};
  const requiredFields: Array<[PropertyTextField, string]> = [
    ["city", "请选择城市。"],
    ["district", "请选择行政区。"],
    ["address", "请输入房源或小区名称。"],
    ["layout", "请选择户型。"],
    ["floorLevel", "请选择所在楼层。"],
  ];

  for (const [field, message] of requiredFields) {
    if (!form[field].trim()) errors[field] = message;
  }

  const totalPrice = Number(form.totalPrice);
  if (!form.totalPrice.trim()) errors.totalPrice = "请输入预期成交总价。";
  else if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    errors.totalPrice = "预期成交总价必须是大于 0 的数字。";
  }

  const area = Number(form.area);
  if (!form.area.trim()) errors.area = "请输入建筑面积。";
  else if (!Number.isFinite(area) || area <= 0) {
    errors.area = "面积必须是大于 0 的数字。";
  }

  if (form.metroDistance.trim()) {
    const metroDistance = Number(form.metroDistance);
    if (!Number.isFinite(metroDistance) || metroDistance < 0) {
      errors.metroDistance = "地铁距离不能小于 0。";
    }
  }

  if (form.listingPrice.trim()) {
    const listingPrice = Number(form.listingPrice);
    if (!Number.isFinite(listingPrice) || listingPrice <= 0) errors.listingPrice = "挂牌价必须是大于 0 的数字。";
  }
  if (form.propertyFee.trim()) {
    const propertyFee = Number(form.propertyFee);
    if (!Number.isFinite(propertyFee) || propertyFee <= 0) errors.propertyFee = "物业费必须是大于 0 的数字。";
  }
  if (form.greenRatio.trim()) {
    const greenRatio = Number(form.greenRatio);
    if (!Number.isFinite(greenRatio) || greenRatio < 0 || greenRatio > 100) errors.greenRatio = "绿化率必须是 0–100 之间的数字。";
  }
  if (form.parkingRatio.trim()) {
    const parkingRatio = Number(form.parkingRatio);
    if (!Number.isFinite(parkingRatio) || parkingRatio < 0) errors.parkingRatio = "车位配比不能小于 0。";
  }
  if (form.recentDealPrice.trim()) {
    const recentDealPrice = Number(form.recentDealPrice);
    if (!Number.isFinite(recentDealPrice) || recentDealPrice <= 0) errors.recentDealPrice = "成交价格线索必须是大于 0 的数字。";
  }
  if (form.deliveryYear.trim()) {
    const deliveryYear = Number(form.deliveryYear);
    if (!Number.isInteger(deliveryYear) || deliveryYear < 1900 || deliveryYear > 2100) {
      errors.deliveryYear = "请输入 1900–2100 之间的有效年份。";
    }
  }
  if (form.floorNumber.trim()) {
    const floorNumber = Number(form.floorNumber);
    if (!Number.isInteger(floorNumber) || floorNumber <= 0) errors.floorNumber = "实际楼层必须是大于 0 的整数。";
  }
  if (form.totalFloors.trim()) {
    const totalFloors = Number(form.totalFloors);
    if (!Number.isInteger(totalFloors) || totalFloors <= 0) errors.totalFloors = "总楼层必须是大于 0 的整数。";
  }
  if (form.floorNumber.trim() && form.totalFloors.trim() && Number(form.floorNumber) > Number(form.totalFloors)) {
    errors.floorNumber = "实际楼层不能高于总楼层。";
  }
  const invalidComparable = form.comparableTransactions.some((item) =>
    !item.price.trim() || Number(item.price) <= 0 || !Number.isFinite(Number(item.price)) ||
    !item.area.trim() || Number(item.area) <= 0 || !Number.isFinite(Number(item.area)) ||
    !item.transactionDate || !item.source.trim(),
  );
  if (invalidComparable) errors.comparableTransactions = "每条成交参考都需要有效的价格、面积、日期和来源。";
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-2 text-xs text-[#a34f43]" role="alert">{message}</p>;
}

function ObservationSelect({ id, label, value, options, onChange }: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return <div><Label htmlFor={id}>{label}</Label><select id={id} className={SELECT_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

export function PropertyForm() {
  const router = useRouter();
  const { authReady, userId } = useSupabaseAuth();
  const [form, setForm] = useState<PropertyFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProperty, setIsLoadingProperty] = useState(true);
  const [demoActive, setDemoActive] = useState(false);
  const [confirmedLocation, setConfirmedLocation] = useState<ConfirmedPropertyLocation | null>(null);

  useEffect(() => {
    if (!authReady) return;
    if (isDemoModeActive()) {
      setDemoActive(true);
      setIsLoadingProperty(false);
      return;
    }
    let active = true;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      setIsLoadingProperty(false);
      return () => { active = false; };
    }
    void loadProperty(id, userId).then((property) => {
    if (!active) return;
    if (!property) {
      setErrors({ form: "未找到需要编辑的房源，请返回房源列表重试。" });
      return;
    }
    setEditingId(id);
    setConfirmedLocation(property.confirmedLocation ?? null);
    const rehydratedCity = property.city.trim() || property.confirmedLocation?.city?.trim() || "";
    const rehydratedDistrict = property.district.trim() || property.confirmedLocation?.district?.trim() || "";
    setForm({
      name: property.name,
      city: rehydratedCity,
      district: rehydratedDistrict,
      address: property.confirmedLocation?.name ?? property.address,
      totalPrice: String(property.totalPrice),
      area: String(property.area),
      layout: getLayoutSelection(property.layout, property.customLayout),
      customLayout: property.customLayout ?? (getLayoutSelection(property.layout, property.customLayout) === "其他" ? property.layout : ""),
      floorLevel: property.floorLevel ?? "",
      floorNumber: property.floorNumber === null || property.floorNumber === undefined ? "" : String(property.floorNumber),
      totalFloors: property.totalFloors === null || property.totalFloors === undefined ? "" : String(property.totalFloors),
      metroDistance: property.metroDistance === null ? "" : String(property.metroDistance),
      schoolInformation: property.schoolInformation,
      propertyManagementInformation: property.propertyCompany ?? property.propertyManagementInformation,
      propertyFee: property.propertyFee === null || property.propertyFee === undefined ? "" : String(property.propertyFee),
      greenRatio: property.greenRatio === null || property.greenRatio === undefined ? "" : String(property.greenRatio),
      parkingRatio: property.parkingRatio === null || property.parkingRatio === undefined ? "" : String(property.parkingRatio),
      propertyManagementExperience: property.propertyManagementExperience ?? "unknown",
      publicAreaMaintenance: property.publicAreaMaintenance ?? "unknown",
      communityEnvironmentExperience: property.communityEnvironmentExperience ?? "unknown",
      noiseExperience: property.noiseExperience ?? "unknown",
      parkingExperience: property.parkingExperience ?? "unknown",
      maintenanceCondition: property.maintenanceCondition ?? "unknown",
      propertyExperience: property.propertyExperience ?? "",
      environment: property.environment ?? "",
      noise: property.noise ?? "",
      parking: property.parking ?? "",
      publicArea: property.publicArea ?? "",
      actualCommuteExperience: property.actualCommuteExperience ?? "",
      recentDealPrice: property.recentDealPrice === null || property.recentDealPrice === undefined ? "" : String(property.recentDealPrice),
      listingPrice: property.listingPrice === null || property.listingPrice === undefined ? "" : String(property.listingPrice),
      deliveryYear: property.deliveryYear === null || property.deliveryYear === undefined ? "" : String(property.deliveryYear),
      orientation: property.orientation ?? "",
      customOrientation: property.customOrientation ?? "",
      comparableTransactions: (property.comparableTransactions ?? []).map((item) => ({
        ...item,
        price: String(item.price),
        area: String(item.area),
      })),
    });
    }).finally(() => {
      if (active) setIsLoadingProperty(false);
    });
    return () => { active = false; };
  }, [authReady, userId]);

  function updateField(field: PropertyTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    }
  }

  function inputErrorProps(field: PropertyTextField) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `${field}-error` : undefined,
    };
  }

  function handleCityChange(city: string) {
    setForm((current) => ({ ...current, city, district: "" }));
    handleLocationConfirmation(null);
    setErrors((current) => ({ ...current, city: undefined, district: undefined, form: undefined }));
  }

  function handleLocationConfirmation(location: ConfirmedPropertyLocation | null) {
    setConfirmedLocation(location);
    if (location) {
      setForm((current) => ({
        ...current,
        name: location.name,
        city: location.city,
        district: location.district,
        address: location.formattedAddress,
      }));
      setErrors((current) => ({
        ...current,
        city: undefined,
        district: undefined,
        address: undefined,
        form: undefined,
      }));
    } else if (!editingId) {
      setForm((current) => ({ ...current, name: "" }));
    }
  }

  function updateComparable(id: string, field: keyof Omit<ComparableFormRow, "id">, value: string | boolean) {
    setForm((current) => ({
      ...current,
      comparableTransactions: current.comparableTransactions.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }));
    if (errors.comparableTransactions) setErrors((current) => ({ ...current, comparableTransactions: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const floorLevel = form.floorLevel as FloorLevel;
    const floorLabel = FLOOR_LEVEL_OPTIONS.find((option) => option.value === floorLevel)?.label ?? "";
    const floorDetail = form.floorNumber.trim() && form.totalFloors.trim()
      ? `${form.floorNumber}/${form.totalFloors}层`
      : form.floorNumber.trim()
        ? `${form.floorNumber}层`
        : form.totalFloors.trim()
          ? `共${form.totalFloors}层`
          : "";
    const selectedLayout = form.layout === "其他" ? form.customLayout.trim() || "其他" : form.layout;
    const layoutCounts = parseLayoutCounts(selectedLayout);
    const resolvedName = confirmedLocation?.name ?? (form.name.trim() || form.address.trim());
    const input: PropertyInput = {
      name: resolvedName,
      city: confirmedLocation?.city ?? form.city.trim(),
      district: confirmedLocation?.district ?? form.district.trim(),
      address: confirmedLocation?.formattedAddress ?? form.address.trim(),
      totalPrice: Number(form.totalPrice),
      area: Number(form.area),
      layout: selectedLayout,
      rooms: layoutCounts.rooms,
      livingRooms: layoutCounts.livingRooms,
      bathrooms: layoutCounts.bathrooms,
      customLayout: form.layout === "其他" ? form.customLayout.trim() || null : null,
      floor: floorDetail ? `${floorLabel} · ${floorDetail}` : floorLabel,
      floorLevel,
      floorNumber: form.floorNumber.trim() ? Number(form.floorNumber) : null,
      totalFloors: form.totalFloors.trim() ? Number(form.totalFloors) : null,
      metroDistance: form.metroDistance.trim() ? Number(form.metroDistance) : null,
      schoolInformation: form.schoolInformation.trim(),
      propertyManagementInformation: form.propertyManagementInformation.trim(),
      propertyCompany: form.propertyManagementInformation.trim() || null,
      propertyFee: form.propertyFee.trim() ? Number(form.propertyFee) : null,
      greenRatio: form.greenRatio.trim() ? Number(form.greenRatio) : null,
      parkingRatio: form.parkingRatio.trim() ? Number(form.parkingRatio) : null,
      propertyManagementExperience: form.propertyManagementExperience as SubjectiveQualityLevel,
      publicAreaMaintenance: form.publicAreaMaintenance as SubjectiveQualityLevel,
      communityEnvironmentExperience: form.communityEnvironmentExperience as SubjectiveQualityLevel,
      noiseExperience: form.noiseExperience as NoiseExperienceLevel,
      parkingExperience: form.parkingExperience as SubjectiveQualityLevel,
      maintenanceCondition: form.maintenanceCondition as SubjectiveQualityLevel,
      propertyExperience: form.propertyExperience.trim() || null,
      environment: form.environment.trim() || null,
      noise: form.noise.trim() || null,
      parking: form.parking.trim() || null,
      publicArea: form.publicArea.trim() || null,
      actualCommuteExperience: form.actualCommuteExperience.trim() || null,
      recentDealPrice: form.recentDealPrice.trim() ? Number(form.recentDealPrice) : null,
      listingPrice: form.listingPrice.trim() ? Number(form.listingPrice) : null,
      deliveryYear: form.deliveryYear.trim() ? Number(form.deliveryYear) : null,
      orientation: form.orientation ? form.orientation as Orientation : null,
      customOrientation: form.orientation === "other" ? form.customOrientation.trim() || null : null,
      comparableTransactions: form.comparableTransactions.map((item): ComparableTransaction => ({
        id: item.id,
        price: Number(item.price),
        area: Number(item.area),
        transactionDate: item.transactionDate,
        source: item.source.trim(),
        confirmed: item.confirmed,
      })),
      confirmedLocation,
    };

    setIsSubmitting(true);
    try {
      if (editingId) await updatePersistedProperty(editingId, input, userId);
      else await createPersistedProperty(input, userId);
      router.push("/properties");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "保存失败，请稍后重试。" });
      setIsSubmitting(false);
    }
  }

  if (isLoadingProperty) return <div className="card mt-7 h-64 animate-pulse" aria-label="正在读取您的房源" />;

  if (demoActive) {
    return (
      <Card className="mt-7 p-7 text-center">
        <h2 className="text-xl font-semibold">示例体验中暂不管理真实房源</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#777a75]">示例房源仅用于演示。请先退出示例体验，再添加或编辑自己的候选房源。</p>
        <Button asChild className="mt-6"><Link href="/properties"><ArrowLeft size={17} />返回示例房源</Link></Button>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-6">
      {errors.form && <div className="rounded-xl border border-[#e5c9c3] bg-[#fff7f5] px-5 py-4 text-sm text-[#934b40]" role="alert">{errors.form}</div>}

      <Card>
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-[#f1f3ee] text-[#687b60]"><Building2 size={20} /></span>
            <div><CardTitle>基本房源信息</CardTitle><CardDescription>用于识别房源并建立统一比较结构。</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 px-6 py-6 sm:px-8 lg:grid-cols-2">
          <LocationConfirmation
            city={form.city}
            district={form.district}
            keyword={form.address}
            confirmedLocation={confirmedLocation}
            errors={{ city: errors.city, district: errors.district, address: errors.address }}
            onCityChange={handleCityChange}
            onDistrictChange={(district) => updateField("district", district)}
            onKeywordChange={(keyword) => updateField("address", keyword)}
            onConfirm={handleLocationConfirmation}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <CardTitle>价格与户型</CardTitle><CardDescription>预期成交价单位为万元，面积单位为平方米。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <div>
            <Label htmlFor="listingPrice">挂牌价（万元，选填）</Label>
            <Input id="listingPrice" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.listingPrice} onChange={(event) => updateField("listingPrice", event.target.value)} placeholder="例如：228" {...inputErrorProps("listingPrice")} />
            <FieldError id="listingPrice-error" message={errors.listingPrice} />
            <p className="mt-2 text-sm leading-6 text-[#777a74]">当前业主/平台挂牌价格，可选。</p>
          </div>
          <div>
            <Label htmlFor="totalPrice">预期成交总价（万元）*</Label>
            <Input id="totalPrice" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.totalPrice} onChange={(e) => updateField("totalPrice", e.target.value)} placeholder="例如：220" aria-describedby={errors.totalPrice ? "totalPrice-error totalPrice-help" : "totalPrice-help"} aria-invalid={Boolean(errors.totalPrice)} />
            <FieldError id="totalPrice-error" message={errors.totalPrice} />
            <p id="totalPrice-help" className="mt-2 text-sm leading-6 text-[#777a74]">根据当前谈价预期填写；若尚未谈价，可结合挂牌价和近期成交参考估算。</p>
          </div>
          <div>
            <Label htmlFor="area">建筑面积（㎡）*</Label>
            <Input id="area" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.area} onChange={(e) => updateField("area", e.target.value)} placeholder="例如：89.5" {...inputErrorProps("area")} />
            <FieldError id="area-error" message={errors.area} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="layout">户型 *</Label>
            <select id="layout" className={SELECT_CLASS} value={form.layout} onChange={(event) => updateField("layout", event.target.value)} {...inputErrorProps("layout")}>
              <option value="">请选择户型</option>
              {LAYOUT_OPTIONS.map((layout) => <option key={layout} value={layout}>{layout}</option>)}
            </select>
            <FieldError id="layout-error" message={errors.layout} />
            {form.layout === "其他" && <Input id="customLayout" className="mt-3" value={form.customLayout} onChange={(event) => updateField("customLayout", event.target.value)} placeholder="自定义户型（选填）" aria-label="自定义户型" />}
          </div>
          <div>
            <Label htmlFor="floorLevel">所在楼层 *</Label>
            <select id="floorLevel" className={SELECT_CLASS} value={form.floorLevel} onChange={(event) => updateField("floorLevel", event.target.value)} {...inputErrorProps("floorLevel")}>
              <option value="">请选择所在楼层</option>
              {FLOOR_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <FieldError id="floorLevel-error" message={errors.floorLevel} />
          </div>
          <div>
            <Label htmlFor="floorNumber">实际楼层（选填）</Label>
            <Input id="floorNumber" className="mt-2" type="number" min="1" step="1" inputMode="numeric" value={form.floorNumber} onChange={(event) => updateField("floorNumber", event.target.value)} placeholder="例如：25" {...inputErrorProps("floorNumber")} />
            <FieldError id="floorNumber-error" message={errors.floorNumber} />
          </div>
          <div>
            <Label htmlFor="totalFloors">总楼层（选填）</Label>
            <Input id="totalFloors" className="mt-2" type="number" min="1" step="1" inputMode="numeric" value={form.totalFloors} onChange={(event) => updateField("totalFloors", event.target.value)} placeholder="例如：32" {...inputErrorProps("totalFloors")} />
            <FieldError id="totalFloors-error" message={errors.totalFloors} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <CardTitle>生活与服务信息</CardTitle>
          <CardDescription>可暂时留空。信息缺失只会降低未来分析可信度，不代表房源较差。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-6 py-6 sm:px-8 lg:grid-cols-2">
          <p className="rounded-xl bg-[#f4f5f1] px-4 py-3 text-sm leading-6 text-[#686d65] lg:col-span-2">{confirmedLocation ? "公共交通信息将在分析时根据已确认位置自动获取。" : "确认房源位置后，系统将自动获取地铁和公交信息。"}</p>
          <div id="school-information" className="scroll-mt-24 rounded-lg target:ring-2 target:ring-[#aebda8] target:ring-offset-4">
            <Label htmlFor="schoolInformation" className="flex items-center gap-2"><School size={16} /> 学校信息</Label>
            <Textarea id="schoolInformation" className="mt-2" value={form.schoolInformation} onChange={(e) => updateField("schoolInformation", e.target.value)} placeholder="例如：实验小学，入学资格待确认" />
          </div>
          <div>
            <Label htmlFor="propertyManagementInformation">物业公司 / 管理主体</Label>
            <Input id="propertyManagementInformation" list="property-management-options" className="mt-2" value={form.propertyManagementInformation} onChange={(e) => updateField("propertyManagementInformation", e.target.value)} placeholder="搜索或手动输入物业公司" />
            <datalist id="property-management-options">{PROPERTY_MANAGEMENT_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
            <p className="mt-2 text-sm leading-6 text-[#777a74]">列表不完整；其他物业可直接手动输入。记录公司名称仅表示管理主体已知，不代表服务质量评分。</p>
          </div>
        </CardContent>
      </Card>

      <Card id="supplemental-information">
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <CardTitle>补充分析信息</CardTitle>
          <CardDescription>全部选填。客观数值保持原始事实，现场体验会明确标记为用户观察；信息不足不会被自动记为低分。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 py-6 sm:px-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label htmlFor="deliveryYear">交付年份</Label>
              <Input id="deliveryYear" className="mt-2" type="number" min="1900" max="2100" step="1" inputMode="numeric" value={form.deliveryYear} onChange={(event) => updateField("deliveryYear", event.target.value)} placeholder="例如：2018" {...inputErrorProps("deliveryYear")} />
              <FieldError id="deliveryYear-error" message={errors.deliveryYear} />
            </div>
            <div>
              <Label htmlFor="orientation">朝向</Label>
              <select id="orientation" className={SELECT_CLASS} value={form.orientation} onChange={(event) => updateField("orientation", event.target.value)}>
                <option value="">请选择朝向（选填）</option>
                {ORIENTATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {form.orientation === "other" && <Input id="customOrientation" className="mt-3" value={form.customOrientation} onChange={(event) => updateField("customOrientation", event.target.value)} placeholder="自定义朝向（选填）" aria-label="自定义朝向" />}
            </div>
          </div>

          <div className="scroll-mt-24 rounded-xl border-t border-[#eceae5] pt-6 target:ring-2 target:ring-[#aebda8] target:ring-offset-4" id="property-service">
            <div>
              <Label>物业与小区现场信息</Label>
              <p className="mt-1 text-sm leading-6 text-[#777a74]">记录你实地看房或可靠渠道获得的信息。系统会将其作为补充证据，并结合公开信息重新评估可信度；不会仅凭单条主观描述直接生成高分。</p>
            </div>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="propertyFee">物业费（元/㎡/月）</Label>
                <Input id="propertyFee" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.propertyFee} onChange={(event) => updateField("propertyFee", event.target.value)} placeholder="例如：3.8" {...inputErrorProps("propertyFee")} />
                <FieldError id="propertyFee-error" message={errors.propertyFee} />
              </div>
              <div><Label htmlFor="greenRatio">绿化率（%）</Label><Input id="greenRatio" className="mt-2" type="number" min="0" max="100" step="0.1" inputMode="decimal" value={form.greenRatio} onChange={(event) => updateField("greenRatio", event.target.value)} placeholder="例如：30" {...inputErrorProps("greenRatio")} /><FieldError id="greenRatio-error" message={errors.greenRatio} /></div>
              <div><Label htmlFor="parkingRatio">车位配比（车位/户）</Label><Input id="parkingRatio" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.parkingRatio} onChange={(event) => updateField("parkingRatio", event.target.value)} placeholder="例如：1.1" {...inputErrorProps("parkingRatio")} /><FieldError id="parkingRatio-error" message={errors.parkingRatio} /></div>
              <ObservationSelect id="propertyManagementExperience" label="物业服务体验" value={form.propertyManagementExperience} options={QUALITY_OPTIONS} onChange={(value) => updateField("propertyManagementExperience", value)} />
              <ObservationSelect id="publicAreaMaintenance" label="公共区域维护" value={form.publicAreaMaintenance} options={QUALITY_OPTIONS} onChange={(value) => updateField("publicAreaMaintenance", value)} />
              <ObservationSelect id="communityEnvironmentExperience" label="小区环境体验" value={form.communityEnvironmentExperience} options={QUALITY_OPTIONS} onChange={(value) => updateField("communityEnvironmentExperience", value)} />
              <ObservationSelect id="noiseExperience" label="噪音影响" value={form.noiseExperience} options={NOISE_OPTIONS} onChange={(value) => updateField("noiseExperience", value)} />
              <ObservationSelect id="parkingExperience" label="停车体验" value={form.parkingExperience} options={QUALITY_OPTIONS} onChange={(value) => updateField("parkingExperience", value)} />
              <ObservationSelect id="maintenanceCondition" label="整体维护状况" value={form.maintenanceCondition} options={QUALITY_OPTIONS} onChange={(value) => updateField("maintenanceCondition", value)} />
            </div>
          </div>

          <div id="transaction-references" className="scroll-mt-24 rounded-xl border-t border-[#eceae5] pt-6 target:ring-2 target:ring-[#aebda8] target:ring-offset-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label>近期成交参考</Label>
                <p className="mt-1 text-sm leading-6 text-[#777a74]">未确认记录只作为待核验线索；至少 3 条近 24 个月、信息完整且已确认的记录，才可能计算成交价合理性。</p>
              </div>
              <Button type="button" className="bg-white text-[#4f5f49] ring-1 ring-[#dcdad4] hover:bg-[#f3f4ef]" onClick={() => setForm((current) => ({ ...current, comparableTransactions: [...current.comparableTransactions, createComparableRow()] }))}>
                <Plus size={16} /> 添加成交参考
              </Button>
            </div>
            <FieldError id="comparableTransactions-error" message={errors.comparableTransactions} />

            <div className="mt-4 space-y-3">
              {form.comparableTransactions.map((item, index) => (
                <div key={item.id} className="grid gap-3 rounded-xl border border-[#e6e4de] bg-[#faf9f6] p-4 md:grid-cols-[1fr_1fr_1.2fr_1.4fr_auto_auto] md:items-end">
                  <div><Label htmlFor={`comparable-price-${item.id}`}>成交价（万）</Label><Input id={`comparable-price-${item.id}`} className="mt-2" type="number" min="0" step="0.01" value={item.price} onChange={(event) => updateComparable(item.id, "price", event.target.value)} /></div>
                  <div><Label htmlFor={`comparable-area-${item.id}`}>面积（㎡）</Label><Input id={`comparable-area-${item.id}`} className="mt-2" type="number" min="0" step="0.01" value={item.area} onChange={(event) => updateComparable(item.id, "area", event.target.value)} /></div>
                  <div><Label htmlFor={`comparable-date-${item.id}`}>成交日期</Label><Input id={`comparable-date-${item.id}`} className="mt-2" type="date" value={item.transactionDate} onChange={(event) => updateComparable(item.id, "transactionDate", event.target.value)} /></div>
                  <div><Label htmlFor={`comparable-source-${item.id}`}>来源</Label><Input id={`comparable-source-${item.id}`} className="mt-2" value={item.source} onChange={(event) => updateComparable(item.id, "source", event.target.value)} placeholder="例如：中介成交记录" /></div>
                  <label className="flex h-11 items-center gap-2 whitespace-nowrap text-[13px] text-[#5f625d]"><input type="checkbox" checked={item.confirmed} onChange={(event) => updateComparable(item.id, "confirmed", event.target.checked)} /> 已确认</label>
                  <button type="button" className="grid size-11 place-items-center rounded-lg border border-[#eadedb] text-[#9b5a50] hover:bg-[#fcf2f0]" onClick={() => setForm((current) => ({ ...current, comparableTransactions: current.comparableTransactions.filter((row) => row.id !== item.id) }))} aria-label={`删除第 ${index + 1} 条成交参考`}><Trash2 size={16} /></button>
                </div>
              ))}
              {form.comparableTransactions.length === 0 && <p className="rounded-xl border border-dashed border-[#dcd9d1] px-4 py-5 text-center text-sm text-[#8a8c87]">尚未添加成交参考，可稍后编辑房源补充。</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 rounded-2xl border border-[#e6e4de] bg-white/70 p-5 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/properties" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm text-[#60635e] transition hover:bg-[#f1f0eb]"><ArrowLeft size={17} /> 返回房源列表</Link>
        <Button type="submit" disabled={isSubmitting} className="min-w-48 disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting ? "正在保存…" : editingId ? "更新房源" : "保存房源"}
        </Button>
      </div>
    </form>
  );
}
