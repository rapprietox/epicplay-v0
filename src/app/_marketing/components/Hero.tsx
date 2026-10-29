"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
  const canvasRef = useRef<HTMLDivElement>(null);

  // Hero copy reveal -- unconditional, independent of whether the 3D
  // scene below succeeds. A 3D-scene failure should never also hide
  // the headline/CTAs.
  useEffect(() => {
    gsap.fromTo(
      ".gsap-hero-content",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1.2, ease: "power2.out", delay: 3 }
    );
  }, []);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion gets the dark background + hero copy with no 3D
    // scene and no camera/particle animation at all.
    if (reducedMotion) return;

    let frameId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let handleMouseMove: ((e: MouseEvent) => void) | null = null;
    let handleResize: (() => void) | null = null;

    try {
      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x030a06);
      scene.fog = new THREE.FogExp2(0x030a06, 0.008);

      // Camera -- starts high above field looking down at angle
      const camera = new THREE.PerspectiveCamera(
        55,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      );
      camera.position.set(0, 45, 70);
      camera.lookAt(0, 0, 0);

      // Renderer
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      container.appendChild(renderer.domElement);

      // FIELD GEOMETRY

      const grassGeo = new THREE.PlaneGeometry(300, 300);
      const grassMat = new THREE.MeshBasicMaterial({
        color: 0x071a0e,
        side: THREE.DoubleSide,
      });
      const grass = new THREE.Mesh(grassGeo, grassMat);
      grass.rotation.x = -Math.PI / 2;
      scene.add(grass);

      const dirtGeo = new THREE.CircleGeometry(20, 64);
      const dirtMat = new THREE.MeshBasicMaterial({ color: 0x2d1e0f });
      const dirt = new THREE.Mesh(dirtGeo, dirtMat);
      dirt.rotation.x = -Math.PI / 2;
      dirt.position.y = 0.01;
      scene.add(dirt);

      const createGlowLine = (points: THREE.Vector3[], color: number, opacity = 0.9) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        return new THREE.Line(geometry, material);
      };

      const homePlate = new THREE.Vector3(0, 0.1, 20);
      const firstBase = new THREE.Vector3(20, 0.1, 0);
      const secondBase = new THREE.Vector3(0, 0.1, -20);
      const thirdBase = new THREE.Vector3(-20, 0.1, 0);

      const basePaths: [THREE.Vector3, THREE.Vector3][] = [
        [homePlate, firstBase],
        [firstBase, secondBase],
        [secondBase, thirdBase],
        [thirdBase, homePlate],
      ];
      basePaths.forEach(([a, b]) => {
        scene.add(createGlowLine([a, b], 0xf0c060, 0.7));
      });

      const lfWall = new THREE.Vector3(-80, 0.1, -60);
      const rfWall = new THREE.Vector3(80, 0.1, -60);
      scene.add(createGlowLine([homePlate, lfWall], 0x2ecc71, 0.5));
      scene.add(createGlowLine([homePlate, rfWall], 0x2ecc71, 0.5));

      const arcPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= 60; i++) {
        const angle = (Math.PI * i) / 60 + Math.PI;
        const radius = 75;
        arcPoints.push(
          new THREE.Vector3(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius + 10)
        );
      }
      scene.add(createGlowLine(arcPoints, 0x1a6b3c, 0.6));

      const basePositions = [firstBase, secondBase, thirdBase];
      basePositions.forEach((pos) => {
        const geo = new THREE.BoxGeometry(2, 0.3, 2);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xf0c060,
          blending: THREE.AdditiveBlending,
        });
        const base = new THREE.Mesh(geo, mat);
        base.position.copy(pos);
        scene.add(base);
      });

      const homeGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.2, 5);
      const homeMat = new THREE.MeshBasicMaterial({ color: 0xeaf7ee });
      const home = new THREE.Mesh(homeGeo, homeMat);
      home.position.copy(homePlate);
      scene.add(home);

      const moundGeo = new THREE.CylinderGeometry(3, 4, 0.8, 32);
      const moundMat = new THREE.MeshBasicMaterial({ color: 0x3d2b1a });
      const mound = new THREE.Mesh(moundGeo, moundMat);
      mound.position.set(0, 0.4, 0);
      scene.add(mound);

      // PARTICLE SYSTEM -- floating data points
      const isMobile = window.innerWidth < 768;
      const particleCount = isMobile ? 300 : 800;
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = Math.random() * 60 + 1;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 200;

        if (Math.random() > 0.4) {
          colors[i * 3] = 0.94;
          colors[i * 3 + 1] = 0.75;
          colors[i * 3 + 2] = 0.38;
        } else {
          colors[i * 3] = 0.18;
          colors[i * 3 + 1] = 0.8;
          colors[i * 3 + 2] = 0.44;
        }
      }

      const particleGeo = new THREE.BufferGeometry();
      particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const particleMat = new THREE.PointsMaterial({
        size: 0.4,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });

      const particles = new THREE.Points(particleGeo, particleMat);
      scene.add(particles);

      // STADIUM LIGHTS
      const lightPositions: [number, number, number][] = [
        [-60, 40, -60],
        [60, 40, -60],
        [-60, 40, 60],
        [60, 40, 60],
      ];
      lightPositions.forEach(([x, y, z]) => {
        const light = new THREE.PointLight(0x2ecc71, 0.8, 150);
        light.position.set(x, y, z);
        scene.add(light);

        const coneGeo = new THREE.ConeGeometry(3, 20, 8, 1, true);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0x2ecc71,
          transparent: true,
          opacity: 0.03,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(x, y - 10, z);
        scene.add(cone);
      });

      const ambientLight = new THREE.AmbientLight(0x1a6b3c, 0.4);
      scene.add(ambientLight);

      // MOUSE PARALLAX
      let mouseX = 0,
        mouseY = 0;
      let targetMouseX = 0,
        targetMouseY = 0;

      handleMouseMove = (e: MouseEvent) => {
        targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("mousemove", handleMouseMove);

      // GSAP SCROLL TRIGGER -- camera flies down as user scrolls through the hero
      const heroSection = container.closest(".hero-section");

      gsap.to(camera.position, {
        y: 8,
        z: 25,
        scrollTrigger: {
          trigger: heroSection,
          start: "top top",
          end: "bottom top",
          scrub: 0.5,
        },
      });

      gsap.to(particles.position, {
        y: 15,
        scrollTrigger: {
          trigger: heroSection,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });

      // ANIMATION LOOP
      const clock = new THREE.Clock();
      const rendererRef = renderer;

      const animate = () => {
        frameId = requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();

        mouseX += (targetMouseX - mouseX) * 0.03;
        mouseY += (targetMouseY - mouseY) * 0.03;

        camera.position.x = mouseX * 6;

        particles.rotation.y = elapsed * 0.02;

        const pulse = Math.sin(elapsed * 1.5) * 0.15 + 1;
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
            if (obj.material.color.getHex() === 0xf0c060) {
              obj.scale.setScalar(pulse);
            }
          }
        });

        rendererRef.render(scene, camera);
      };
      animate();

      // RESIZE
      handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        rendererRef.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", handleResize);
    } catch (err) {
      console.error("Hero 3D scene failed to initialize:", err);
    }

    // CLEANUP
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      if (handleMouseMove) window.removeEventListener("mousemove", handleMouseMove);
      if (handleResize) window.removeEventListener("resize", handleResize);
      if (renderer) {
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      }
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return (
    <section className="hero-section">
      {/* Layering, back to front: video (z-index 0) -> Three.js field,
          a subtle 25%-opacity accent (z-index 1, .hero-canvas) -> dark
          overlay (z-index 2) -> content (z-index 10). */}
      <video autoPlay muted loop playsInline className="hero-video">
        <source src="/hero-video.mp4" type="video/mp4" />
      </video>

      <div ref={canvasRef} className="hero-canvas" />

      {/* Dark overlay */}
      <div className="hero-overlay" />

      {/* Content -- reveals after 3s */}
      <div className="hero-content gsap-hero-content">
        <div className="hero-wordmark">
          <span className="wordmark-ball">⚾</span>
          <span className="wordmark-epic">EPICPLAY</span>
          <span className="wordmark-ai">AI</span>
        </div>
        <p className="hero-tagline">The Intelligence Layer Amateur Baseball Has Been Missing.</p>
        <div className="hero-buttons">
          <a href="/login" className="btn-primary">
            Start Your Season →
          </a>
          <a href="#platform" className="btn-ghost">
            See How It Works ↓
          </a>
        </div>
      </div>

      {/* Skip button */}
      <button
        type="button"
        className="hero-skip"
        onClick={() => {
          gsap.set(".gsap-hero-content", { opacity: 1, y: 0 });
        }}
      >
        Skip intro →
      </button>

      {/* Scroll indicator */}
      <div className="scroll-indicator">
        <div className="scroll-line" />
        <span>Scroll</span>
      </div>
    </section>
  );
}
