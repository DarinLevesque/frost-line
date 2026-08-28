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

interface HeatmapWindowArgs {
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  /** YYYY-MM-DD, inclusive. */
  endDate: string;
  /** Active LT50 frost threshold, °F (converted to °C for the API). */
  thresholdF: number;
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
const MAX_RANGE_DAYS = 31;

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

async function submitHeatmap(
  polygon: Feature<Polygon>,
  args: HeatmapWindowArgs
): Promise<string> {
  // Validated here, not just by the climatology windows below, so this
  // stays a hard backstop against a repeat of the Aug 28 bug (a >31-day
  // window reaching FortyGuard as a bare 500) for any future caller too.
  const rangeDays = daysBetween(args.startDate, args.endDate);
  if (rangeDays < 0) {
    throw new FortyGuardRangeError(
      `End date ${args.endDate} is before start date ${args.startDate}.`
    );
  }
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new FortyGuardRangeError(
      `Date range too wide: ${args.startDate} to ${args.endDate} is ${rangeDays} days — ` +
        `FortyGuard's Create Heatmap endpoint covers at most ${MAX_RANGE_DAYS} days per request ` +
        `(it returns a 500 rather than a clear validation error when this is exceeded). ` +
        `Narrow the date range and try again.`
    );
  }

  const data = await withOneRetry(() =>
    fetchAndLog("Submit heatmap request", "POST", "/api/fortyguard/heatmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        polygon_aoi: turf.featureCollection([polygon]),
        date_time: {
          start_date: args.startDate,
          end_date: args.endDate,
          filter_type: 4,
        },
        granularity: args.granularityM ?? 60,
        analytic_type: "exceedance",
        threshold: fahrenheitToCelsius(args.thresholdF),
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
 * Number of most recent spring seasons (Mar 1–May 31) the live climatology
 * aggregates across, by default. Every LT50 growth stage this app tracks
 * (dormant through four-leaf) is a spring bud-development stage, so autumn
 * is deliberately out of scope — no point spending credits on data that
 * can't inform this app's risk score.
 */
export const CLIMATOLOGY_SEASON_COUNT = 3;

/** How many (polygon, season-window) FortyGuard requests run at once — kept modest since FortyGuard's own per-account concurrency limits aren't documented. */
const CLIMATOLOGY_CONCURRENCY = 6;

/** Matches FORTYGUARD_NOTES.historyStart in constants.ts — duplicated as a number here to keep the year math simple; both are asserted to agree by the caller (main.ts). */
const MIN_HISTORY_YEAR = 2019;

/** The three ≤31-day requests (Mar, Apr, May — fixed lengths, no leap-year handling needed) that make up one spring season. */
function springWindowsForYear(
  year: number
): { startDate: string; endDate: string; label: string }[] {
  return [
    { startDate: `${year}-03-01`, endDate: `${year}-03-31`, label: `Mar ${year}` },
    { startDate: `${year}-04-01`, endDate: `${year}-04-30`, label: `Apr ${year}` },
    { startDate: `${year}-05-01`, endDate: `${year}-05-31`, label: `May ${year}` },
  ];
}

/**
 * The `seasonCount` most recent COMPLETE spring seasons (a season only
 * counts once its May 31 has passed), not earlier than MIN_HISTORY_YEAR.
 * Oldest first, so callers can display "2024, 2025, 2026" in chronological
 * order rather than counting down.
 */
export function recentSpringSeasonYears(
  seasonCount: number,
  now: Date = new Date()
): number[] {
  const currentYear = now.getUTCFullYear();
  const mayEndThisYear = Date.UTC(currentYear, 4, 31, 23, 59, 59); // May is JS month index 4
  const lastCompleteYear = now.getTime() >= mayEndThisYear ? currentYear : currentYear - 1;
  const years: number[] = [];
  for (let y = lastCompleteYear; years.length < seasonCount && y >= MIN_HISTORY_YEAR; y--) {
    years.push(y);
  }
  return years.reverse();
}

/** Runs `fn` over `items` with at most `limit` in flight at once, returning settled results in the original order — same shape as Promise.allSettled, just bounded. */
async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export interface ClimatologyQuery {
  /** Property boundary — a MultiPolygon (combined drawn blocks) submits requests per component polygon. */
  boundary: Feature<Polygon | MultiPolygon>;
  /** Active LT50 frost threshold, °F (converted to °C for the API). */
  thresholdF: number;
  /** How many recent spring seasons to aggregate; defaults to CLIMATOLOGY_SEASON_COUNT. */
  seasonCount?: number;
  /** Tile size in meters. 60 is the finest FortyGuard offers. */
  granularityM?: 60 | 80 | 100;
  /** Called after each (polygon, season-window) request settles, for progress UI. */
  onProgress?: (completed: number, total: number) => void;
}

export interface ClimatologyResult {
  cells: RiskCell[];
  /** The spring years actually aggregated, oldest first. */
  seasonsUsed: number[];
}

/**
 * Build a multi-year frost climatology instead of scoring risk from one
 * arbitrary date window: fetch FortyGuard's exceedance heatmap for the
 * Mar/Apr/May windows of each of the last `seasonCount` spring seasons,
 * and aggregate every tile's exceedance hours across every season it
 * appeared in. riskScore becomes "fraction of all spring hours considered,
 * across N years, that this cell spent below threshold" — a real
 * historical frequency instead of one arbitrary window's snapshot, and a
 * much sounder basis for siting fixed equipment than a single date range.
 *
 * Tiles are matched across requests by FortyGuard's own `tile_id`
 * property (stable per location for a given AOI/granularity), not array
 * position — each request returns its own feature order.
 *
 * Requests run with bounded concurrency (CLIMATOLOGY_CONCURRENCY) via
 * Promise-settled batching: an individual (polygon, window) request that
 * fails is logged and excluded, not fatal to the whole climatology, as
 * long as at least one request across the whole matrix succeeds — same
 * partial-failure philosophy the single-window version used. A fully
 * failed matrix throws (FortyGuardConfigError propagates as-is so the
 * caller's mock-data fallback path stays intact).
 */
export async function fetchClimatologyRiskCells(
  query: ClimatologyQuery
): Promise<ClimatologyResult> {
  const seasonCount = query.seasonCount ?? CLIMATOLOGY_SEASON_COUNT;
  const years = recentSpringSeasonYears(seasonCount);

  const polygons: Feature<Polygon>[] =
    query.boundary.geometry.type === "Polygon"
      ? [query.boundary as Feature<Polygon>]
      : (turf.flatten(query.boundary).features as Feature<Polygon>[]);

  const jobs = polygons.flatMap((polygon) =>
    years.flatMap((year) =>
      springWindowsForYear(year).map((window) => ({ polygon, window }))
    )
  );

  let completed = 0;
  const settled = await settleWithConcurrency(jobs, CLIMATOLOGY_CONCURRENCY, async (job) => {
    const activityId = await withOneRetry(() =>
      submitHeatmap(job.polygon, {
        startDate: job.window.startDate,
        endDate: job.window.endDate,
        thresholdF: query.thresholdF,
        granularityM: query.granularityM,
      })
    );
    const result = await pollHeatmap(activityId);
    const hours = hoursBetween(job.window.startDate, job.window.endDate);
    const tiles: any[] = result?.map_data?.features ?? [];
    query.onProgress?.(++completed, jobs.length);
    return { tiles, hours };
  });

  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<{ tiles: any[]; hours: number }> =>
      r.status === "fulfilled"
  );
  const rejected = settled.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );

  if (fulfilled.length === 0) {
    const first = rejected[0]?.reason;
    if (first instanceof FortyGuardConfigError) throw first;
    throw new Error(
      `All ${rejected.length} FortyGuard climatology requests failed — see the connection log for details.`
    );
  }

  if (rejected.length > 0) {
    console.warn(
      `FortyGuard climatology: ${rejected.length}/${jobs.length} (polygon, season-window) request(s) failed; continuing with the ${fulfilled.length} that succeeded.`,
      rejected.map((r) => r.reason)
    );
  }

  // Aggregate every tile's exceedance hours across every window it showed
  // up in, keyed by FortyGuard's own tile_id (falls back to a coordinate
  // key in the unlikely case a response omits it, so one odd response
  // shape can't silently merge unrelated tiles together).
  const agg = new Map<
    string,
    { coldHours: number; totalHours: number; polygon: Feature<Polygon>; lat: number; lng: number }
  >();
  for (const { value } of fulfilled) {
    for (const f of value.tiles) {
      const props = f.properties ?? {};
      const tileId = String(props.tile_id ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0] ?? []));
      const coldHours = Number(props.value ?? 0);
      const existing = agg.get(tileId);
      if (existing) {
        existing.coldHours += coldHours;
        existing.totalHours += value.hours;
      } else {
        const [lng, lat] = turf.centroid(f).geometry.coordinates;
        agg.set(tileId, {
          coldHours,
          totalHours: value.hours,
          polygon: f as Feature<Polygon>,
          lat,
          lng,
        });
      }
    }
  }

  const cells: RiskCell[] = Array.from(agg.entries()).map(([tileId, v]) => ({
    id: `fg-tile-${tileId}`,
    lat: v.lat,
    lng: v.lng,
    polygon: v.polygon,
    riskScore: Math.max(0, Math.min(1, v.coldHours / v.totalHours)),
    // Exceedance responses don't include a per-tile minimum temperature —
    // that would need a separate analytic_type: "tcm" request per window.
    // Left null rather than guessed; the map tooltip and results panel
    // already handle a null worstTempF.
    worstTempF: null,
    coldHourCount: v.coldHours,
    sampleCount: v.totalHours,
  }));

  if (cells.length === 0) {
    throw new Error("FortyGuard climatology returned no tiles across any successful request.");
  }

  return { cells, seasonsUsed: years };
}

/**
 * Pull the current FortyGuard account's credit usage — total/remaining
 * credits for the billing cycle, plan details, and a per-activity
 * breakdown (e.g. how much of it Heatmap Generation has consumed).
 * Throws FortyGuardConfigError if no API key is configured server-side,
 * same convention as fetchClimatologyRiskCells — callers should catch that
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
