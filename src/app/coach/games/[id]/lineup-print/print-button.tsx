"use client";

// Feature 3 (lineup-status batch): the only interactive piece of this
// route -- everything else is a plain server-rendered document. Kept as
// its own tiny client component rather than making the whole page a
// client component, since the page itself has no state or interactivity
// beyond this one button.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-md bg-accent-primary px-4 py-2 text-sm font-semibold text-white hover:bg-accent-primary/90"
    >
      Print / Save as PDF
    </button>
  );
}
