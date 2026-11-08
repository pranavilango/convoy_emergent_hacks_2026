import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Defaults inherited by every route. Each page should still export its own metadata.
// Don't add openGraph.images here: every page without its own would inherit it.
export const metadata: Metadata = {
  title: {
    default: "Convoy",
    template: "%s · Convoy",
  },
  description:
    "Convoy allocates solar power across medical warehouses and clinics in low-resource regions.",
  openGraph: {
    type: "website",
    siteName: "Convoy",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-scroll-behavior: the landing page scrolls smoothly to its sections; this tells Next to
    // switch that off during page navigations so they stay instant.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
