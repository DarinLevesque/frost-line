import type { GrowthStage } from "./types";

/**
 * Demo property: Stone Tower Winery, Leesburg, Virginia (Loudoun County).
 * 19925 Hogback Mountain Rd, Leesburg, VA 20175.
 *
 * Center is Google Maps' business-listing pin for the address (39.0646116,
 * -77.6367452) — the tasting-room building, not a parcel centroid. Zoom is
 * tuned to roughly frame the whole vineyard block layout.
 */
export const DEMO_SITE = {
  name: "Stone Tower Winery",
  address: "19925 Hogback Mountain Rd, Leesburg, VA 20175",
  center: { lat: 39.0648, lng: -77.6418 },
  zoom: 16,
} as const;

/**
 * Traced by hand over Esri satellite imagery (the same basemap the app
 * renders — see components/map.ts) to match Stone Tower Winery's actual
 * vineyard block layout, 2026-08-27. Encompasses the working vineyard
 * blocks across the property; buildings, the tasting-room courtyard, and
 * ponds are carved out where the blocks visibly stop short of them.
 */
export const DEMO_BOUNDARY_GEOJSON = {
  type: "Feature",
  properties: { name: "Stone Tower Winery vineyard blocks" },
  geometry: {
    type: "MultiPolygon",
    coordinates: [[[[-77.6449728, 39.0688631], [-77.642473, 39.066714], [-77.6427412, 39.0653312], [-77.644887, 39.0639401], [-77.6468503, 39.0639401], [-77.6488996, 39.0640817], [-77.648803, 39.0661559], [-77.6449728, 39.0688631]]], [[[-77.6427519, 39.065982], [-77.640574, 39.0657738], [-77.6382351, 39.0653074], [-77.6361537, 39.0644996], [-77.6362395, 39.0635502], [-77.6368403, 39.0632171], [-77.6368403, 39.0625425], [-77.6361537, 39.0622677], [-77.6361537, 39.0613932], [-77.6392758, 39.0609934], [-77.6427519, 39.0611267], [-77.6442218, 39.0619345], [-77.6442218, 39.0644996], [-77.6434493, 39.0655739], [-77.6427519, 39.065982]]]],
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
