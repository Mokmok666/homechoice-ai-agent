"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Building2, MapPin, School, TrainFront } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProperty, getProperty, updateProperty } from "@/lib/property-storage";
import type { PropertyInput } from "@/types/property";

interface PropertyFormState {
  name: string;
  city: string;
  district: string;
  address: string;
  totalPrice: string;
  area: string;
  layout: string;
  floor: string;
  metroDistance: string;
  schoolInformation: string;
  propertyManagementInformation: string;
}

type FormErrors = Partial<Record<keyof PropertyFormState | "form", string>>;

const EMPTY_FORM: PropertyFormState = {
  name: "",
  city: "",
  district: "",
  address: "",
  totalPrice: "",
  area: "",
  layout: "",
  floor: "",
  metroDistance: "",
  schoolInformation: "",
  propertyManagementInformation: "",
};

function validateForm(form: PropertyFormState): FormErrors {
  const errors: FormErrors = {};
  const requiredFields: Array<[keyof PropertyFormState, string]> = [
    ["name", "请输入房源名称。"],
    ["city", "请输入城市。"],
    ["district", "请输入行政区。"],
    ["address", "请输入详细地址。"],
    ["layout", "请输入户型。"],
    ["floor", "请输入楼层。"],
  ];

  for (const [field, message] of requiredFields) {
    if (!form[field].trim()) errors[field] = message;
  }

  const totalPrice = Number(form.totalPrice);
  if (!form.totalPrice.trim()) errors.totalPrice = "请输入总价。";
  else if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    errors.totalPrice = "总价必须是大于 0 的数字。";
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
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-2 text-xs text-[#a34f43]" role="alert">{message}</p>;
}

export function PropertyForm() {
  const router = useRouter();
  const [form, setForm] = useState<PropertyFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    const property = getProperty(id);
    if (!property) {
      setErrors({ form: "未找到需要编辑的房源，请返回房源列表重试。" });
      return;
    }
    setEditingId(id);
    setForm({
      name: property.name,
      city: property.city,
      district: property.district,
      address: property.address,
      totalPrice: String(property.totalPrice),
      area: String(property.area),
      layout: property.layout,
      floor: property.floor,
      metroDistance: property.metroDistance === null ? "" : String(property.metroDistance),
      schoolInformation: property.schoolInformation,
      propertyManagementInformation: property.propertyManagementInformation,
    });
  }, []);

  function updateField(field: keyof PropertyFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    }
  }

  function inputErrorProps(field: keyof PropertyFormState) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `${field}-error` : undefined,
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const input: PropertyInput = {
      name: form.name.trim(),
      city: form.city.trim(),
      district: form.district.trim(),
      address: form.address.trim(),
      totalPrice: Number(form.totalPrice),
      area: Number(form.area),
      layout: form.layout.trim(),
      floor: form.floor.trim(),
      metroDistance: form.metroDistance.trim() ? Number(form.metroDistance) : null,
      schoolInformation: form.schoolInformation.trim(),
      propertyManagementInformation: form.propertyManagementInformation.trim(),
    };

    setIsSubmitting(true);
    try {
      if (editingId) updateProperty(editingId, input);
      else createProperty(input);
      router.push("/properties");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "保存失败，请稍后重试。" });
      setIsSubmitting(false);
    }
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
        <CardContent className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <Label htmlFor="name">房源名称 *</Label>
            <Input id="name" className="mt-2" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="例如：珠江新城 · 保利天悦" {...inputErrorProps("name")} />
            <FieldError id="name-error" message={errors.name} />
          </div>
          <div>
            <Label htmlFor="city">城市 *</Label>
            <Input id="city" className="mt-2" value={form.city} onChange={(e) => updateField("city", e.target.value)} placeholder="例如：广州" {...inputErrorProps("city")} />
            <FieldError id="city-error" message={errors.city} />
          </div>
          <div>
            <Label htmlFor="district">行政区 *</Label>
            <Input id="district" className="mt-2" value={form.district} onChange={(e) => updateField("district", e.target.value)} placeholder="例如：天河区" {...inputErrorProps("district")} />
            <FieldError id="district-error" message={errors.district} />
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor="address">详细地址 *</Label>
            <div className="relative mt-2">
              <MapPin size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
              <Input id="address" className="pl-11" value={form.address} onChange={(e) => updateField("address", e.target.value)} placeholder="请输入街道、道路或楼栋信息" {...inputErrorProps("address")} />
            </div>
            <FieldError id="address-error" message={errors.address} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <CardTitle>价格与户型</CardTitle><CardDescription>总价单位为万元，面积单位为平方米。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 px-6 py-7 sm:grid-cols-2 sm:px-8">
          <div>
            <Label htmlFor="totalPrice">房源总价（万元）*</Label>
            <Input id="totalPrice" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.totalPrice} onChange={(e) => updateField("totalPrice", e.target.value)} placeholder="例如：220" {...inputErrorProps("totalPrice")} />
            <FieldError id="totalPrice-error" message={errors.totalPrice} />
          </div>
          <div>
            <Label htmlFor="area">建筑面积（㎡）*</Label>
            <Input id="area" className="mt-2" type="number" min="0" step="0.01" inputMode="decimal" value={form.area} onChange={(e) => updateField("area", e.target.value)} placeholder="例如：89.5" {...inputErrorProps("area")} />
            <FieldError id="area-error" message={errors.area} />
          </div>
          <div>
            <Label htmlFor="layout">户型 *</Label>
            <Input id="layout" className="mt-2" value={form.layout} onChange={(e) => updateField("layout", e.target.value)} placeholder="例如：3室2厅2卫" {...inputErrorProps("layout")} />
            <FieldError id="layout-error" message={errors.layout} />
          </div>
          <div>
            <Label htmlFor="floor">楼层 *</Label>
            <Input id="floor" className="mt-2" value={form.floor} onChange={(e) => updateField("floor", e.target.value)} placeholder="例如：中高层 / 共 32 层" {...inputErrorProps("floor")} />
            <FieldError id="floor-error" message={errors.floor} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
          <CardTitle>生活与服务信息</CardTitle>
          <CardDescription>可暂时留空。信息缺失只会降低未来分析可信度，不代表房源较差。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <Label htmlFor="metroDistance">距离最近地铁站（米）</Label>
            <div className="relative mt-2">
              <TrainFront size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" />
              <Input id="metroDistance" className="pl-11" type="number" min="0" step="1" inputMode="numeric" value={form.metroDistance} onChange={(e) => updateField("metroDistance", e.target.value)} placeholder="例如：650" {...inputErrorProps("metroDistance")} />
            </div>
            <FieldError id="metroDistance-error" message={errors.metroDistance} />
          </div>
          <div>
            <Label htmlFor="schoolInformation" className="flex items-center gap-2"><School size={16} /> 学校信息</Label>
            <Textarea id="schoolInformation" className="mt-2" value={form.schoolInformation} onChange={(e) => updateField("schoolInformation", e.target.value)} placeholder="例如：实验小学，入学资格待确认" />
          </div>
          <div>
            <Label htmlFor="propertyManagementInformation">物业管理信息</Label>
            <Textarea id="propertyManagementInformation" className="mt-2" value={form.propertyManagementInformation} onChange={(e) => updateField("propertyManagementInformation", e.target.value)} placeholder="例如：保利物业，公区维护良好，物业费 4.8 元/㎡/月" />
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
