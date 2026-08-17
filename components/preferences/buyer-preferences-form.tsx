"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, GraduationCap, LockKeyhole, MapPin, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadBuyerPreferences, saveBuyerPreferences } from "@/lib/buyer-preferences-storage";
import {
  COMMUTE_MODES,
  DECISION_PRIORITIES,
  EDUCATION_NEEDS,
  EDUCATION_STAGES,
  PURCHASE_PURPOSES,
  type BuyerPreferences,
  type BuyerPreferencesInput,
  type CommuteMode,
  type DecisionPriority,
  type EducationNeed,
  type EducationStage,
  type PurchasePurpose,
} from "@/types/buyer-preferences";
import {
  COMMUTE_MODE_LABELS,
  EDUCATION_NEED_LABELS,
  EDUCATION_STAGE_LABELS,
  PRIORITY_LABELS,
  PURCHASE_PURPOSE_LABELS,
  PreferenceSummary,
} from "./preference-summary";

interface PreferenceFormState {
  purchasePurpose: PurchasePurpose | "";
  maximumBudget: string;
  primaryWorkLocation: string;
  partnerWorkLocation: string;
  commuteMode: CommuteMode | "";
  idealCommuteMinutes: string;
  maxCommuteMinutes: string;
  educationNeed: EducationNeed | "";
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
}

type FieldName = keyof PreferenceFormState;
type FormErrors = Partial<Record<FieldName | "form", string>>;

const EMPTY_FORM: PreferenceFormState = {
  purchasePurpose: "",
  maximumBudget: "",
  primaryWorkLocation: "",
  partnerWorkLocation: "",
  commuteMode: "",
  idealCommuteMinutes: "",
  maxCommuteMinutes: "",
  educationNeed: "",
  educationStages: [],
  topPriorities: [],
};

function validateForm(form: PreferenceFormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.purchasePurpose) errors.purchasePurpose = "请选择购房目标。";

  const budget = Number(form.maximumBudget);
  if (!form.maximumBudget.trim()) errors.maximumBudget = "请输入最高可接受总价。";
  else if (!Number.isFinite(budget) || budget <= 0) errors.maximumBudget = "最高可接受总价必须是大于 0 的数字。";

  if (!form.commuteMode) {
    errors.commuteMode = "请选择通勤方式。";
  } else if (form.commuteMode !== "not_important") {
    if (!form.primaryWorkLocation.trim()) errors.primaryWorkLocation = "请输入主要工作地点。";
    const ideal = Number(form.idealCommuteMinutes);
    const maximum = Number(form.maxCommuteMinutes);
    if (!form.idealCommuteMinutes.trim()) errors.idealCommuteMinutes = "请输入理想单程通勤时间。";
    else if (!Number.isFinite(ideal) || ideal < 0) errors.idealCommuteMinutes = "理想通勤时间必须是大于或等于 0 的数字。";
    if (!form.maxCommuteMinutes.trim()) errors.maxCommuteMinutes = "请输入最长可接受单程通勤时间。";
    else if (!Number.isFinite(maximum) || maximum < 0) errors.maxCommuteMinutes = "最长通勤时间必须是大于或等于 0 的数字。";
    else if (!errors.idealCommuteMinutes && maximum < ideal) errors.maxCommuteMinutes = "最长通勤时间不能小于理想通勤时间。";
  }

  if (!form.educationNeed) errors.educationNeed = "请选择教育需求。";
  else if (form.educationNeed === "current" && form.educationStages.length === 0) {
    errors.educationStages = "请至少选择一个教育阶段。";
  }

  if (form.topPriorities.length !== 3 || new Set(form.topPriorities).size !== 3) {
    errors.topPriorities = "请按重要顺序选择且仅选择 3 个购房因素。";
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-2 text-xs text-[#a34f43]" role="alert">{message}</p>;
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <CardHeader className="border-b border-[#eceae5] px-6 py-5 sm:px-8">
      <div className="flex gap-4">
        <span className="font-serif text-xl text-[#7a8d72]">{number}</span>
        <div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>
      </div>
    </CardHeader>
  );
}

function ChoiceButton({ selected, disabled = false, onClick, children, describedBy }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; describedBy?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm transition ${selected ? "border-[#798d72] bg-[#f1f4ef] text-[#53664d] shadow-[inset_0_0_0_1px_rgba(121,141,114,.12)]" : "border-[#deddd8] bg-white text-[#4e514c] hover:border-[#a8b3a3]"} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
      {selected && <Check size={16} className="ml-auto shrink-0" />}
    </button>
  );
}

export function BuyerPreferencesForm() {
  const router = useRouter();
  const [form, setForm] = useState<PreferenceFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [existingPreferences, setExistingPreferences] = useState<BuyerPreferences | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const result = loadBuyerPreferences();
    if (result.status === "invalid") {
      setStorageWarning(result.message);
      return;
    }
    if (result.status !== "valid") return;
    const saved = result.preferences;
    setExistingPreferences(saved);
    setForm({
      purchasePurpose: saved.purchasePurpose,
      maximumBudget: String(saved.maximumBudget),
      primaryWorkLocation: saved.primaryWorkLocation,
      partnerWorkLocation: saved.partnerWorkLocation ?? "",
      commuteMode: saved.commuteMode,
      idealCommuteMinutes: saved.idealCommuteMinutes === null ? "" : String(saved.idealCommuteMinutes),
      maxCommuteMinutes: saved.maxCommuteMinutes === null ? "" : String(saved.maxCommuteMinutes),
      educationNeed: saved.educationNeed,
      educationStages: saved.educationStages,
      topPriorities: saved.topPriorities,
    });
  }, []);

  function updateField<K extends keyof PreferenceFormState>(field: K, value: PreferenceFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field] || errors.form) setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function selectCommuteMode(mode: CommuteMode) {
    setForm((current) => ({
      ...current,
      commuteMode: mode,
      idealCommuteMinutes: mode === "not_important" ? "" : current.idealCommuteMinutes,
      maxCommuteMinutes: mode === "not_important" ? "" : current.maxCommuteMinutes,
    }));
    setErrors((current) => ({ ...current, commuteMode: undefined, primaryWorkLocation: undefined, idealCommuteMinutes: undefined, maxCommuteMinutes: undefined }));
  }

  function selectEducationNeed(value: EducationNeed) {
    setForm((current) => ({ ...current, educationNeed: value, educationStages: value === "none" ? [] : current.educationStages }));
    setErrors((current) => ({ ...current, educationNeed: undefined, educationStages: undefined }));
  }

  function toggleEducationStage(stage: EducationStage) {
    const stages = form.educationStages.includes(stage)
      ? form.educationStages.filter((item) => item !== stage)
      : [...form.educationStages, stage];
    updateField("educationStages", stages);
  }

  function togglePriority(priority: DecisionPriority) {
    const priorities = form.topPriorities.includes(priority)
      ? form.topPriorities.filter((item) => item !== priority)
      : form.topPriorities.length < 3 ? [...form.topPriorities, priority] : form.topPriorities;
    updateField("topPriorities", priorities);
  }

  function errorProps(field: FieldName) {
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

    const input: BuyerPreferencesInput = {
      purchasePurpose: form.purchasePurpose as PurchasePurpose,
      maximumBudget: Number(form.maximumBudget),
      primaryWorkLocation: form.primaryWorkLocation.trim(),
      partnerWorkLocation: form.partnerWorkLocation.trim() || null,
      commuteMode: form.commuteMode as CommuteMode,
      idealCommuteMinutes: form.commuteMode === "not_important" ? null : Number(form.idealCommuteMinutes),
      maxCommuteMinutes: form.commuteMode === "not_important" ? null : Number(form.maxCommuteMinutes),
      educationNeed: form.educationNeed as EducationNeed,
      educationStages: form.educationNeed === "none" ? [] : form.educationStages,
      topPriorities: form.topPriorities,
    };

    setIsSubmitting(true);
    try {
      saveBuyerPreferences(input, existingPreferences);
      router.push("/results");
    } catch {
      setErrors({ form: "偏好保存失败，请确认浏览器允许本地存储后重试。" });
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-7">
      {storageWarning && <div className="mb-5 rounded-xl border border-[#dccb9d] bg-[#fffaf0] px-5 py-4 text-sm text-[#78622d]" role="alert">{storageWarning}</div>}
      {errors.form && <div className="mb-5 rounded-xl border border-[#e5c9c3] bg-[#fff7f5] px-5 py-4 text-sm text-[#934b40]" role="alert">{errors.form}</div>}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div className="space-y-6">
          <Card>
            <SectionHeading number="01" title="购房目标" description="选择最符合这次购房决策的主要目标。" />
            <CardContent className="grid gap-3 px-6 py-7 sm:grid-cols-3 sm:px-8" aria-invalid={Boolean(errors.purchasePurpose)} aria-describedby={errors.purchasePurpose ? "purchasePurpose-error" : undefined}>
              {PURCHASE_PURPOSES.map((purpose) => <ChoiceButton key={purpose} selected={form.purchasePurpose === purpose} onClick={() => updateField("purchasePurpose", purpose)}>{PURCHASE_PURPOSE_LABELS[purpose]}</ChoiceButton>)}
              <div className="sm:col-span-3"><FieldError id="purchasePurpose-error" message={errors.purchasePurpose} /></div>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="02" title="资金约束" description="记录家庭对单套房产总价的最高承受边界。" />
            <CardContent className="px-6 py-7 sm:px-8">
              <Label htmlFor="maximumBudget">最高可接受总价（万元）*</Label>
              <div className="relative mt-2 max-w-md"><WalletCards size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#84907e]" /><Input id="maximumBudget" type="number" min="0" step="0.01" inputMode="decimal" className="pl-11" value={form.maximumBudget} onChange={(event) => updateField("maximumBudget", event.target.value)} placeholder="例如：250" {...errorProps("maximumBudget")} /></div>
              <FieldError id="maximumBudget-error" message={errors.maximumBudget} />
              <p className="mt-4 rounded-xl bg-[#f4f3ef] px-4 py-3 text-xs leading-5 text-[#666962]">房源是否买贵，将根据预期成交价和近期真实成交判断，不由最高预算决定。</p>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="03" title="家庭通勤" description="记录家庭可接受的通勤方式与时间边界。" />
            <CardContent className="space-y-6 px-6 py-7 sm:px-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <div><Label htmlFor="primaryWorkLocation">主要工作地点{form.commuteMode !== "not_important" ? " *" : ""}</Label><div className="relative mt-2"><MapPin size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8a8d87]" /><Input id="primaryWorkLocation" className="pl-11" value={form.primaryWorkLocation} onChange={(event) => updateField("primaryWorkLocation", event.target.value)} placeholder="例如：珠江新城" {...errorProps("primaryWorkLocation")} /></div><FieldError id="primaryWorkLocation-error" message={errors.primaryWorkLocation} /></div>
                <div><Label htmlFor="partnerWorkLocation">伴侣工作地点（选填）</Label><Input id="partnerWorkLocation" className="mt-2" value={form.partnerWorkLocation} onChange={(event) => updateField("partnerWorkLocation", event.target.value)} placeholder="例如：琶洲" /></div>
              </div>
              <div><Label>通勤方式 *</Label><div className="mt-2 grid gap-3 sm:grid-cols-2" aria-invalid={Boolean(errors.commuteMode)} aria-describedby={errors.commuteMode ? "commuteMode-error" : undefined}>{COMMUTE_MODES.map((mode) => <ChoiceButton key={mode} selected={form.commuteMode === mode} onClick={() => selectCommuteMode(mode)}>{COMMUTE_MODE_LABELS[mode]}</ChoiceButton>)}</div><FieldError id="commuteMode-error" message={errors.commuteMode} /></div>
              {form.commuteMode !== "not_important" && <div className="grid gap-5 sm:grid-cols-2">
                <div><Label htmlFor="idealCommuteMinutes">理想单程通勤时间（分钟）*</Label><Input id="idealCommuteMinutes" className="mt-2" type="number" min="0" step="1" inputMode="numeric" value={form.idealCommuteMinutes} onChange={(event) => updateField("idealCommuteMinutes", event.target.value)} placeholder="例如：30" {...errorProps("idealCommuteMinutes")} /><FieldError id="idealCommuteMinutes-error" message={errors.idealCommuteMinutes} /></div>
                <div><Label htmlFor="maxCommuteMinutes">最长可接受单程通勤时间（分钟）*</Label><Input id="maxCommuteMinutes" className="mt-2" type="number" min="0" step="1" inputMode="numeric" value={form.maxCommuteMinutes} onChange={(event) => updateField("maxCommuteMinutes", event.target.value)} placeholder="例如：50" {...errorProps("maxCommuteMinutes")} /><FieldError id="maxCommuteMinutes-error" message={errors.maxCommuteMinutes} /></div>
              </div>}
              <p className="rounded-xl bg-[#f4f3ef] px-4 py-3 text-xs leading-5 text-[#666962]">当前阶段只记录你的通勤偏好，真实通勤时间将在后续分析阶段计算。</p>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="04" title="教育需求" description="记录家庭当前或未来的教育需求，不对学校入学资格作任何保证。" />
            <CardContent className="space-y-6 px-6 py-7 sm:px-8">
              <div><Label>教育需求 *</Label><div className="mt-2 grid gap-3 sm:grid-cols-3" aria-invalid={Boolean(errors.educationNeed)} aria-describedby={errors.educationNeed ? "educationNeed-error" : undefined}>{EDUCATION_NEEDS.map((need) => <ChoiceButton key={need} selected={form.educationNeed === need} onClick={() => selectEducationNeed(need)}><GraduationCap size={17} />{EDUCATION_NEED_LABELS[need]}</ChoiceButton>)}</div><FieldError id="educationNeed-error" message={errors.educationNeed} /></div>
              {form.educationNeed && form.educationNeed !== "none" && <div><Label>{form.educationNeed === "current" ? "当前主要关注哪个教育阶段？*" : "未来预计关注哪个教育阶段？（选填）"}</Label><div className="mt-2 grid gap-3 sm:grid-cols-2" aria-invalid={Boolean(errors.educationStages)} aria-describedby={errors.educationStages ? "educationStages-error" : undefined}>{EDUCATION_STAGES.map((stage) => <ChoiceButton key={stage} selected={form.educationStages.includes(stage)} onClick={() => toggleEducationStage(stage)}>{EDUCATION_STAGE_LABELS[stage]}</ChoiceButton>)}</div><FieldError id="educationStages-error" message={errors.educationStages} /></div>}
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="05" title="最重要的 3 个购房因素" description="点击顺序即重要程度；取消后可重新选择。" />
            <CardContent className="px-6 py-7 sm:px-8">
              <div className="mb-4 flex items-center justify-between"><Label>决策优先级 *</Label><span className={`rounded-full px-3 py-1 text-sm font-medium ${form.topPriorities.length === 3 ? "bg-[#eaf0e7] text-[#5b7054]" : "bg-[#f1f0eb] text-[#73766f]"}`}>{form.topPriorities.length} / 3</span></div>
              <div className="grid gap-3 sm:grid-cols-2" aria-invalid={Boolean(errors.topPriorities)} aria-describedby={errors.topPriorities ? "topPriorities-error" : undefined}>
                {DECISION_PRIORITIES.map((priority) => {
                  const selectedIndex = form.topPriorities.indexOf(priority);
                  const selected = selectedIndex >= 0;
                  return <ChoiceButton key={priority} selected={selected} disabled={!selected && form.topPriorities.length === 3} onClick={() => togglePriority(priority)}>{selected && <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#788b71] text-xs text-white">{selectedIndex + 1}</span>}{PRIORITY_LABELS[priority]}</ChoiceButton>;
                })}
              </div>
              <FieldError id="topPriorities-error" message={errors.topPriorities} />
            </CardContent>
          </Card>
        </div>

        <PreferenceSummary {...form} />
      </div>

      <div className="mt-7 flex flex-col items-center">
        <Button type="submit" disabled={isSubmitting} className="h-14 w-full max-w-md text-base disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "正在保存…" : "保存偏好并查看分析"}<ArrowRight size={18} /></Button>
        <div className="mt-3 flex items-center gap-2 text-xs text-[#8a8c87]"><LockKeyhole size={13} />偏好仅保存在当前浏览器，用于后续分析</div>
      </div>
    </form>
  );
}
