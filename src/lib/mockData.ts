import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { TemperatureSample } from "./types";

/**
 * Stand-in for a real FortyGuard historical pull, so the app is demoable
 * before an API key exists. Simulates cold-air drainage: cells further
 * from the boundary's highest point (approximated here as furthest from
 * centroid, toward one corner) run colder — a crude proxy for "low ground
 * pools cold air" until real DEM + FortyGuard data replaces it.
 *
 * DELETE this once src/lib/fortyguard.ts is wired to real historical data.
 */
export function generateMockSamplesForCell(
  cellPolygon: Feature<Polygon>,
  boundary: Feature<Polygon | MultiPolygon>,
  nights: number = 45
): TemperatureSample[] {
  const [lng, lat] = turf.centroid(cellPolygon).geometry.coordinates;
  const bbox = turf.bbox(boundary);

  // Distance toward the "low corner" (SW) as a 0..1 pseudo-elevation proxy —
  // purely for a plausible-looking demo gradient, not real topography.
  const dx = (lng - bbox[0]) / (bbox[2] - bbox[0] || 1);
  const dy = (lat - bbox[1]) / (bbox[3] - bbox[1] || 1);
  const lowGroundFactor = 1 - (dx + dy) / 2; // 1 = low/cold corner, 0 = high/warm corner

  const samples: TemperatureSample[] = [];
  const baseline = 34; // °F, a typical clear-night low during frost season
  const seedOffset = Math.abs(Math.round((lat + lng) * 10000)) % 1000;

  for (let night = 0; night < nights; night++) {
    // Deterministic pseudo-randomness so repeated runs are stable in a demo.
    const noise = Math.sin(seedOffset + night * 12.9898) * 3;
    const nightSeverity = Math.sin(night * 0.35) * 2; // some nights colder than others
    const tempF = baseline - lowGroundFactor * 6 + noise * 0.6 + nightSeverity;

    const date = new Date();
    date.setDate(date.getDate() - (nights - night));
    date.setHours(5, 0, 0, 0); // pre-dawn low

    samples.push({ lat, lng, timestamp: date.toISOString(), temperatureF: Math.round(tempF * 10) / 10 });
  }

  return samples;
}
