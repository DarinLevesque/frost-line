import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { MachinePlacement, RiskCell } from "../lib/types";
import { DEMO_SITE } from "../lib/constants";

// Leaflet's default marker icons reference image files by relative URL,
// which breaks under Vite's bundling. Point them at the CDN copies instead —
// simplest fix that survives both `vite dev` and `vite build`.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/**
 * The combined property boundary can end up as a MultiPolygon once more
 * than one drawn shape is unioned — e.g. two separate, non-touching
 * vineyard blocks. Every consumer downstream (grid.ts, main.ts) needs to
 * accept that, not just a plain Polygon.
 */
export type Boundary = Feature<Polygon | MultiPolygon>;

export interface FrostMap {
  map: L.Map;
  /** All currently drawn shapes, unioned into one boundary. Null if nothing is drawn. */
  drawnBoundary: () => Boundary | null;
  /** Replace whatever is drawn with a single boundary (used by "Load demo block"). */
  setBoundary: (geojson: Boundary) => void;
  /** Remove every drawn shape and start over. */
  clearBoundary: () => void;
  renderRiskGrid: (cells: RiskCell[]) => void;
  renderPlacements: (placements: MachinePlacement[]) => void;
  clearAnalysisLayers: () => void;
  onBoundaryChange: (cb: (geojson: Boundary | null) => void) => void;
}

/** Color scale for risk 0..1 — pale straw to deep frost-red, low to high. */
function riskColor(risk: number): string {
  if (risk < 0.05) return "#dfe7e2";
  if (risk < 0.15) return "#bfe3c9";
  if (risk < 0.3) return "#f0d98c";
  if (risk < 0.5) return "#e8a24f";
  return "#c0432f";
}

export function initFrostMap(containerId: string): FrostMap {
  const map = L.map(containerId, {
    center: [DEMO_SITE.center.lat, DEMO_SITE.center.lng],
    zoom: DEMO_SITE.zoom,
  });

  const imagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
      maxZoom: 19,
    }
  ).addTo(map);

  const streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }
  );

  L.control.layers({ Satellite: imagery, Streets: streets }).addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);
  const analysisLayer = new L.LayerGroup().addTo(map);

  const drawControl = new (L.Control as any).Draw({
    edit: { featureGroup: drawnItems },
    draw: {
      polygon: {
        allowIntersection: false,
        // NOTE: leave this false. leaflet-draw's showArea:true path calls
        // L.GeometryUtil.readableArea(), which has a real bug — it assigns
        // to an undeclared `type` variable (dist/leaflet.draw-src.js
        // around L.GeometryUtil.readableArea). That's silently tolerated
        // as a sloppy-mode global under a plain <script> tag, but throws
        // "ReferenceError: type is not defined" once bundled as strict-mode
        // ESM (which is exactly what Vite does). The error fires on every
        // vertex added, which corrupts leaflet-draw's internal marker
        // state and makes drawing stop dead after ~3 points — that's the
        // "can't add more than 3 points" bug. We compute our own acreage
        // after analysis anyway, so the live tooltip isn't needed.
        showArea: false,
        shapeOptions: { color: "#c8712a" },
      },
      // Property boundaries are polygons — everything else off to keep the
      // toolbar (and the demo) focused.
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false,
    },
  });
  map.addControl(drawControl);

  let boundaryChangeCb: (geojson: Boundary | null) => void = () => {};

  /**
   * Every shape currently on the map, unioned into a single boundary via
   * Turf. This is what makes "draw a few blocks, they combine into the
   * property" work: overlapping shapes merge cleanly with no double-counted
   * area, and disjoint shapes (e.g. two blocks split by a road) come back as
   * a MultiPolygon that the grid/analysis pipeline treats as one property.
   */
  function currentBoundary(): Boundary | null {
    const layers = drawnItems
      .getLayers()
      .filter((l): l is L.Polygon => l instanceof L.Polygon);
    if (layers.length === 0) return null;

    const polygons = layers.map((l) => l.toGeoJSON() as Feature<Polygon>);
    if (polygons.length === 1) return polygons[0];

    const unioned = turf.union(turf.featureCollection(polygons));
    // turf.union can only fail to return something on truly degenerate
    // input (e.g. zero-area shapes) — fall back to the first shape rather
    // than silently losing the boundary.
    return (unioned as Boundary | null) ?? polygons[0];
  }

  map.on((L as any).Draw.Event.CREATED, (e: any) => {
    drawnItems.addLayer(e.layer);
    boundaryChangeCb(currentBoundary());
  });
  map.on((L as any).Draw.Event.EDITED, () => boundaryChangeCb(currentBoundary()));
  map.on((L as any).Draw.Event.DELETED, () => boundaryChangeCb(currentBoundary()));

  return {
    map,
    drawnBoundary: currentBoundary,
    setBoundary(geojson) {
      drawnItems.clearLayers();
      const layer = L.geoJSON(geojson as any, {
        style: { color: "#c8712a" },
      });
      layer.eachLayer((l) => drawnItems.addLayer(l));
      map.fitBounds(drawnItems.getBounds(), { padding: [24, 24] });
      boundaryChangeCb(currentBoundary());
    },
    clearBoundary() {
      drawnItems.clearLayers();
      boundaryChangeCb(null);
    },
    renderRiskGrid(cells) {
      // FortyGuard's real risk scores for this use case cluster tightly
      // (often within a percentage point or two of each other), which the
      // fixed absolute color buckets below would otherwise paint as one
      // uniform color across the whole grid — dividing by the max alone
      // isn't enough to fix that, since a narrow absolute spread (say
      // 1.8%-2.1%) stays narrow after dividing by its own max too. Instead,
      // min-max stretch each cell's risk across this run's own low..high
      // range so the full pale-to-red bucket scale is used to show *relative*
      // risk on this property — the tooltip text still reports the real
      // absolute risk percentage.
      const riskScores = cells.map((c) => c.riskScore);
      const minRiskScore = Math.min(...riskScores);
      const maxRiskScore = Math.max(...riskScores);
      const riskRange = maxRiskScore - minRiskScore;
      for (const cell of cells) {
        const normalizedRisk =
          riskRange > 0 ? (cell.riskScore - minRiskScore) / riskRange : 0;
        L.geoJSON(cell.polygon as any, {
          style: {
            color: "#14212b",
            weight: 0.5,
            opacity: 0.25,
            fillColor: riskColor(normalizedRisk),
            fillOpacity: 0.55,
          },
        })
          .bindTooltip(
            `Risk ${Math.round(cell.riskScore * 100)}%` +
              `${cell.worstSeasonYear !== undefined ? ` (worst season: ${cell.worstSeasonYear})` : ""}` +
              `${cell.worstTempF !== null ? ` · worst ${cell.worstTempF.toFixed(1)}°F` : ""}` +
              ` · ${cell.coldHourCount}/${cell.sampleCount} below threshold` +
              `${cell.typicalRiskScore !== undefined ? ` · typical season ${Math.round(cell.typicalRiskScore * 100)}%` : ""}`,
            { sticky: true }
          )
          .addTo(analysisLayer);
      }
    },
    renderPlacements(placements) {
      for (const p of placements) {
        // interactive: false so this coverage-footprint overlay (added on
        // top of the risk grid) never steals hover/click events from the
        // grid cells beneath it — otherwise the per-tile risk/temperature
        // tooltip becomes unreachable wherever a footprint overlaps.
        L.geoJSON(p.footprint as any, {
          interactive: false,
          style: {
            color: "#2f6f8f",
            weight: 1.5,
            fillOpacity: 0.06,
            dashArray: "4 3",
          },
        }).addTo(analysisLayer);

        L.marker([p.lat, p.lng])
          .bindPopup(
            `<strong>${p.id}</strong><br/>Covers ${p.coveredCellIds.length} cell(s)<br/>Coverage value ${p.coverageValue.toFixed(2)}`
          )
          .addTo(analysisLayer);
      }
    },
    clearAnalysisLayers() {
      analysisLayer.clearLayers();
    },
    onBoundaryChange(cb) {
      boundaryChangeCb = cb;
    },
  };
}
