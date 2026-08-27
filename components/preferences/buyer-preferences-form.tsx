"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, GraduationCap, LockKeyhole, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePersistedBuyerPreferences } from "@/lib/buyer-preferences-storage";
import { getEffectiveBuyerPreferences, isDemoModeActive, saveDemoBuyerPreferences } from "@/lib/demo/demo-mode";
import { useSupabaseAuth } from "@/components/providers/supabase-auth-provider";
import { WorkLocationConfirmation } from "./work-location-confirmation";
import {
  SELECTABLE_COMMUTE_MODES,
  DECISION_PRIORITIES,
  EDUCATION_NEEDS,
  EDUCATION_STAGES,
  PURCHASE_PURPOSES,
  type BuyerPreferences,
  type BuyerPreferencesInput,
  type CommuteMode,
  type ConfirmedWorkLocation,
  type SelectableCommuteMode,
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
  primaryWorkLocationConfirmed: ConfirmedWorkLocation | null;
  partnerWorkLocationConfirmed: ConfirmedWorkLocation | null;
  primaryCommuteMode: SelectableCommuteMode | "";
  primaryIdealCommuteMinutes: string;
  primaryMaxCommuteMinutes: string;
  partnerCommuteMode: SelectableCommuteMode | "";
  partnerIdealCommuteMinutes: string;
  partnerMaxCommuteMinutes: string;
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
  primaryWorkLocationConfirmed: null,
  partnerWorkLocationConfirmed: null,
  primaryCommuteMode: "",
  primaryIdealCommuteMinutes: "",
  primaryMaxCommuteMinutes: "",
  partnerCommuteMode: "",
  partnerIdealCommuteMinutes: "",
  partnerMaxCommuteMinutes: "",
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

  if (!form.primaryCommuteMode) {
    errors.primaryCommuteMode = "请选择你的通勤方式。";
  } else if (form.primaryCommuteMode !== "not_important") {
    if (!form.primaryWorkLocation.trim()) errors.primaryWorkLocation = "请输入主要工作地点。";
    else if (!form.primaryWorkLocationConfirmed) errors.primaryWorkLocation = "请查找并确认你的工作地点。";
    const ideal = Number(form.primaryIdealCommuteMinutes);
    const maximum = Number(form.primaryMaxCommuteMinutes);
    if (!form.primaryIdealCommuteMinutes.trim()) errors.primaryIdealCommuteMinutes = "请输入理想单程通勤时间。";
    else if (!Number.isFinite(ideal) || ideal < 0) errors.primaryIdealCommuteMinutes = "理想通勤时间必须是大于或等于 0 的数字。";
    if (!form.primaryMaxCommuteMinutes.trim()) errors.primaryMaxCommuteMinutes = "请输入最长可接受单程通勤时间。";
    else if (!Number.isFinite(maximum) || maximum < 0) errors.primaryMaxCommuteMinutes = "最长通勤时间必须是大于或等于 0 的数字。";
    else if (!errors.primaryIdealCommuteMinutes && maximum < ideal) errors.primaryMaxCommuteMinutes = "最长通勤时间不能小于理想通勤时间。";
  }
  if (form.partnerWorkLocation.trim()) {
    if (!form.partnerWorkLocationConfirmed) errors.partnerWorkLocation = "请查找并确认伴侣工作地点，或移除该地点。";
    if (!form.partnerCommuteMode || form.partnerCommuteMode === "not_important") errors.partnerCommuteMode = "请选择伴侣的通勤方式。";
    const ideal = Number(form.partnerIdealCommuteMinutes);
    const maximum = Number(form.partnerMaxCommuteMinutes);
    if (!form.partnerIdealCommuteMinutes.trim() || !Number.isFinite(ideal) || ideal < 0) errors.partnerIdealCommuteMinutes = "请输入有效的伴侣理想通勤时间。";
    if (!form.partnerMaxCommuteMinutes.trim() || !Number.isFinite(maximum) || maximum < ideal) errors.partnerMaxCommuteMinutes = "伴侣最长通勤时间不能小于理想时间。";
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
      className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-[15px] transition ${selected ? "border-[#798d72] bg-[#f1f4ef] text-[#53664d] shadow-[inset_0_0_0_1px_rgba(121,141,114,.12)]" : "border-[#deddd8] bg-white text-[#4e514c] hover:border-[#a8b3a3]"} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
      {selected && <Check size={16} className="ml-auto shrink-0" />}
    </button>
  );
}

export function BuyerPreferencesForm() {
  const { authReady, userId, supabaseAvailable } = useSupabaseAuth();
  const router = useRouter();
  const [form, setForm] = useState<PreferenceFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [existingPreferences, setExistingPreferences] = useState<BuyerPreferences | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);
  const [demoActive, setDemoActive] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setDemoActive(isDemoModeActive());
    void getEffectiveBuyerPreferences(userId).then((result) => {
    if (!active) return;
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
      primaryWorkLocationConfirmed: saved.primaryWorkLocationConfirmed ?? null,
      partnerWorkLocationConfirmed: saved.partnerWorkLocationConfirmed ?? null,
      primaryCommuteMode: saved.primaryCommuteMode ?? (saved.commuteMode === "both" ? "flexible" : saved.commuteMode),
      primaryIdealCommuteMinutes: (saved.primaryIdealCommuteMinutes ?? saved.idealCommuteMinutes) === null ? "" : String(saved.primaryIdealCommuteMinutes ?? saved.idealCommuteMinutes),
      primaryMaxCommuteMinutes: (saved.primaryMaxCommuteMinutes ?? saved.maxCommuteMinutes) === null ? "" : String(saved.primaryMaxCommuteMinutes ?? saved.maxCommuteMinutes),
      partnerCommuteMode: saved.partnerWorkLocation ? (saved.partnerCommuteMode ?? saved.primaryCommuteMode ?? (saved.commuteMode === "both" ? "flexible" : saved.commuteMode)) : "",
      partnerIdealCommuteMinutes: saved.partnerWorkLocation && (saved.partnerIdealCommuteMinutes ?? saved.primaryIdealCommuteMinutes ?? saved.idealCommuteMinutes) !== null ? String(saved.partnerIdealCommuteMinutes ?? saved.primaryIdealCommuteMinutes ?? saved.idealCommuteMinutes) : "",
      partnerMaxCommuteMinutes: saved.partnerWorkLocation && (saved.partnerMaxCommuteMinutes ?? saved.primaryMaxCommuteMinutes ?? saved.maxCommuteMinutes) !== null ? String(saved.partnerMaxCommuteMinutes ?? saved.primaryMaxCommuteMinutes ?? saved.maxCommuteMinutes) : "",
      educationNeed: saved.educationNeed,
      educationStages: saved.educationStages,
      topPriorities: saved.topPriorities,
    });
    }).finally(() => {
      if (active) setIsLoadingPreferences(false);
    });
    return () => { active = false; };
  }, [authReady, userId]);

  function updateField<K extends keyof PreferenceFormState>(field: K, value: PreferenceFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field] || errors.form) setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function selectPrimaryCommuteMode(mode: SelectableCommuteMode) {
    setForm((current) => ({
      ...current,
      primaryCommuteMode: mode,
      primaryIdealCommuteMinutes: mode === "not_important" ? "" : current.primaryIdealCommuteMinutes,
      primaryMaxCommuteMinutes: mode === "not_important" ? "" : current.primaryMaxCommuteMinutes,
    }));
    setErrors((current) => ({ ...current, primaryCommuteMode: undefined, primaryWorkLocation: undefined, primaryIdealCommuteMinutes: undefined, primaryMaxCommuteMinutes: undefined }));
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      primaryWorkLocationConfirmed: form.primaryWorkLocationConfirmed,
      partnerWorkLocationConfirmed: form.partnerWorkLocation.trim() ? form.partnerWorkLocationConfirmed : null,
      primaryCommuteMode: form.primaryCommuteMode as SelectableCommuteMode,
      primaryIdealCommuteMinutes: form.primaryCommuteMode === "not_important" ? null : Number(form.primaryIdealCommuteMinutes),
      primaryMaxCommuteMinutes: form.primaryCommuteMode === "not_important" ? null : Number(form.primaryMaxCommuteMinutes),
      partnerCommuteMode: form.partnerWorkLocation.trim() ? form.partnerCommuteMode as SelectableCommuteMode : null,
      partnerIdealCommuteMinutes: form.partnerWorkLocation.trim() ? Number(form.partnerIdealCommuteMinutes) : null,
      partnerMaxCommuteMinutes: form.partnerWorkLocation.trim() ? Number(form.partnerMaxCommuteMinutes) : null,
      commuteMode: (form.primaryCommuteMode === "flexible" ? "both" : form.primaryCommuteMode) as CommuteMode,
      idealCommuteMinutes: form.primaryCommuteMode === "not_important" ? null : Number(form.primaryIdealCommuteMinutes),
      maxCommuteMinutes: form.primaryCommuteMode === "not_important" ? null : Number(form.primaryMaxCommuteMinutes),
      educationNeed: form.educationNeed as EducationNeed,
      educationStages: form.educationNeed === "none" ? [] : form.educationStages,
      topPriorities: form.topPriorities,
    };

    setIsSubmitting(true);
    try {
      if (demoActive) saveDemoBuyerPreferences(input, existingPreferences);
      else await savePersistedBuyerPreferences(input, existingPreferences, userId);
      router.push("/results");
    } catch {
      setErrors({ form: "偏好保存失败，请确认浏览器允许本地存储后重试。" });
      setIsSubmitting(false);
    }
  }

  if (isLoadingPreferences) return <div className="card mt-7 h-64 animate-pulse" aria-label="正在读取您的购房偏好" />;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-7">
      {storageWarning && <div className="mb-5 rounded-xl border border-[#dccb9d] bg-[#fffaf0] px-5 py-4 text-sm text-[#78622d]" role="alert">{storageWarning}</div>}
      {errors.form && <div className="mb-5 rounded-xl border border-[#e5c9c3] bg-[#fff7f5] px-5 py-4 text-sm text-[#934b40]" role="alert">{errors.form}</div>}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div className="space-y-6">
          <Card>
            <SectionHeading number="01" title="购房目标" description="选择最符合这次购房决策的主要目标。" />
            <CardContent className="grid gap-3 px-6 py-6 sm:grid-cols-3 sm:px-8" aria-invalid={Boolean(errors.purchasePurpose)} aria-describedby={errors.purchasePurpose ? "purchasePurpose-error" : undefined}>
              {PURCHASE_PURPOSES.map((purpose) => <ChoiceButton key={purpose} selected={form.purchasePurpose === purpose} onClick={() => updateField("purchasePurpose", purpose)}>{PURCHASE_PURPOSE_LABELS[purpose]}</ChoiceButton>)}
              <div className="sm:col-span-3"><FieldError id="purchasePurpose-error" message={errors.purchasePurpose} /></div>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="02" title="资金约束" description="记录家庭对单套房产总价的最高承受边界。" />
            <CardContent className="px-6 py-6 sm:px-8">
              <Label htmlFor="maximumBudget">最高可接受总价（万元）*</Label>
              <div className="relative mt-2 max-w-md"><WalletCards size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#84907e]" /><Input id="maximumBudget" type="number" min="0" step="0.01" inputMode="decimal" className="pl-11" value={form.maximumBudget} onChange={(event) => updateField("maximumBudget", event.target.value)} placeholder="例如：250" {...errorProps("maximumBudget")} /></div>
              <FieldError id="maximumBudget-error" message={errors.maximumBudget} />
              <p className="mt-4 rounded-xl bg-[#f4f3ef] px-4 py-3 text-sm leading-6 text-[#666962]">房源是否买贵，将根据预期成交价和近期真实成交判断，不由最高预算决定。</p>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="03" title="家庭通勤" description="记录家庭可接受的通勤方式与时间边界。" />
            <CardContent className="space-y-5 px-6 py-6 sm:px-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <WorkLocationConfirmation id="primaryWorkLocation" label="我的工作地点" required={form.primaryCommuteMode !== "not_important"} keyword={form.primaryWorkLocation} confirmedLocation={form.primaryWorkLocationConfirmed} error={errors.primaryWorkLocation} onKeywordChange={(value) => updateField("primaryWorkLocation", value)} onConfirm={(location) => updateField("primaryWorkLocationConfirmed", location)} />
                <WorkLocationConfirmation id="partnerWorkLocation" label="伴侣工作地点（选填）" keyword={form.partnerWorkLocation} confirmedLocation={form.partnerWorkLocationConfirmed} error={errors.partnerWorkLocation} onKeywordChange={(value) => updateField("partnerWorkLocation", value)} onConfirm={(location) => updateField("partnerWorkLocationConfirmed", location)} />
              </div>
              <div><Label>你的通勤方式 *</Label><div className="mt-2 grid gap-3 sm:grid-cols-2" aria-invalid={Boolean(errors.primaryCommuteMode)} aria-describedby={errors.primaryCommuteMode ? "primaryCommuteMode-error" : undefined}>{SELECTABLE_COMMUTE_MODES.map((mode) => <ChoiceButton key={mode} selected={form.primaryCommuteMode === mode} onClick={() => selectPrimaryCommuteMode(mode)}>{COMMUTE_MODE_LABELS[mode]}</ChoiceButton>)}</div><FieldError id="primaryCommuteMode-error" message={errors.primaryCommuteMode} /></div>
              {form.primaryCommuteMode !== "not_important" && <div className="grid gap-5 sm:grid-cols-2">
                <div><Label htmlFor="primaryIdealCommuteMinutes">你的理想单程时间（分钟）*</Label><Input id="primaryIdealCommuteMinutes" className="mt-2" type="number" min="0" step="1" inputMode="numeric" value={form.primaryIdealCommuteMinutes} onChange={(event) => updateField("primaryIdealCommuteMinutes", event.target.value)} placeholder="例如：30" {...errorProps("primaryIdealCommuteMinutes")} /><FieldError id="primaryIdealCommuteMinutes-error" message={errors.primaryIdealCommuteMinutes} /></div>
                <div><Label htmlFor="primaryMaxCommuteMinutes">你的最长可接受时间（分钟）*</Label><Input id="primaryMaxCommuteMinutes" className="mt-2" type="number" min="0" step="1" inputMode="numeric" value={form.primaryMaxCommuteMinutes} onChange={(event) => updateField("primaryMaxCommuteMinutes", event.target.value)} placeholder="例如：50" {...errorProps("primaryMaxCommuteMinutes")} /><FieldError id="primaryMaxCommuteMinutes-error" message={errors.primaryMaxCommuteMinutes} /></div>
              </div>}
              {form.partnerWorkLocation.trim() && <div className="space-y-5 rounded-2xl border border-[#e5e3dc] bg-[#faf9f6] p-5">
                <div><Label>伴侣通勤方式 *</Label><div className="mt-2 grid gap-3 sm:grid-cols-2">{SELECTABLE_COMMUTE_MODES.filter((mode) => mode !== "not_important").map((mode) => <ChoiceButton key={mode} selected={form.partnerCommuteMode === mode} onClick={() => updateField("partnerCommuteMode", mode)}>{COMMUTE_MODE_LABELS[mode]}</ChoiceButton>)}</div><FieldError id="partnerCommuteMode-error" message={errors.partnerCommuteMode} /></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div><Label htmlFor="partnerIdealCommuteMinutes">伴侣理想单程时间（分钟）*</Label><Input id="partnerIdealCommuteMinutes" className="mt-2" type="number" min="0" step="1" value={form.partnerIdealCommuteMinutes} onChange={(event) => updateField("partnerIdealCommuteMinutes", event.target.value)} /><FieldError id="partnerIdealCommuteMinutes-error" message={errors.partnerIdealCommuteMinutes} /></div>
                  <div><Label htmlFor="partnerMaxCommuteMinutes">伴侣最长可接受时间（分钟）*</Label><Input id="partnerMaxCommuteMinutes" className="mt-2" type="number" min="0" step="1" value={form.partnerMaxCommuteMinutes} onChange={(event) => updateField("partnerMaxCommuteMinutes", event.target.value)} /><FieldError id="partnerMaxCommuteMinutes-error" message={errors.partnerMaxCommuteMinutes} /></div>
                </div>
              </div>}
              <p className="rounded-xl bg-[#f4f3ef] px-4 py-3 text-sm leading-6 text-[#666962]">当前阶段只记录你的通勤偏好，真实通勤时间将在后续分析阶段计算。</p>
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="04" title="教育需求" description="记录家庭当前或未来的教育需求，不对学校入学资格作任何保证。" />
            <CardContent className="space-y-5 px-6 py-6 sm:px-8">
              <div><Label>教育需求 *</Label><div className="mt-2 grid gap-3 sm:grid-cols-3" aria-invalid={Boolean(errors.educationNeed)} aria-describedby={errors.educationNeed ? "educationNeed-error" : undefined}>{EDUCATION_NEEDS.map((need) => <ChoiceButton key={need} selected={form.educationNeed === need} onClick={() => selectEducationNeed(need)}><GraduationCap size={17} />{EDUCATION_NEED_LABELS[need]}</ChoiceButton>)}</div><FieldError id="educationNeed-error" message={errors.educationNeed} /></div>
              {form.educationNeed && form.educationNeed !== "none" && <div><Label>{form.educationNeed === "current" ? "当前主要关注哪个教育阶段？*" : "未来预计关注哪个教育阶段？（选填）"}</Label><div className="mt-2 grid gap-3 sm:grid-cols-2" aria-invalid={Boolean(errors.educationStages)} aria-describedby={errors.educationStages ? "educationStages-error" : undefined}>{EDUCATION_STAGES.map((stage) => <ChoiceButton key={stage} selected={form.educationStages.includes(stage)} onClick={() => toggleEducationStage(stage)}>{EDUCATION_STAGE_LABELS[stage]}</ChoiceButton>)}</div><FieldError id="educationStages-error" message={errors.educationStages} /></div>}
            </CardContent>
          </Card>

          <Card>
            <SectionHeading number="05" title="希望AI优先考虑的3个因素" description="用于调整15维决策权重，不代表最终推荐理由一定只来自这三项。点击顺序即优先程度。" />
            <CardContent className="px-6 py-6 sm:px-8">
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
        <div className="mt-3 flex items-center gap-2 text-[13px] text-[#8a8c87]"><LockKeyhole size={13} />{demoActive ? "示例偏好仅保存在当前浏览器，退出示例体验后会清除" : supabaseAvailable ? "偏好已保存到您的匿名云端空间" : "偏好暂时保存在当前浏览器"}</div>
      </div>
    </form>
  );
}
