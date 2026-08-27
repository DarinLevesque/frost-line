import type { GrowthStage } from "./types";

/**
 * Demo property: Caymus Vineyards, Rutherford, Napa Valley, CA.
 * 8700 Conn Creek Rd, Rutherford, CA 94573.
 *
 * The coordinates below are an ​APPROXIMATE map center only (general-knowledge
 * geocoding, not a surveyed parcel boundary) — good enough to center the map
 * and seed a plausible demo block. The whole point of the app is that the
 * real boundary gets drawn by hand over satellite imagery, so precision here
 * doesn't matter; just refine it once you're looking at the map.
 */
export const DEMO_SITE = {
  name: "Caymus Vineyards (approx.)",
  address: "8700 Conn Creek Rd, Rutherford, CA 94573",
  center: { lat: 38.4605, lng: -122.4186 },
  zoom: 17,
} as const;

/** A rough placeholder vineyard block near the demo site, ~5 acres. Replace by drawing the real block. */
export const DEMO_BOUNDARY_GEOJSON = {
  type: "Feature",
  properties: { name: "Demo block (placeholder — redraw over satellite imagery)" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-122.4200, 38.4598],
        [-122.4192, 38.4598],
        [-122.4192, 38.4612],
        [-122.4200, 38.4612],
        [-122.4200, 38.4598],
      ],
    ],
  },
} as const;

/**
 * Grapevine frost-kill thresholds (LT50 — temperature at which ~50% of tissue
 * is killed), Pinot noir, Sugar et al. 2003, via grapes.extension.org.
 * Use as the default; override per-variety if better data is found.
 */
export const LT50_THRESHOLDS_F: Record<GrowthStage, number | null> = {
  dormant: null, // dormant buds are effectively frost-hardy; no meaningful LT50 here
  greenSwollenBud: 26,
  budBurst: 28,
  twoLeaf: 29,
  fourLeaf: 30,
};

/**
 * Wind machine coverage footprint, from Yi Dai, "Wind Machines for Frost
 * Damage Mitigation" (TU Delft PhD dissertation, 2025) — measured under a
 * light background wind (~0.2 m/s). This is the single most load-bearing
 * assumption in the placement algorithm: the footprint is NOT a circle, it's
 * stretched downwind.
 */
export const WIND_MACHINE_FOOTPRINT_M = {
  downstream: 550,
  upstream: 150,
  crossStream: 250,
} as const;

/** Measured warming effect, same source — used to narrate the savings estimate. */
export const WIND_MACHINE_EFFECT = {
  /** Average in-canopy warming within 40 minutes of startup, in Kelvin (== Celsius delta). */
  warmingK: 3,
  /** Inversion-strength reduction close to the machine (within 0.45 ha). */
  inversionReductionNear: 0.5,
  /** Inversion-strength reduction further out (within 2.66 ha). */
  inversionReductionFar: 0.3,
} as const;

/** Real-world density benchmark: Quincy vineyard runs ~60 machines over 700 ha. Use to sanity-check output counts. */
export const BENCHMARK_ACRES_PER_MACHINE = 700 * 2.471 / 60; // ≈ 28.8 acres/machine

/**
 * Grid resolution for the MOCK data path (buildPropertyGrid + mockData.ts).
 * The LIVE path doesn't use this — FortyGuard's own Create Heatmap tiles
 * (60/80/100 m, see FORTYGUARD_NOTES.granularityOptionsM) become the risk
 * cells directly, at whichever granularity fetchLiveRiskCells() requests.
 */
export const GRID_RESOLUTION_M = 60;

/**
 * Confirmed against docs-api.fortyguard.com on 2026-08-27 (that domain
 * wouldn't render during initial planning; a follow-up check found it
 * working). See src/lib/fortyguard.ts and api/fortyguard/*.ts for the full
 * client + proxy built against this.
 */
export const FORTYGUARD_NOTES = {
  auth: "Header `api-key: <key>` on every request — not OAuth, not Bearer.",
  submitEndpoint: "POST https://api.fortyguard.com/v1/heatmap",
  statusEndpoint: "GET https://api.fortyguard.com/v1/status/{activity_id}",
  taskModel:
    "Every POST submits an async task and returns an activity_id immediately; poll the status endpoint until status is Completed or Failed. Credits are only deducted on Completed.",
  granularityOptionsM: [60, 80, 100] as const,
  historyStart: "2019-01-01",
  forecastHorizonHours: 12,
  maxRangeOfDaysRequest:
    "filter_type 4 (range of days) is capped at 1 month per request — a full frost season needs multiple monthly calls.",
  analyticTypeUsed:
    "exceedance, direction 'below' — FortyGuard's own model counts hours below our LT50 threshold per tile, so we don't re-derive risk from raw samples.",
  areaLimits: "10 mi² on API Basic, 50 mi² on API Premium, per heatmap request.",
  unconfirmed:
    "The exact property name for a tile's exceedance-hours value inside map_data — the docs' result schema shows it as a placeholder. Verify against a real response once a key is available (see fortyguard.ts).",
} as const;
