"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
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
import "lenis/dist/lenis.css";
import "./styles/marketing.css";

gsap.registerPlugin(ScrollTrigger);

export function MarketingPage() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const lenis = new Lenis({
      duration: 1.4,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    lenis.on("scroll", ScrollTrigger.update);

    function raf(time: number) {
      lenis.raf(time);
    }
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

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
