/**
 * Independent cross-check of FortyGuard's climatology using Open-Meteo's
 * ERA5-based historical reanalysis archive — NOT FortyGuard data, and
 * deliberately never blended into FortyGuard's per-tile riskScore.
 *
 * Added 2026-08-28 after discovering (see project memory / commit history
 * for the full investigation) that FortyGuard's temperature model — whose
 * own product pages describe it as built for heat/urban-heat use cases,
 * with no mention of cold, frost, or agriculture — reported a minimum of
 * only ~30-31°F at two independently tested real vineyard sites on a
 * night regional sources documented at 10-25°F. That's a real, useful
 * finding about the platform's operating envelope for this novel
 * (frost/cold) use case, not a bug in this app's code — but it means
 * FortyGuard's absolute numbers shouldn't be shown to users without a
 * second opinion. This module is that second opinion: a free, key-less,
 * independently-sourced sanity check, shown side by side and clearly
 * labeled so it's never mistaken for FortyGuard's own output.
 *
 * Point estimate only (property centroid) — Open-Meteo's archive is a
 * single-point API, not a tile grid, so it can't replace FortyGuard's
 * per-tile spatial resolution or the placement algorithm built on it.
 * It can only sanity-check the overall magnitude/frequency FortyGuard's
 * climatology reports for the property's general location. ERA5-Land
 * reanalysis is itself a ~9-11km grid product, not hyper-local either —
 * a large gap between the two numbers is informative either way, not
 * proof either source is "right."
 */

export interface CrossCheckQuery {
  lat: number;
  lng: number;
  /** Same spring years FortyGuard's climatology used, for an apples-to-apples comparison. */
  years: number[];
  /** Active LT50 frost threshold, °F — same value passed to the FortyGuard climatology. */
  thresholdF: number;
}

export interface CrossCheckYearFraction {
  year: number;
  fraction: number;
  coldHours: number;
  totalHours: number;
}

export interface CrossCheckResult {
  source: "open-meteo";
  /** Same "worst single season, not averaged" methodology as fetchClimatologyRiskCells, for comparability. */
  worstSeasonFraction: number;
  worstSeasonYear: number;
  typicalFraction: number;
  yearFractions: CrossCheckYearFraction[];
}

/**
 * Fetches one multi-year hourly temperature series in a SINGLE request
 * (Open-Meteo's archive has no ~31-day cap the way FortyGuard's range
 * query does), filters to the Mar 1–May 31 window of each requested
 * year, and computes the same "worst season's fraction of cold hours"
 * score fetchClimatologyRiskCells does — so the two numbers are directly
 * comparable even though the data sources and spatial resolution differ.
 */
export async function fetchOpenMeteoFrostCrossCheck(
  query: CrossCheckQuery
): Promise<CrossCheckResult> {
  const years = [...query.years].sort((a, b) => a - b);
  if (years.length === 0) {
    throw new Error("fetchOpenMeteoFrostCrossCheck: no years requested");
  }
  const startDate = `${years[0]}-03-01`;
  const endDate = `${years[years.length - 1]}-05-31`;

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${query.lat.toFixed(4)}&longitude=${query.lng.toFixed(4)}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m&temperature_unit=fahrenheit&timezone=UTC`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo cross-check request failed (${res.status})`);
  }
  const data = await res.json();
  const times: string[] = data?.hourly?.time ?? [];
  const temps: (number | null)[] = data?.hourly?.temperature_2m ?? [];

  const perYear = new Map<number, { coldHours: number; totalHours: number }>();
  const yearSet = new Set(years);
  for (let i = 0; i < times.length; i++) {
    const year = Number(times[i].slice(0, 4));
    const month = Number(times[i].slice(5, 7));
    if (!yearSet.has(year) || month < 3 || month > 5) continue; // Mar-May only, matching the FortyGuard climatology window
    const temp = temps[i];
    if (temp == null) continue;
    const entry = perYear.get(year) ?? { coldHours: 0, totalHours: 0 };
    entry.totalHours += 1;
    if (temp < query.thresholdF) entry.coldHours += 1;
    perYear.set(year, entry);
  }

  const yearFractions: CrossCheckYearFraction[] = Array.from(perYear.entries()).map(
    ([year, y]) => ({
      year,
      fraction: y.totalHours > 0 ? y.coldHours / y.totalHours : 0,
      coldHours: y.coldHours,
      totalHours: y.totalHours,
    })
  );
  if (yearFractions.length === 0) {
    throw new Error(
      "Open-Meteo cross-check returned no usable hourly data for the requested years."
    );
  }

  const worst = yearFractions.reduce((a, b) => (b.fraction > a.fraction ? b : a));
  const typicalFraction =
    yearFractions.reduce((sum, y) => sum + y.fraction, 0) / yearFractions.length;

  return {
    source: "open-meteo",
    worstSeasonFraction: worst.fraction,
    worstSeasonYear: worst.year,
    typicalFraction,
    yearFractions,
  };
}
