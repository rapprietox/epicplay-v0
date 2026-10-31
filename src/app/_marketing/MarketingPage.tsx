"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Hero } from "./components/Hero";
import { Nav } from "./components/Nav";
// TEMP: pricing hidden until final pricing is decided -- uncomment
// this import and the <Pricing /> render below to bring it back.
// import { Pricing } from "./components/Pricing";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";
import { CursorGlow } from "./components/CursorGlow";
import { StickyMobileCta } from "./components/StickyMobileCta";
import "./styles/marketing.css";

// Lenis smooth-scroll was removed here -- it was fighting GSAP's own
// ScrollTrigger (each driving scroll math off a different clock), making
// the page feel slow and uncontrollable. Native scroll works fine with
// ScrollTrigger out of the box (it's GSAP's own default scroller), and
// every section's scroll-reveal/scrub animation is unaffected -- each
// registers its own ScrollTrigger instance and cleans itself up on
// unmount, independent of this top-level component.
gsap.registerPlugin(ScrollTrigger);

// Everything below the hero is code-split via next/dynamic (ssr:false
// isn't needed since the whole page is already "use client" -- dynamic
// import alone is what gives each of these its own lazily-loaded chunk).
// Hero, Nav, FinalCTA, and Footer stay static imports -- Hero/Nav are
// above the fold, and FinalCTA/Footer were already part of the shipped
// page before the first dynamic-import batch. Kairos moved into this
// list in the section-reorder batch (it's no longer above-the-fold
// content once Problem/Trust Strip come first). Pricing is TEMP-removed
// entirely (see above) rather than left in this list unused.
const TrustStrip = dynamic(() => import("./components/TrustStrip").then((m) => m.TrustStrip));
const Problem = dynamic(() => import("./components/Problem").then((m) => m.Problem));
const Kairos = dynamic(() => import("./components/Kairos").then((m) => m.Kairos));
const HowItWorks = dynamic(() => import("./components/HowItWorks").then((m) => m.HowItWorks));
const InteractiveDemo = dynamic(() => import("./components/InteractiveDemo").then((m) => m.InteractiveDemo));
const ByRole = dynamic(() => import("./components/ByRole").then((m) => m.ByRole));
const ReliabilitySection = dynamic(() => import("./components/ReliabilitySection").then((m) => m.ReliabilitySection));
const ComparisonTable = dynamic(() => import("./components/ComparisonTable").then((m) => m.ComparisonTable));
const CaseStudy = dynamic(() => import("./components/CaseStudy").then((m) => m.CaseStudy));
const Faq = dynamic(() => import("./components/Faq").then((m) => m.Faq));
const Roadmap = dynamic(() => import("./components/Roadmap").then((m) => m.Roadmap));
const LeadCapture = dynamic(() => import("./components/LeadCapture").then((m) => m.LeadCapture));

export function MarketingPage() {
  // next/dynamic sections mount after the initial render, each on its
  // own chunk-load timer -- any ScrollTrigger created *before* a later
  // section exists measures the page's total height wrong (its spacer
  // for a pin, in particular, gets sized off a DOM that's still missing
  // content below it). Refreshing once shortly after mount (letting the
  // dynamic chunks settle) and again on window 'load' (fonts/images
  // finished, layout fully settled) re-measures everything against the
  // DOM as it actually ends up.
  useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 300);
    function onLoad() {
      ScrollTrigger.refresh();
    }
    window.addEventListener("load", onLoad);
    return () => {
      clearTimeout(t);
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return (
    <div className="marketing-page" id="top">
      <CursorGlow />
      <Nav />
      <Hero />
      <StickyMobileCta />
      <TrustStrip />
      <Problem />
      <Kairos />
      <HowItWorks />
      <InteractiveDemo />
      <ByRole />
      <ReliabilitySection />
      <ComparisonTable />
      <CaseStudy />
      <Faq />
      {/* TEMP: pricing hidden until final pricing is decided */}
      <Roadmap />
      <LeadCapture />
      <FinalCTA />
      <Footer />
    </div>
  );
}
