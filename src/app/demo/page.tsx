import type { Metadata } from "next";

import { DemoApp } from "@/components/demo/demo-app";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Map your medical supply network — ports, warehouses, and clinics — and how supplies flow between them.",
};

export default function DemoPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
  return <DemoApp {...(apiKey ? { apiKey } : {})} {...(mapId ? { mapId } : {})} />;
}
