import { cn } from "@/lib/utils";

interface NarrativeSection {
  title?: string;
  paragraphs: string[];
}

interface StructuredNarrativeProps {
  value: string;
  className?: string;
}

export function normalizeNarrativeParagraphs(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

export function structureNarrative(value: string): NarrativeSection[] {
  const paragraphs = normalizeNarrativeParagraphs(value);

  if (paragraphs.length <= 2) {
    return paragraphs.map((paragraph) => ({ paragraphs: [paragraph] }));
  }

  if (paragraphs.length === 3) {
    return ["综合结论", "候选对比", "风险与下一步"].map((title, index) => ({
      title,
      paragraphs: [paragraphs[index]],
    }));
  }

  return [
    { title: "综合结论", paragraphs: [paragraphs[0]] },
    { title: "候选对比", paragraphs: [paragraphs[1]] },
    { title: "风险与待确认", paragraphs: [paragraphs[2]] },
    { title: "下一步建议", paragraphs: paragraphs.slice(3) },
  ];
}

export function StructuredNarrative({ value, className }: StructuredNarrativeProps) {
  const sections = structureNarrative(value);

  return (
    <div className={cn("space-y-4 text-base text-[#626560]", className)}>
      {sections.map((section, sectionIndex) => (
        <section key={`${section.title ?? "paragraph"}-${sectionIndex}`}>
          {section.title && <p className="text-sm font-semibold leading-5 text-[#66745f]">{section.title}</p>}
          <div className={cn("space-y-4", section.title && "mt-1.5")}>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={`${sectionIndex}-${paragraphIndex}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
