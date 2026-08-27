import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CreditsUsage, RiskCell } from "./types";

/**
 * Real FortyGuard Temperature API client — confirmed against
 * docs-api.fortyguard.com on 2026-08-27 (that domain wouldn't render during
 * initial planning; it works now).
 *
 * CONFIRMED, from the docs:
 *   Auth:    header `api-key: <key>` (not Bearer) — see api/fortyguard/*.ts
 *   Submit:  POST /v1/heatmap  → { data: { activity_id } }, async task
 *   Poll:    GET  /v1/status/{activity_id} → { data: { status, result? } }
 *            status cycles Processing → Completed | Failed
 *   Create Heatmap request:
 *     polygon_aoi   GeoJSON FeatureCollection wrapping ONE Polygon
 *     date_time     { start_date, end_date?, start_time?, end_time?, filter_type }
 *                   filter_type 4 (range of days) covers at most 1 month,
 *                   history goes back to 2019-01-01, forecast up to +12h
 *     granularity   60 | 80 | 100 (meters — 60 is the finest available)
 *     analytic_type 'tcm' (default) | 'time_of_measure' | 'exceedance' | 'persistence'
 *     threshold     °C, used by exceedance/persistence (default 30)
 *     direction     'above' (default) | 'below', used by exceedance/persistence
 *   Result (once status is "Completed"): { result: { map_data, stats_data } }
 *     map_data is a GeoJSON FeatureCollection of tiles.
 *
 * We use analytic_type "exceedance" + direction "below" so FortyGuard's own
 * Large Temperature Model does the threshold counting per tile — we don't
 * pull raw hourly samples and re-derive risk ourselves the way mockData.ts
 * does. That's a stronger "built on FortyGuard's intelligence" story and
 * less code.
 *
 * CONFIRMED live against a real key on 2026-08-27 (see project memory /
 * hackathon_sprint.md for the full smoke-test log): each exceedance/persistence
 * tile's `properties` is `{ tile_id, value }` where `value` is the exceedance
 * hour count (matches the docs' declared "hour" units in stats_data). A tcm
 * request instead returns `{ tile_id, average_temperature, min_temperature,
 * max_temperature }` per tile — not used here, but useful if a future feature
 * wants per-tile worst-temp alongside exceedance.
 */

const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 90; // ~6 minutes — Heatmap generation isn't documented as slow like Heat Intelligence's PDF report, but budget generously.

/** Thrown when the server-side proxy has no FORTYGUARD_API_KEY configured — callers should fall back to mock data, not surface this as a hard error. */
export class FortyGuardConfigError extends Error {}

/**
 * Read a /api/fortyguard/* proxy response body exactly once, then decide
 * what to do with it. A Response body can only be consumed a single time —
 * calling res.json() and then, in a later branch, res.text() on the same
 * Response throws "body stream already read" and masks whatever the real
 * error was. (Found live: Vercel's deployment-protection interstitial
 * returns 200 with an HTML page instead of our proxy's JSON when SSO
 * protection is on for a domain — res.json() failed to parse it, fell
 * through to the res.text() branch, and threw the body-already-read error
 * instead of a useful one.)
 */
async function readProxyResponse(res: Response): Promise<any> {
  const raw = await res.text();
  let parsed: any = undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — most likely an HTML error/interstitial page from the
    // hosting platform rather than from our own edge function.
  }
  if (res.status === 500 && parsed?.configError) {
    throw new FortyGuardConfigError(
      parsed.error ?? "FortyGuard API key not configured"
    );
  }
  if (!res.ok) {
    throw new Error(
      `FortyGuard request failed (${res.status}): ${raw.slice(0, 500)}`
    );
  }
  if (parsed === undefined) {
    throw new Error(
      `FortyGuard proxy returned a non-JSON response (status ${res.status}): ${raw.slice(0, 500)}`
    );
  }
  return parsed;
}

export interface LiveRiskQuery {
  /** Property boundary — a MultiPolygon (combined drawn blocks) submits one request per component polygon, in parallel. */
  boundary: Feature<Polygon | MultiPolygon>;
  /** Active LT50 frost threshold, °F (converted to °C for the API). */
  thresholdF: number;
  /** YYYY-MM-DD, inclusive. FortyGuard caps a single range-of-days request at 1 month. */
  startDate: string;
  /** YYYY-MM-DD, inclusive. */
  endDate: string;
  /** Tile size in meters. 60 is the finest FortyGuard offers. */
  granularityM?: 60 | 80 | 100;
}

function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

function hoursBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T23:59:59Z`).getTime();
  return Math.max(1, Math.round((end - start) / 3_600_000));
}

async function submitHeatmap(
  polygon: Feature<Polygon>,
  query: LiveRiskQuery
): Promise<string> {
  const res = await fetch("/api/fortyguard/heatmap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      polygon_aoi: turf.featureCollection([polygon]),
      date_time: {
        start_date: query.startDate,
        end_date: query.endDate,
        filter_type: 4,
      },
      granularity: query.granularityM ?? 60,
      analytic_type: "exceedance",
      threshold: fahrenheitToCelsius(query.thresholdF),
      direction: "below",
    }),
  });

  const data = await readProxyResponse(res);
  const activityId = data?.data?.activity_id;
  if (!activityId) {
    throw new Error("FortyGuard submission response had no activity_id");
  }
  return activityId;
}

async function pollHeatmap(activityId: string): Promise<any> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(
      `/api/fortyguard/status?activity_id=${encodeURIComponent(activityId)}`
    );
    const data = await readProxyResponse(res);
    const status = String(data?.data?.status ?? "").toLowerCase();

    if (status === "completed" || status === "succeeded") {
      return data.data.result;
    }
    if (status === "failed" || status === "error") {
      throw new Error(`FortyGuard activity ${activityId} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `FortyGuard activity ${activityId} did not complete within the poll budget`
  );
}

/**
 * Convert one Create Heatmap "exceedance" result into RiskCell[]. Each
 * map_data feature is one FortyGuard tile at the requested granularity;
 * its exceedance value (hours below threshold, over the requested date
 * range) becomes coldHourCount, normalized by the range's total hours to a
 * 0..1 riskScore — same meaning as the mock pipeline's riskScore, so
 * placement.ts and savings.ts don't need to know which source produced it.
 */
function tilesToRiskCells(mapData: any, totalHours: number): RiskCell[] {
  const features: any[] = mapData?.features ?? [];
  return features.map((f, i) => {
    const props = f.properties ?? {};
    // `value` is the confirmed exceedance-hours property name (live-verified
    // 2026-08-27). Keep a defensive fallback in case FortyGuard renames it.
    const coldHourCount = Number(props.value ?? 0);
    const [lng, lat] = turf.centroid(f).geometry.coordinates;
    return {
      id: `fg-tile-${i}`,
      lat,
      lng,
      polygon: f as Feature<Polygon>,
      riskScore: Math.max(0, Math.min(1, coldHourCount / totalHours)),
      // Exceedance responses don't include a per-tile minimum temperature —
      // that would need a separate analytic_type: "tcm" request. Left null
      // rather than guessed; the map tooltip and results panel handle it.
      worstTempF: null,
      coldHourCount,
      sampleCount: totalHours,
    };
  });
}

/**
 * Pull real frost-risk cells from FortyGuard for the given boundary and
 * date range. Throws FortyGuardConfigError if no API key is configured
 * server-side — callers should catch that specifically and fall back to
 * src/lib/mockData.ts, exactly as main.ts does.
 */
export async function fetchLiveRiskCells(
  query: LiveRiskQuery
): Promise<RiskCell[]> {
  const polygons: Feature<Polygon>[] =
    query.boundary.geometry.type === "Polygon"
      ? [query.boundary as Feature<Polygon>]
      : (turf.flatten(query.boundary).features as Feature<Polygon>[]);

  const totalHours = hoursBetween(query.startDate, query.endDate);

  const perPolygon = await Promise.all(
    polygons.map(async (polygon) => {
      const activityId = await submitHeatmap(polygon, query);
      const result = await pollHeatmap(activityId);
      return tilesToRiskCells(result?.map_data, totalHours);
    })
  );

  return perPolygon.flat();
}


/**
 * Pull the current FortyGuard account's credit usage — total/remaining
 * credits for the billing cycle, plan details, and a per-activity
 * breakdown (e.g. how much of it Heatmap Generation has consumed).
 * Throws FortyGuardConfigError if no API key is configured server-side,
 * same convention as fetchLiveRiskCells — callers should catch that
 * specifically and show a "not configured" state rather than an error.
 */
export async function fetchCreditsUsage(): Promise<CreditsUsage> {
  const res = await fetch("/api/fortyguard/usage");

  const data = await readProxyResponse(res);
  const plan = data?.plan_details ?? {};
  const keyDetails = data?.api_key_details ?? {};
  const credits = data?.credit_summary ?? {};
  const breakdown: any[] = data?.activity_breakdown ?? [];

  return {
    planType: plan.plan_type ?? "Unknown",
    billingPeriod: plan.billing_period ?? "",
    creditsResetDate: plan.credits_reset_date ?? "",
    apiKeyStatus: keyDetails.status ?? "unknown",
    apiKeyValid: Boolean(keyDetails.valid),
    totalCredits: Number(credits.total_available_credits ?? 0),
    cycleUsedCredits: Number(credits.cycle_credits_used ?? 0),
    cycleRemainingCredits: Number(credits.cycle_remaining_credits ?? 0),
    cycleUsagePercentage: Number(credits.cycle_usage_percentage ?? 0),
    activityBreakdown: breakdown.map((a) => ({
      name: String(a?.name ?? "Unknown"),
      credits: Number(a?.credits ?? 0),
      count: Number(a?.count ?? 0),
      percentage: Number(a?.percentage ?? 0),
    })),
  };
}
