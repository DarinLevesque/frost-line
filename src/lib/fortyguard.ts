import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CreditsUsage, RiskCell } from "./types";
import * as connectionLog from "./connectionLog";

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
 *
 * Every request below goes through `fetchAndLog`, which records it in
 * src/lib/connectionLog.ts — that's what powers the "FortyGuard connection"
 * badge and inspector panel in main.ts. It replaces the older
 * fetch()-then-readProxyResponse() pattern (same single-read-of-the-body
 * discipline, see the comment on readProxyResponse's removal below — a
 * Response body can only be consumed once, and reading it twice under an
 * error path used to throw "body stream already read" and mask the real
 * error).
 */

const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 90; // ~6 minutes — Heatmap generation isn't documented as slow like Heat Intelligence's PDF report, but budget generously.

/** Thrown when the server-side proxy has no FORTYGUARD_API_KEY configured — callers should fall back to mock data, not surface this as a hard error. */
export class FortyGuardConfigError extends Error {}

/**
 * Thrown client-side, before any request is submitted, when the requested
 * date range violates FortyGuard's documented filter_type 4 cap (a single
 * range-of-days request covers at most MAX_RANGE_DAYS). Caught the same way
 * as FortyGuardConfigError by callers, but with a message that tells the
 * user exactly what to fix instead of "the API failed" — a too-wide range
 * (e.g. picking dates years apart now that the pickers unlock the full
 * 2019-present history) was traced to upstream 500s that looked identical
 * to a real outage until the request body was inspected.
 */
export class FortyGuardRangeError extends Error {}

function tryParseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * fetch() + single-read-the-body-once response handling, instrumented into
 * connectionLog so every call (success, HTTP error, or network failure)
 * shows up in the inspector panel with its request/response bodies.
 *
 * `label` is the human-friendly name shown in the inspector (e.g. "Submit
 * heatmap request"); `method`/`url` are the technical detail shown under it.
 */
async function fetchAndLog(
  label: string,
  method: string,
  url: string,
  init?: RequestInit
): Promise<any> {
  const logId = connectionLog.startEntry(label, method, url, tryParseJsonBody(init?.body));
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (networkErr) {
    const durationMs = Date.now() - t0;
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    connectionLog.finishEntry(logId, {
      status: "error",
      durationMs,
      errorMessage: `Network error: ${msg}`,
    });
    throw new Error(`FortyGuard network error: ${msg}`);
  }

  const raw = await res.text();
  const durationMs = Date.now() - t0;
  let parsed: any = undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — most likely an HTML error/interstitial page from the
    // hosting platform rather than from our own edge function.
  }

  if (res.status === 500 && parsed?.configError) {
    const message = parsed.error ?? "FortyGuard API key not configured";
    connectionLog.finishEntry(logId, {
      status: "error",
      statusCode: res.status,
      durationMs,
      responseBody: parsed,
      errorMessage: message,
    });
    throw new FortyGuardConfigError(message);
  }
  if (!res.ok) {
    const message = `FortyGuard request failed (${res.status}): ${raw.slice(0, 500)}`;
    connectionLog.finishEntry(logId, {
      status: "error",
      statusCode: res.status,
      durationMs,
      responseBody: parsed ?? raw.slice(0, 500),
      errorMessage: message,
    });
    throw new Error(message);
  }
  if (parsed === undefined) {
    const message = `FortyGuard proxy returned a non-JSON response (status ${res.status}): ${raw.slice(0, 500)}`;
    connectionLog.finishEntry(logId, {
      status: "error",
      statusCode: res.status,
      durationMs,
      responseBody: raw.slice(0, 500),
      errorMessage: message,
    });
    throw new Error(message);
  }

  connectionLog.finishEntry(logId, {
    status: "success",
    statusCode: res.status,
    durationMs,
    responseBody: parsed,
  });
  return parsed;
}

/** True for errors worth one silent retry — a dropped connection or a proxy/upstream hiccup, not a config or validation problem. */
function isRetryable(err: unknown): boolean {
  if (err instanceof FortyGuardConfigError) return false;
  if (!(err instanceof Error)) return true;
  return (
    err.message.startsWith("FortyGuard network error") ||
    /\(50[0-9]\)/.test(err.message) // 500-599 from the proxy or upstream
  );
}

/**
 * Retry budget bumped from a single retry to two (three attempts total)
 * with a short backoff, after a live burst of transient upstream 500s
 * (confirmed via Vercel runtime logs + a direct re-test against FortyGuard's
 * API, which round-tripped cleanly — so the API itself wasn't down, just
 * briefly flaky) showed one retry sometimes wasn't enough to ride out a
 * short blip.
 */
const RETRY_BACKOFF_MS = [1500, 3000];

async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === RETRY_BACKOFF_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt]));
    }
  }
  throw lastErr;
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

/** FortyGuard's documented cap for a single filter_type 4 (range of days) request. */
export const MAX_RANGE_DAYS = 31;

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

async function submitHeatmap(
  polygon: Feature<Polygon>,
  query: LiveRiskQuery
): Promise<string> {
  const data = await withOneRetry(() =>
    fetchAndLog("Submit heatmap request", "POST", "/api/fortyguard/heatmap", {
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
    })
  );
  const activityId = data?.data?.activity_id;
  if (!activityId) {
    throw new Error("FortyGuard submission response had no activity_id");
  }
  return activityId;
}

async function pollHeatmap(activityId: string): Promise<any> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const data = await fetchAndLog(
      "Poll heatmap status",
      "GET",
      `/api/fortyguard/status?activity_id=${encodeURIComponent(activityId)}`
    );
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
 *
 * A boundary with more than one disjoint block submits one request per
 * polygon, in parallel, via Promise.allSettled rather than Promise.all: one
 * slow or momentarily-flaky block (a single dropped connection, a rate
 * limit hit on just that call) no longer takes the *entire* property back
 * to simulated data — as long as at least one polygon's request succeeds,
 * its cells are used and the rest are reported as partial coverage. Every
 * block failing is still treated as a hard failure so the caller falls
 * back to mock data, same as before.
 */
export async function fetchLiveRiskCells(
  query: LiveRiskQuery
): Promise<RiskCell[]> {
  const rangeDays = daysBetween(query.startDate, query.endDate);
  if (rangeDays < 0) {
    throw new FortyGuardRangeError(
      `End date ${query.endDate} is before start date ${query.startDate}.`
    );
  }
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new FortyGuardRangeError(
      `Date range too wide: ${query.startDate} to ${query.endDate} is ${rangeDays} days — ` +
        `FortyGuard's Create Heatmap endpoint covers at most ${MAX_RANGE_DAYS} days per request ` +
        `(it returns a 500 rather than a clear validation error when this is exceeded). ` +
        `Narrow the date range and try again.`
    );
  }

  const polygons: Feature<Polygon>[] =
    query.boundary.geometry.type === "Polygon"
      ? [query.boundary as Feature<Polygon>]
      : (turf.flatten(query.boundary).features as Feature<Polygon>[]);

  const totalHours = hoursBetween(query.startDate, query.endDate);

  const settled = await Promise.allSettled(
    polygons.map(async (polygon) => {
      const activityId = await withOneRetry(() => submitHeatmap(polygon, query));
      const result = await pollHeatmap(activityId);
      return tilesToRiskCells(result?.map_data, totalHours);
    })
  );

  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<RiskCell[]> => r.status === "fulfilled"
  );
  const rejected = settled.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );

  if (fulfilled.length === 0) {
    // Every block failed — surface the first block's error (a
    // FortyGuardConfigError propagates as-is so the caller's mock-data
    // fallback path stays intact; anything else becomes a normal Error).
    const first = rejected[0]?.reason;
    if (first instanceof FortyGuardConfigError) throw first;
    throw new Error(
      rejected.length > 1
        ? `All ${rejected.length} property blocks failed to fetch live data — see the connection log for details.`
        : String(first instanceof Error ? first.message : first)
    );
  }

  if (rejected.length > 0) {
    // Partial success: log it so it's visible in the inspector, but don't
    // fail the whole analysis over it — the caller still gets real data
    // for the blocks that worked.
    console.warn(
      `FortyGuard: ${rejected.length}/${polygons.length} property block(s) failed to fetch live data; continuing with the ${fulfilled.length} that succeeded.`,
      rejected.map((r) => r.reason)
    );
  }

  return fulfilled.flatMap((r) => r.value);
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
  const data = await fetchAndLog("Check API credit usage", "GET", "/api/fortyguard/usage");
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
