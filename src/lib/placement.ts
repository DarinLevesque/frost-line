import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type { MachinePlacement, RiskCell } from "./types";
import { WIND_MACHINE_FOOTPRINT_M } from "./constants";

export interface PlacementOptions {
  /** Compass bearing (0=N, 90=E) the wind blows TOWARD on a typical cold clear night. */
  windBearingDeg: number;
  /** Stop adding machines once average cell risk drops below this. */
  riskFloor?: number;
  /** Hard cap on machine count, regardless of remaining risk. */
  maxMachines?: number;
  footprint?: typeof WIND_MACHINE_FOOTPRINT_M;
}

/**
 * Build the wind machine's coverage footprint as an asymmetric ellipse-like
 * polygon: stretched `downstream` meters in the direction the wind blows,
 * only `upstream` meters against it, and `crossStream` meters to each side.
 * Numbers default to the light-wind (0.2 m/s) case measured in Yi Dai's TU
 * Delft dissertation — real behavior will vary with actual wind speed, which
 * is exactly why this is a named, swappable parameter and not a hardcoded circle.
 */
export function buildFootprintPolygon(
  centerLat: number,
  centerLng: number,
  windBearingDeg: number,
  footprint: typeof WIND_MACHINE_FOOTPRINT_M = WIND_MACHINE_FOOTPRINT_M,
  steps: number = 64
): Feature<Polygon> {
  const { downstream, upstream, crossStream } = footprint;
  const center = turf.point([centerLng, centerLat]);
  const coords: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 360; // bearing of this sample point, 0..360
    const relative = (((theta - windBearingDeg) % 360) + 360) % 360; // 0 = straight downwind
    const rad = (relative * Math.PI) / 180;

    // Asymmetric ellipse radius: semi-major axis switches between the
    // downstream and upstream value depending on which half we're in,
    // semi-minor axis is the crossStream value on both sides.
    const a = Math.cos(rad) >= 0 ? downstream : upstream;
    const b = crossStream;
    const r =
      (a * b) /
      Math.sqrt(
        Math.pow(b * Math.cos(rad), 2) + Math.pow(a * Math.sin(rad), 2)
      );

    const dest = turf.destination(center, r / 1000, theta, {
      units: "kilometers",
    });
    coords.push(dest.geometry.coordinates as [number, number]);
  }
  coords.push(coords[0]);

  return turf.polygon([coords]);
}

/**
 * Greedy weighted set-cover: repeatedly place a machine at the
 * highest-risk uncovered cell, mark every cell inside its footprint as
 * covered, and repeat until the risk floor or machine budget is hit.
 *
 * Greedy instead of an exact solver on purpose — explainable, fast, and
 * good enough for a 4-day build. Revisit only if there's real time left.
 */
export function planPlacements(
  cells: RiskCell[],
  options: PlacementOptions
): MachinePlacement[] {
  const { windBearingDeg, riskFloor = 0.05, maxMachines = 12, footprint } =
    options;

  const remaining = new Map(cells.map((c) => [c.id, c]));
  const placements: MachinePlacement[] = [];

  while (remaining.size > 0 && placements.length < maxMachines) {
    const candidate = [...remaining.values()].sort(
      (a, b) => b.riskScore - a.riskScore
    )[0];
    if (candidate.riskScore < riskFloor) break;

    const footprintPolygon = buildFootprintPolygon(
      candidate.lat,
      candidate.lng,
      windBearingDeg,
      footprint
    );

    const covered: RiskCell[] = [];
    for (const cell of remaining.values()) {
      const pt = turf.point([cell.lng, cell.lat]);
      if (turf.booleanPointInPolygon(pt, footprintPolygon)) {
        covered.push(cell);
      }
    }
    if (covered.length === 0) {
      // Shouldn't happen (candidate always covers itself), but guard against
      // an infinite loop if it somehow does.
      remaining.delete(candidate.id);
      continue;
    }

    placements.push({
      id: `machine-${placements.length + 1}`,
      lat: candidate.lat,
      lng: candidate.lng,
      footprint: footprintPolygon,
      coveredCellIds: covered.map((c) => c.id),
      coverageValue: covered.reduce((sum, c) => sum + c.riskScore, 0),
    });

    for (const c of covered) remaining.delete(c.id);
  }

  return placements;
}
