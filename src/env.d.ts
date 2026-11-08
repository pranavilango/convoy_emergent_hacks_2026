declare namespace NodeJS {
  interface ProcessEnv {
    /** Browser key for Maps JavaScript API + Places API (New). Restrict it by HTTP referrer. */
    readonly NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?: string;
    /** Map ID (JavaScript, Vector). Advanced markers need one; the dark scheme is set in code. */
    readonly NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?: string;
  }
}
