import { RegenerateAssessmentButton } from "./regenerate-assessment-button";

const SECTION_HEADERS = ["What I Found", "Your Biggest Weakness Right Now", "Your Biggest Strength", "4-Week Plan", "Expected Results"];

// Clubhouse Pro enhancement, Part 3: splits the assessment's plain text
// on its own five section headers (spelled out verbatim in the prompt --
// see generateKairosInitialAssessment in src/lib/anthropic.ts) rather
// than asking the model for structured JSON -- the request's own spec
// reads as prose sections, not a data schema, and this stays consistent
// with generateOpponentInsight/generatePregameMessage's plain-text
// convention.
function splitSections(text: string): { header: string; body: string }[] {
  const sections: { header: string; body: string }[] = [];
  for (let i = 0; i < SECTION_HEADERS.length; i++) {
    const header = SECTION_HEADERS[i];
    const start = text.indexOf(header);
    if (start === -1) continue;
    const afterHeader = start + header.length;
    const nextHeaderStarts = SECTION_HEADERS.slice(i + 1)
      .map((h) => text.indexOf(h, afterHeader))
      .filter((idx) => idx !== -1);
    const end = nextHeaderStarts.length ? Math.min(...nextHeaderStarts) : text.length;
    const body = text.slice(afterHeader, end).trim();
    if (body) sections.push({ header, body });
  }
  return sections;
}

export function InitialAssessment({ text }: { text: string }) {
  if (!text) return null;
  const sections = splitSections(text);

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-accent-gold">Your KAIROS Assessment</h2>
        <RegenerateAssessmentButton />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {(sections.length ? sections : [{ header: "Assessment", body: text }]).map((s) => (
          <div key={s.header}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-green">{s.header}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[#DCF5E4]">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
