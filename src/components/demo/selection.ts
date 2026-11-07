/** What's currently selected on the map / in the panel. */
export type Selection =
  { kind: "location"; id: string } | { kind: "connection"; id: string } | null;
