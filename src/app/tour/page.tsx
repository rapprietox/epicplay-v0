import type { Metadata } from "next";
import { TourExperience } from "./tour-experience";
import "./tour.css";

// Public, noindex, unlinked -- reachable only by whoever has this exact
// URL (see the exact-match entry in src/lib/supabase/middleware.ts).
// This page reads no database and calls no Server Action on load, so it
// renders the same for every visitor and survives anything short of the
// app itself being down.
export const metadata: Metadata = {
  title: "EpicPlay AI -- Live Tour",
  description: "A live, click-through tour of EpicPlay AI: what's built, what's next, and how to see it run.",
  robots: { index: false, follow: false },
};

export default function TourPage() {
  return <TourExperience />;
}
