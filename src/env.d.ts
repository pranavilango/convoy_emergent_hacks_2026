declare namespace NodeJS {
  interface ProcessEnv {
    /** Browser key for Maps JavaScript API + Places API (New). Restrict it by HTTP referrer. */
    readonly NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?: string;
    /** Map ID with the Convoy map style attached (see docs/google-maps-style.json). */
    readonly NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?: string;
  }
}
