// Shared types for Frost Line.
// Kept framework-free (no React/Next types) since the frontend is vanilla TS + Leaflet.

import type { Feature, Polygon } from "geojson";

/** A single historical or forecast temperature reading from FortyGuard (or mock data). */
export interface TemperatureSample {
  lat: number;
  lng: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  temperatureF: number;
}

/** One cell of the property grid, after risk scoring. */
export interface RiskCell {
  id: string;
  /** Cell centroid. */
  lat: number;
  lng: number;
  /** The cell polygon, for rendering. */
  polygon: Feature<Polygon>;
  /** Fraction of historical hours below the active frost threshold, 0..1. */
  riskScore: number;
  /** Coldest observed/estimated temperature at this cell, in F. Null when the source (e.g. a live FortyGuard exceedance query) doesn't report a per-tile minimum. */
  worstTempF: number | null;
  /** Count of below-threshold hourly samples used to compute riskScore. */
  coldHourCount: number;
  /** Total samples considered for this cell. */
  sampleCount: number;
}

/** A recommended wind machine placement. */
export interface MachinePlacement {
  id: string;
  lat: number;
  lng: number;
  /** The asymmetric coverage footprint, oriented to the prevailing wind. */
  footprint: Feature<Polygon>;
  /** IDs of risk cells this placement covers. */
  coveredCellIds: string[];
  /** Sum of riskScore across covered cells — used to rank placements. */
  coverageValue: number;
}

/** Grapevine growth stage, used to pick the active LT50 frost threshold. */
export type GrowthStage =
  | "dormant"
  | "greenSwollenBud"
  | "budBurst"
  | "twoLeaf"
  | "fourLeaf";

export interface SavingsEstimate {
  acresAnalyzed: number;
  acresProtected: number;
  cropValuePerAcre: number;
  historicalFrostNightsPerSeason: number;
  estimatedAnnualSavingsLow: number;
  estimatedAnnualSavingsHigh: number;
  /** Plain-language list of every assumption baked into the number above. Show this, don't hide it. */
  assumptions: string[];
}

/** FortyGuard account credit usage, from GET /api/fortyguard/usage. */
export interface CreditsUsage {
  planType: string;
  billingPeriod: string;
  creditsResetDate: string;
  apiKeyStatus: string;
  apiKeyValid: boolean;
  totalCredits: number;
  cycleUsedCredits: number;
  cycleRemainingCredits: number;
  cycleUsagePercentage: number;
  activityBreakdown: { name: string; credits: number; count: number; percentage: number }[];
}
