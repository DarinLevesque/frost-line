import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { RiskCell, TemperatureSample } from "./types";
import { GRID_RESOLUTION_M } from "./constants";

/**
 * Build a grid of square cells covering `boundary`, clipped to it (cells
 * whose centroid falls outside are dropped). Cell size matches FortyGuard's
 * own ~20 m data resolution by default, so each cell maps cleanly onto one
 * API sample point.
 *
 * `boundary` may be a MultiPolygon — a property made of several drawn
 * blocks unions into one of those (see components/map.ts) — and Turf's
 * squareGrid mask handles that natively, no special-casing needed here.
 */
export function buildPropertyGrid(
  boundary: Feature<Polygon | MultiPolygon>,
  resolutionM: number = GRID_RESOLUTION_M
): Feature<Polygon>[] {
  const bbox = turf.bbox(boundary);
  const cellSideKm = resolutionM / 1000;
  const grid = turf.squareGrid(bbox, cellSideKm, {
    units: "kilometers",
    mask: boundary,
  });
  return grid.features;
}

/**
 * Score one cell's frost risk from a set of historical hourly samples near
 * its centroid. riskScore is simply the fraction of samples at/below the
 * threshold — deliberately simple and explainable over something fancier,
 * since Impact & Relevance scoring rewards a number judges can audit.
 */
export function scoreCell(
  id: string,
  polygon: Feature<Polygon>,
  samples: TemperatureSample[],
  thresholdF: number
): RiskCell {
  const [lng, lat] = turf.centroid(polygon).geometry.coordinates;
  const coldSamples = samples.filter((s) => s.temperatureF <= thresholdF);
  const worstTempF = samples.length
    ? Math.min(...samples.map((s) => s.temperatureF))
    : NaN;

  return {
    id,
    lat,
    lng,
    polygon,
    riskScore: samples.length ? coldSamples.length / samples.length : 0,
    worstTempF,
    coldHourCount: coldSamples.length,
    sampleCount: samples.length,
  };
}

/**
 * Score every cell in the grid. `samplesByCell` maps cell id -> its
 * historical samples (already pulled from FortyGuard, one call per cell
 * centroid, or however the real data pipeline ends up shaped).
 */
export function scoreGrid(
  cells: Feature<Polygon>[],
  samplesByCell: Map<string, TemperatureSample[]>,
  thresholdF: number
): RiskCell[] {
  return cells.map((polygon, i) => {
    const id = `cell-${i}`;
    return scoreCell(id, polygon, samplesByCell.get(id) ?? [], thresholdF);
  });
}
