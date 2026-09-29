import type { Metadata } from "next";
import { DM_Sans, DM_Mono, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  // Team Leaders Board redesign: 900 (Black) added for the glowing
  // scoreboard-style stat value -- 600/700 were already loaded for
  // existing headings.
  weight: ["600", "700", "900"],
  variable: "--font-heading",
});
// Team Leaders Board redesign: the stat-name label embedded in each
// card's top divider line is spec'd as monospace, which neither existing
// font provides.
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "EpicPlay AI",
  description: "Baseball statistics tracking for EpicPlay AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${barlowCondensed.variable} ${dmMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
