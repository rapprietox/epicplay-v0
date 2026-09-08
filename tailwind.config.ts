import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "#071A0E",
        card: "#0A2214",
        border: "#1A3D28",
        accent: {
          // Oakland A's green rebrand -- primary replaces the old blue
          // (#2E6FD4). "green" keeps its name (it already made sense) but
          // its value moves to the new bright green -- it was already the
          // app's "success/confirm/positive" color (Save, Confirm At-Bat,
          // Live indicator, Win), and the new palette's "bright green" is
          // explicitly meant to take over exactly that role (e.g. In Play
          // was accent-green, spec now calls it "bright green").
          primary: "#1A6B3C",
          light: "#24A058",
          green: "#2ECC71",
          glow: "#00FF7F",
          amber: "#EF9F27",
          red: "#E24B4A",
          gold: "#F0C060",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        heading: ["var(--font-heading)"],
      },
    },
  },
  plugins: [],
};
export default config;
