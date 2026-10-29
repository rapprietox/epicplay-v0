"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Hero } from "./components/Hero";
import { DataAwakens } from "./components/DataAwakens";
import { Platform } from "./components/Platform";
import { IntelligenceStack } from "./components/IntelligenceStack";
import { Kairos } from "./components/Kairos";
import { Facts } from "./components/Facts";
import { TheFuture } from "./components/TheFuture";
import { Pricing } from "./components/Pricing";
import { TheSignal } from "./components/TheSignal";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import "./styles/marketing.css";

// Lenis smooth-scroll was removed here -- it was fighting GSAP's own
// ScrollTrigger (each driving scroll math off a different clock), making
// the page feel slow and uncontrollable. Native scroll works fine with
// ScrollTrigger out of the box (it's GSAP's own default scroller), and
// every section's scroll-reveal/scrub animation is unaffected -- each
// registers its own ScrollTrigger instance and cleans itself up on
// unmount, independent of this top-level component.
gsap.registerPlugin(ScrollTrigger);

export function MarketingPage() {
  return (
    <div className="marketing-page" id="top">
      <Nav />
      <Hero />
      <DataAwakens />
      <Platform />
      <IntelligenceStack />
      <Kairos />
      <Facts />
      <TheFuture />
      <Pricing />
      <TheSignal />
      <FinalCTA />
      <Footer />
    </div>
  );
}
