import type { Metadata } from "next";

import { DemoApp } from "@/components/demo/demo-app";

export const metadata: Metadata = {
  title: "Demo",
  description: "Map your locations — stores, kitchens, depots — and see your network at a glance.",
};

export default function DemoPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
  return <DemoApp {...(apiKey ? { apiKey } : {})} {...(mapId ? { mapId } : {})} />;
}
