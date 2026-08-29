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
 * Actual Stone Tower Winery vineyard-block boundary (single polygon),
 * supplied 2026-08-27 to replace the earlier hand-traced approximation.
 */
export const DEMO_BOUNDARY_GEOJSON = {
  type: "Feature",
  properties: { name: "Stone Tower Winery vineyard blocks" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-77.63551, 39.063074], [-77.63787, 39.058009], [-77.638214, 39.058067], [-77.638664, 39.057884], [-77.639458, 39.0581], [-77.639201, 39.058617], [-77.639415, 39.05905], [-77.639426, 39.059517], [-77.638342, 39.062132], [-77.638407, 39.062907], [-77.638589, 39.063565], [-77.638503, 39.064107], [-77.640402, 39.064023], [-77.640531, 39.063798], [-77.639759, 39.063549], [-77.639855, 39.063015], [-77.63949, 39.062349], [-77.639759, 39.061516], [-77.640553, 39.061141], [-77.641196, 39.060241], [-77.643707, 39.059833], [-77.644629, 39.062657], [-77.645327, 39.062649], [-77.645681, 39.063515], [-77.645348, 39.063599], [-77.645659, 39.064382], [-77.647076, 39.064598], [-77.647076, 39.065873], [-77.645595, 39.065631], [-77.645659, 39.066481], [-77.645155, 39.067097], [-77.643439, 39.066381], [-77.642945, 39.066031], [-77.643052, 39.065156], [-77.643825, 39.064215], [-77.643632, 39.063782], [-77.642977, 39.063957], [-77.643074, 39.064698], [-77.64272, 39.064948], [-77.642194, 39.064948], [-77.64213, 39.06394], [-77.641711, 39.063732], [-77.64184, 39.065165], [-77.641411, 39.065181], [-77.641196, 39.065065], [-77.639995, 39.065098], [-77.639651, 39.065248], [-77.638965, 39.065281], [-77.638568, 39.065656], [-77.638375, 39.065656], [-77.638235, 39.065881], [-77.637742, 39.065881], [-77.637484, 39.065748], [-77.637441, 39.065015], [-77.63831, 39.064182], [-77.637634, 39.064082], [-77.637656, 39.063482], [-77.63551, 39.063074]]],
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
 * cells directly, at whichever granularity fetchClimatologyRiskCells() requests.
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
} as const;
