import "./style.css";
import { initFrostMap, type Boundary } from "./components/map";
import { buildPropertyGrid, scoreCell } from "./lib/grid";
import { generateMockSamplesForCell } from "./lib/mockData";
import {
  fetchClimatologyRiskCells,
  fetchCreditsUsage,
  FortyGuardConfigError,
  recentSpringSeasonYears,
  CLIMATOLOGY_SEASON_COUNT,
} from "./lib/fortyguard";
import * as connectionLog from "./lib/connectionLog";
import * as turf from "@turf/turf";
import { planPlacements } from "./lib/placement";
import { estimateSavings } from "./lib/savings";
import {
  DEMO_BOUNDARY_GEOJSON,
  DEMO_SITE,
  LT50_THRESHOLDS_F,
  FORTYGUARD_NOTES,
} from "./lib/constants";
import type { GrowthStage, RiskCell } from "./lib/types";
import { PARAMETER_INFO } from "./lib/parameterInfo";
import { fetchOpenMeteoFrostCrossCheck } from "./lib/openMeteoCrossCheck";
import {
  DEFAULT_WIND_MACHINE_PROFILE,
  COMING_SOON_WIND_MACHINE_PROFILES,
  estimateMachineCost,
} from "./lib/machineCost";

const DISSERTATION_URL =
  "https://doi.org/10.4233/uuid:7000b291-671c-4ab3-86fa-beeff39bf5df";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <header class="panel-header">
        <h1>Frost Line</h1>
        <p class="site-name">${DEMO_SITE.name}</p>
      </header>

      <section class="panel-section" id="credits-section">
        <h2 class="credits-heading">
          FortyGuard API credits
          <button
            type="button"
            id="connection-badge"
            class="connection-badge"
            aria-haspopup="dialog"
            title="View the FortyGuard connection log"
          >
            <span class="connection-dot" id="connection-dot"></span>
            <span id="connection-badge-label">Unknown</span>
          </button>
        </h2>
        <div class="credits-bar"><div class="credits-bar-fill" id="credits-bar-fill"></div></div>
        <p class="credits-line" id="credits-line">Checking usage…</p>
        <p class="hint" id="credits-detail"></p>
      </section>

      <section class="panel-section">
        <h2>1. Property boundary</h2>
        <p class="hint">Draw one or more polygons — separate blocks are fine, they're combined automatically into one property when you analyze. Or load the demo blocks at Stone Tower Winery to start.</p>
        <div class="btn-row">
          <button id="load-demo" class="btn">Load demo block</button>
          <button id="clear-boundary" class="btn btn-ghost">Clear boundary</button>
        </div>
      </section>

      <section class="panel-section">
        <h2>2. Frost parameters</h2>
        <label class="field">
          <span class="field-label-row">
            Growth stage
            <button type="button" class="info-icon" data-info-key="growth-stage" aria-label="What is this?">i</button>
          </span>
          <select id="growth-stage">
            <option value="greenSwollenBud">Green swollen bud (26°F)</option>
            <option value="budBurst" selected>Bud burst (28°F)</option>
            <option value="twoLeaf">Two-leaf (29°F)</option>
            <option value="fourLeaf">Four-leaf (30°F)</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label-row">
            Prevailing cold-night wind (blowing toward)
            <button type="button" class="info-icon" data-info-key="wind-bearing" aria-label="What is this?">i</button>
          </span>
          <div class="compass-wrap">
            <svg
              id="wind-compass"
              class="compass"
              viewBox="0 0 140 140"
              width="140"
              height="140"
              role="slider"
              aria-label="Prevailing cold-night wind direction, blowing toward"
              aria-valuemin="0"
              aria-valuemax="359"
              aria-valuenow="150"
              tabindex="0"
            >
              <circle cx="70" cy="70" r="62" class="compass-ring" />
              <g id="compass-ticks"></g>
              <text x="70" y="28" class="compass-label" text-anchor="middle">N</text>
              <text x="112" y="74" class="compass-label" text-anchor="middle">E</text>
              <text x="70" y="112" class="compass-label" text-anchor="middle">S</text>
              <text x="28" y="74" class="compass-label" text-anchor="middle">W</text>
              <g id="compass-needle">
                <line x1="70" y1="70" x2="70" y2="22" class="compass-needle-line" />
                <polygon points="70,13 64,26 76,26" class="compass-needle-head" />
              </g>
              <circle cx="70" cy="70" r="4" class="compass-hub" />
            </svg>
            <div class="compass-readout" id="compass-readout">150° · SSE</div>
          </div>
          <input id="wind-bearing" type="hidden" value="150" />
          <div class="wind-estimate">
            <button type="button" id="estimate-wind" class="btn btn-ghost">Estimate from historical wind data</button>
            <p class="hint" id="wind-estimate-note">
              Pulls free historical wind data for this location from
              <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>
              and averages the direction over cold spring/autumn hours (frost season, Northern Hemisphere).
              No boundary needed — falls back to the site location shown on the map.
            </p>
          </div>
        </label>
        <label class="field">
          <span class="field-label-row">
            Crop value ($/acre)
            <button type="button" class="info-icon" data-info-key="crop-value" aria-label="What is this?">i</button>
          </span>
          <input id="crop-value" type="number" min="0" step="500" value="35000" />
        </label>
        <label class="field">
          <span class="field-label-row">
            Frost nights / season (for savings estimate)
            <button type="button" class="info-icon" data-info-key="frost-nights" aria-label="What is this?">i</button>
          </span>
          <input id="frost-nights" type="number" min="0" max="365" value="10" />
        </label>
        <label class="field">
          <span class="field-label-row">
            Historical window (FortyGuard climatology)
            <button type="button" class="info-icon" data-info-key="history-window" aria-label="What is this?">i</button>
          </span>
          <p class="hint" id="climatology-window-note">Loading…</p>
        </label>
      </section>

      <section class="panel-section">
        <h2>3. Wind machine</h2>
        <p class="hint field-label-row">
          Not the same as a power-generating turbine
          <button type="button" class="info-icon" data-info-key="wind-turbine-vs-machine" aria-label="What is this?">i</button>
        </p>
        <label class="field">
          <span class="field-label-row">
            Machine profile
            <button type="button" class="info-icon" data-info-key="machine-profile" aria-label="What is this?">i</button>
          </span>
          <select id="machine-profile">
            <option value="${DEFAULT_WIND_MACHINE_PROFILE.id}" selected>${DEFAULT_WIND_MACHINE_PROFILE.name}</option>
            ${COMING_SOON_WIND_MACHINE_PROFILES.map(
              (p) => `<option value="${p.id}" disabled>${p.name}</option>`
            ).join("")}
          </select>
          <p class="hint">Other sizes are <span class="badge-soon">coming soon</span> — every placement below uses the default profile, the machine measured in <a href="https://doi.org/10.4233/uuid:7000b291-671c-4ab3-86fa-beeff39bf5df" target="_blank" rel="noopener noreferrer">Yi Dai's TU Delft dissertation</a> field trial.</p>
        </label>
        <div class="machine-profile-card">
          <div class="machine-profile-name">${DEFAULT_WIND_MACHINE_PROFILE.name}</div>
          <div class="machine-profile-specs">${DEFAULT_WIND_MACHINE_PROFILE.specSummary}</div>
        </div>
        <label class="field">
          <span class="field-label-row">
            Installed cost ($/machine)
            <button type="button" class="info-icon" data-info-key="installed-cost" aria-label="What is this?">i</button>
          </span>
          <input id="installed-cost" type="number" min="0" step="1000" value="30000" />
        </label>
        <label class="field">
          <span class="field-label-row">
            Fuel &amp; runtime
            <button type="button" class="info-icon" data-info-key="fuel-runtime" aria-label="What is this?">i</button>
          </span>
          <div class="fuel-inputs">
            <div class="fuel-input-group">
              <input id="fuel-burn-rate" type="number" min="0" step="0.5" value="12.5" />
              <span class="fuel-unit">gal propane/hr</span>
            </div>
            <div class="fuel-input-group">
              <input id="fuel-price" type="number" min="0" step="0.01" value="2.67" />
              <span class="fuel-unit">$/gal</span>
            </div>
            <div class="fuel-input-group">
              <input id="fuel-hours-per-night" type="number" min="0" step="0.5" value="5" />
              <span class="fuel-unit">hrs run / frost night</span>
            </div>
          </div>
          <p class="hint">Defaults: ~$30k installed and 12.5 gal/hr propane (UC Cooperative Extension Napa-area cost study), $2.67/gal (U.S. EIA national average), 5 hrs run per frost night.</p>
        </label>
      </section>

      <section class="panel-section">
        <div class="btn-row">
          <button id="analyze" class="btn btn-primary">Analyze property</button>
          <button id="clear-results" class="btn btn-ghost" hidden>Clear results</button>
        </div>
        <p class="hint data-note" id="data-source-note">Tries live FortyGuard data over the window above first; falls back to simulated data if no API key is configured yet — see <code>src/lib/fortyguard.ts</code>.</p>
      </section>

      <section class="panel-section" id="results" hidden>
        <div class="results-header">
          <h2>Results</h2>
          <button type="button" id="export-pdf-btn" class="btn btn-ghost btn-small">Export PDF report</button>
        </div>
        <p class="hint data-note" id="results-source-note"></p>
        <p class="hint report-meta" id="report-meta"></p>
        <div class="zero-risk-banner" id="zero-risk-banner" hidden>
          <strong>No machines recommended for this run.</strong>
          <p>
            FortyGuard's live risk data for this property and window came back
            at effectively zero — this isn't a bug in the placement logic,
            it's a known limitation in FortyGuard's cold-temperature data (see
            <a href="https://github.com/DarinLevesque/frost-line#known-limitations" target="_blank" rel="noopener noreferrer">Known limitations &#8599;</a>).
            The independent cross-check below (if shown) compares FortyGuard's
            number against a second data source for this same property. Try
            the Bud Burst growth stage on the demo property, or a different
            boundary, to see a run with measurable risk.
          </p>
        </div>
        <div class="stat-row">
          <div class="stat"><strong id="stat-machines">–</strong><span>machines recommended</span></div>
          <div class="stat"><strong id="stat-acres">–</strong><span>acres protected / analyzed</span></div>
        </div>
        <div class="savings-box">
          <div class="savings-label">Estimated annual crop savings</div>
          <div class="savings-value" id="stat-savings">–</div>
        </div>
        <div class="cost-box" id="cost-box">
          <div class="cost-row"><span>Installed cost (machines × $/machine)</span><strong id="stat-installed-cost">–</strong></div>
          <div class="cost-row"><span>Estimated annual fuel cost</span><strong id="stat-fuel-cost">–</strong></div>
          <div class="cost-row cost-row-net"><span>Net annual savings (after fuel)</span><strong id="stat-net-savings">–</strong></div>
          <div class="cost-row"><span>Rough payback period</span><strong id="stat-payback">–</strong></div>
        </div>
        <div class="machine-locations-box" id="machine-locations-box" hidden>
          <div class="machine-locations-header">Recommended wind machine locations</div>
          <ol class="machine-locations-list" id="machine-locations-list"></ol>
        </div>
        <ul class="assumptions" id="assumptions"></ul>
        <div class="crosscheck-box" id="crosscheck-box" hidden>
          <div class="crosscheck-header">
            <span>Independent cross-check (not FortyGuard data)</span>
            <button type="button" class="info-icon" data-info-key="open-meteo-crosscheck" aria-label="What is this?">i</button>
          </div>
          <p class="hint" id="crosscheck-note">–</p>
        </div>
      </section>

      <footer class="sources-footer">
        <strong>Science &amp; sources</strong>
        <p>
          Wind-machine placement physics: Y. Dai,
          <em>Wind Machines for Frost Damage Mitigation</em>
          (<a href="${DISSERTATION_URL}" target="_blank" rel="noopener noreferrer">TU Delft PhD dissertation, 2025 &#8599;</a>).
          Grapevine frost thresholds: Sugar et al. 2003 (Oregon State).
          Full citations, FortyGuard API usage notes, and known data
          limitations are documented in the
          <a href="https://github.com/DarinLevesque/frost-line#the-science" target="_blank" rel="noopener noreferrer">project README &#8599;</a>.
        </p>
      </footer>
    </aside>
    <main id="map"></main>
  </div>

  <div class="info-popover" id="info-popover" hidden role="dialog" aria-label="Parameter info">
    <div class="info-popover-header">
      <strong id="info-popover-title"></strong>
      <button type="button" id="info-popover-close" class="info-popover-close" aria-label="Close">✕</button>
    </div>
    <div class="info-popover-body" id="info-popover-body"></div>
  </div>

  <div class="connection-modal" id="connection-modal" hidden>
    <div class="connection-modal-panel" role="dialog" aria-modal="true" aria-label="FortyGuard connection log">
      <header class="connection-modal-header">
        <h2>FortyGuard connection</h2>
        <button type="button" id="connection-modal-close" class="btn btn-ghost connection-modal-close" aria-label="Hide">Hide ✕</button>
      </header>
      <p class="hint" id="connection-modal-status"></p>
      <div class="connection-log" id="connection-log-list"></div>
    </div>
  </div>
`;

const frostMap = initFrostMap("map");
let currentBoundary: Boundary | null = null;

const windCompass = initWindCompass();

/**
 * "Estimate from historical wind data": pulls free, key-less historical
 * hourly weather (Open-Meteo's archive — no signup, CORS-enabled for
 * direct browser fetches) for the property's location, filters to cold
 * hours in the frost-susceptible spring/autumn window (Mar-May, Sep-Nov,
 * Northern Hemisphere), and takes the circular mean of wind direction
 * over just those hours as a "prevailing cold-night wind" estimate. That
 * feeds straight into the same compass the manual control drives, so
 * nothing downstream (planPlacements) needs to know where the bearing
 * came from.
 *
 * Open-Meteo's wind_direction_10m is meteorological convention (the
 * direction the wind is blowing FROM); the compass here is "blowing
 * TOWARD" (matches placement.ts), so the estimate gets rotated 180°
 * before it's applied.
 *
 * If the fetch fails, or too few cold hours turn up nearby, this leaves
 * the compass alone and instead points at the Iowa Environmental
 * Mesonet's wind rose tool — a well-established free station-based
 * alternative — per the fallback the user asked for.
 */
const FROST_SEASON_MONTHS = new Set([3, 4, 5, 9, 10, 11]); // spring + autumn, Northern Hemisphere
const WIND_ROSE_FALLBACK_URL = "https://mesonet.agron.iastate.edu/sites/windrose.phtml";

function circularMeanBearingDeg(bearingsDeg: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const deg of bearingsDeg) {
    const rad = (deg * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum, cosSum);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The climatology's window is fixed (last CLIMATOLOGY_SEASON_COUNT spring
 * seasons, Mar 1–May 31 each), not user-picked — see the Aug 28 writeup on
 * why a free-form date range was a problem (a >31-day span silently 500s
 * against FortyGuard). This just renders which years that resolves to, so
 * the assumption stays visible instead of hidden — same "show the
 * assumptions" spirit as the savings/cost boxes below.
 */
const climatologySeasonYears = recentSpringSeasonYears(CLIMATOLOGY_SEASON_COUNT);
const climatologyRequestCount = CLIMATOLOGY_SEASON_COUNT * 3; // Mar + Apr + May per season, per property block
document.querySelector<HTMLElement>("#climatology-window-note")!.textContent =
  `Spring ${climatologySeasonYears.join(", ")} (Mar 1–May 31 each, ${CLIMATOLOGY_SEASON_COUNT} most recent seasons back to ${FORTYGUARD_NOTES.historyStart.slice(0, 4)}). ` +
  `Each cell is scored by its WORST single season, not an average — a bad spring shouldn't get diluted by two mild ones. ` +
  `That's ${climatologyRequestCount} FortyGuard requests per property block on every Analyze — worth it for real historical frequency instead of one snapshot, but not something to click repeatedly without reason.`;

const estimateWindBtn = document.querySelector<HTMLButtonElement>("#estimate-wind")!;
const windEstimateNote = document.querySelector<HTMLElement>("#wind-estimate-note")!;

estimateWindBtn.addEventListener("click", async () => {
  const boundary = currentBoundary ?? frostMap.drawnBoundary();
  const [lng, lat] = boundary
    ? (turf.centroid(boundary).geometry.coordinates as [number, number])
    : [DEMO_SITE.center.lng, DEMO_SITE.center.lat];

  const growthStage = (document.querySelector<HTMLSelectElement>(
    "#growth-stage"
  )!.value) as GrowthStage;
  const thresholdF = LT50_THRESHOLDS_F[growthStage] ?? 28;

  const originalLabel = estimateWindBtn.textContent;
  estimateWindBtn.disabled = true;
  estimateWindBtn.textContent = "Estimating…";
  windEstimateNote.textContent = "Pulling historical wind data from Open-Meteo…";

  try {
    // Archive data lags a few days behind real time; look back 2 full
    // years from a week ago so both this year's and last year's spring
    // and autumn are covered even mid-season.
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 7);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);

    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&start_date=${isoDateUTC(start)}&end_date=${isoDateUTC(end)}` +
      `&hourly=wind_direction_10m,temperature_2m&temperature_unit=fahrenheit&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo request failed (${res.status})`);
    }
    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    const dirs: (number | null)[] = data?.hourly?.wind_direction_10m ?? [];
    const temps: (number | null)[] = data?.hourly?.temperature_2m ?? [];

    const coldSeasonFromDirs: number[] = [];
    for (let i = 0; i < times.length; i++) {
      const month = Number(times[i].slice(5, 7));
      if (!FROST_SEASON_MONTHS.has(month)) continue;
      const temp = temps[i];
      const dir = dirs[i];
      if (temp == null || dir == null || temp > thresholdF) continue;
      coldSeasonFromDirs.push(dir);
    }

    if (coldSeasonFromDirs.length < 20) {
      windEstimateNote.innerHTML =
        `Only found ${coldSeasonFromDirs.length} cold spring/autumn hour(s) near this location in the last 2 years — too few to trust. ` +
        `Try the <a href="${WIND_ROSE_FALLBACK_URL}" target="_blank" rel="noopener">Iowa Environmental Mesonet wind rose tool</a> for a station-based estimate instead.`;
      return;
    }

    const fromBearing = circularMeanBearingDeg(coldSeasonFromDirs);
    const towardBearing = (fromBearing + 180) % 360;
    windCompass.setBearing(towardBearing);

    windEstimateNote.textContent =
      `Estimated from ${coldSeasonFromDirs.length} cold hours (≤ ${thresholdF}°F, spring + autumn, last 2 years) near ` +
      `${lat.toFixed(3)}, ${lng.toFixed(3)} — Open-Meteo historical weather archive. Adjust the compass by hand if this looks off.`;
  } catch (err) {
    console.warn("Prevailing wind estimate failed:", err);
    windEstimateNote.innerHTML =
      `Could not reach Open-Meteo — check the browser console, or look up prevailing winds yourself at the ` +
      `<a href="${WIND_ROSE_FALLBACK_URL}" target="_blank" rel="noopener">Iowa Environmental Mesonet wind rose tool</a>.`;
  } finally {
    estimateWindBtn.disabled = false;
    estimateWindBtn.textContent = originalLabel;
  }
});

/**
 * Click/drag/keyboard-driven compass for "prevailing cold-night wind,
 * blowing toward" — replaces a bare degree number field with something you
 * can actually point. Bearing convention matches placement.ts exactly:
 * 0 = wind blows toward true north, 90 = toward east, clockwise. Writes
 * into the existing hidden #wind-bearing input, so nothing downstream
 * (the analyze handler, planPlacements) needs to know this exists.
 */
function initWindCompass(): { setBearing: (deg: number) => void } {
  const COMPASS_POINTS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const compassPointLabel = (deg: number) =>
    COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

  const svg = document.querySelector<SVGSVGElement>("#wind-compass")!;
  const needle = document.querySelector<SVGGElement>("#compass-needle")!;
  const ticksGroup = document.querySelector<SVGGElement>("#compass-ticks")!;
  const readout = document.querySelector<HTMLElement>("#compass-readout")!;
  const hiddenInput = document.querySelector<HTMLInputElement>("#wind-bearing")!;

  const CENTER = 70;

  // 24 tick marks (every 15°), every 3rd one drawn longer/bolder as a major tick.
  const ticksSvg = Array.from({ length: 24 }, (_, i) => {
    const deg = i * 15;
    const major = deg % 90 === 0;
    const r1 = major ? 50 : 55;
    const cls = major ? "compass-tick compass-tick-major" : "compass-tick";
    return `<line x1="${CENTER}" y1="${70 - r1}" x2="${CENTER}" y2="${70 - 62}" class="${cls}" transform="rotate(${deg} ${CENTER} ${CENTER})" />`;
  }).join("");
  ticksGroup.innerHTML = ticksSvg;

  function setBearing(deg: number) {
    const normalized = ((Math.round(deg) % 360) + 360) % 360;
    needle.setAttribute("transform", `rotate(${normalized} ${CENTER} ${CENTER})`);
    readout.textContent = `${normalized}° · ${compassPointLabel(normalized)}`;
    svg.setAttribute("aria-valuenow", String(normalized));
    hiddenInput.value = String(normalized);
  }

  function bearingFromEvent(ev: PointerEvent): number {
    const rect = svg.getBoundingClientRect();
    // Map the pointer into the SVG's own 140x140 viewBox coordinate space,
    // since the rendered box (rect) can be a different CSS size.
    const scale = 140 / rect.width;
    const x = (ev.clientX - rect.left) * scale - CENTER;
    const y = (ev.clientY - rect.top) * scale - CENTER;
    // atan2(x, -y): 0 rad points up (north), increases clockwise — exactly
    // compass-bearing convention, no separate 90°-offset correction needed.
    const deg = (Math.atan2(x, -y) * 180) / Math.PI;
    return deg;
  }

  let dragging = false;
  svg.addEventListener("pointerdown", (ev) => {
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    setBearing(bearingFromEvent(ev));
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    setBearing(bearingFromEvent(ev));
  });
  const stopDragging = (ev: PointerEvent) => {
    dragging = false;
    if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
  };
  svg.addEventListener("pointerup", stopDragging);
  svg.addEventListener("pointercancel", stopDragging);

  svg.addEventListener("keydown", (ev) => {
    const current = Number(hiddenInput.value);
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
      ev.preventDefault();
      setBearing(current - 5);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
      ev.preventDefault();
      setBearing(current + 5);
    }
  });

  setBearing(Number(hiddenInput.value) || 150);

  return { setBearing };
}

const creditsBarFill = document.querySelector<HTMLElement>("#credits-bar-fill")!;
const creditsLine = document.querySelector<HTMLElement>("#credits-line")!;
const creditsDetail = document.querySelector<HTMLElement>("#credits-detail")!;

/** Pull current FortyGuard credit usage and render it in the sidebar meter. Safe to call anytime — never throws, degrades to a "not configured" or "unavailable" state instead. */
async function refreshCreditsUsage() {
  try {
    const usage = await fetchCreditsUsage();
    const pct = Math.min(100, Math.max(0, usage.cycleUsagePercentage));
    creditsBarFill.style.width = `${pct}%`;
    creditsBarFill.classList.toggle("credits-bar-fill--warn", pct >= 80);
    creditsLine.textContent =
      `${usage.cycleRemainingCredits.toLocaleString()} / ${usage.totalCredits.toLocaleString()} credits remaining` +
      ` (${pct.toFixed(2)}% used this cycle)`;
    const topActivity = usage.activityBreakdown
      .filter((a) => a.name !== "Unused Credits")
      .sort((a, b) => b.credits - a.credits)[0];
    const breakdown = topActivity
      ? ` · ${topActivity.name}: ${topActivity.credits.toLocaleString()} credits (${topActivity.count} call${topActivity.count === 1 ? "" : "s"})`
      : "";
    creditsDetail.textContent = `${usage.planType} plan · resets ${usage.creditsResetDate}${breakdown}`;
    connectionLog.setStatus("connected");
  } catch (err) {
    creditsBarFill.style.width = "0%";
    if (err instanceof FortyGuardConfigError) {
      creditsLine.textContent = "Not configured";
      creditsDetail.textContent = "Set FORTYGUARD_API_KEY in .env.local to track credit usage.";
      connectionLog.setStatus("not_configured");
    } else {
      creditsLine.textContent = "Usage unavailable";
      creditsDetail.textContent = "Could not reach FortyGuard — check the browser console.";
      console.warn("FortyGuard credits usage check failed:", err);
      connectionLog.setStatus("fallback");
    }
  }
}

refreshCreditsUsage();

/**
 * Connection badge + inspector: makes the live-vs-simulated question
 * answerable at a glance (green dot = live FortyGuard data, red = falling
 * back to simulated data, gray = not configured / not checked yet) and,
 * on click, shows the exact request/response traffic behind that verdict
 * without needing devtools. Backed by src/lib/connectionLog.ts, which
 * every fetchAndLog() call in fortyguard.ts writes into.
 */
const connectionBadge = document.querySelector<HTMLButtonElement>("#connection-badge")!;
const connectionDot = document.querySelector<HTMLElement>("#connection-dot")!;
const connectionBadgeLabel = document.querySelector<HTMLElement>("#connection-badge-label")!;
const connectionModal = document.querySelector<HTMLElement>("#connection-modal")!;
const connectionModalClose = document.querySelector<HTMLButtonElement>("#connection-modal-close")!;
const connectionModalStatus = document.querySelector<HTMLElement>("#connection-modal-status")!;
const connectionLogList = document.querySelector<HTMLElement>("#connection-log-list")!;

const CONNECTION_STATUS_LABELS: Record<connectionLog.ConnectionStatus, string> = {
  unknown: "Not checked yet",
  connected: "Connected",
  fallback: "Simulated data",
  not_configured: "Not configured",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function formatLogValue(value: unknown): string {
  if (value === undefined) return "(none)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderConnectionBadge() {
  const status = connectionLog.getStatus();
  connectionDot.className = `connection-dot connection-dot--${status}`;
  connectionBadgeLabel.textContent = CONNECTION_STATUS_LABELS[status];
}

function renderConnectionLog() {
  const entries = connectionLog.getEntries();
  connectionModalStatus.textContent =
    entries.length === 0
      ? "No FortyGuard requests yet — check credits or analyze a property to see live traffic here."
      : `${entries.length} request${entries.length === 1 ? "" : "s"} this session, most recent first.`;

  connectionLogList.innerHTML = entries
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const meta = [
        entry.method,
        entry.statusCode != null ? String(entry.statusCode) : entry.status,
        entry.durationMs != null ? `${entry.durationMs}ms` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <details class="connection-entry connection-entry--${entry.status}">
          <summary>
            <span class="connection-entry-dot"></span>
            <span class="connection-entry-label">${escapeHtml(entry.label)}</span>
            <span class="connection-entry-meta">${escapeHtml(time)} · ${escapeHtml(meta)}</span>
          </summary>
          <div class="connection-entry-body">
            <div class="connection-entry-row"><strong>Endpoint</strong><code>${escapeHtml(entry.method)} ${escapeHtml(entry.url)}</code></div>
            ${entry.errorMessage ? `<div class="connection-entry-row"><strong>Error</strong><code>${escapeHtml(entry.errorMessage)}</code></div>` : ""}
            <div class="connection-entry-row"><strong>Request body</strong><pre>${escapeHtml(formatLogValue(entry.requestBody))}</pre></div>
            <div class="connection-entry-row"><strong>Response body</strong><pre>${escapeHtml(formatLogValue(entry.responseBody))}</pre></div>
          </div>
        </details>
      `;
    })
    .join("");
}

connectionLog.subscribe(() => {
  renderConnectionBadge();
  renderConnectionLog();
});
renderConnectionBadge();
renderConnectionLog();

function openConnectionModal() {
  connectionModal.hidden = false;
}
function closeConnectionModal() {
  connectionModal.hidden = true;
}
connectionBadge.addEventListener("click", openConnectionModal);
connectionModalClose.addEventListener("click", closeConnectionModal);
connectionModal.addEventListener("click", (ev) => {
  if (ev.target === connectionModal) closeConnectionModal();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !connectionModal.hidden) closeConnectionModal();
});

/**
 * Info icons: one shared floating popover, positioned next to whichever
 * icon was clicked, filled from src/lib/parameterInfo.ts. Deliberately one
 * DOM element reused for every field instead of one popover per field —
 * keeps this generic as more fields get icons later.
 */
const infoPopover = document.querySelector<HTMLElement>("#info-popover")!;
const infoPopoverTitle = document.querySelector<HTMLElement>("#info-popover-title")!;
const infoPopoverBody = document.querySelector<HTMLElement>("#info-popover-body")!;
const infoPopoverClose = document.querySelector<HTMLButtonElement>("#info-popover-close")!;

function closeInfoPopover() {
  infoPopover.hidden = true;
  delete infoPopover.dataset.openFor;
}

function openInfoPopover(key: string, anchor: HTMLElement) {
  const info = PARAMETER_INFO[key];
  if (!info) return;
  infoPopoverTitle.textContent = info.title;
  infoPopoverBody.innerHTML = `
    <p><strong>What it does</strong><br>${info.whatItDoes}</p>
    <p><strong>Where to get it</strong><br>${info.whereToGetIt}</p>
    <p><strong>Relation to the source dissertation</strong><br>
      Y. Dai, <em>Wind Machines for Frost Damage Mitigation</em>
      (<a href="${DISSERTATION_URL}" target="_blank" rel="noopener noreferrer">TU Delft PhD dissertation, 2025 &#8599;</a>)
      &mdash; ${info.dissertationConnection}
    </p>
  `;
  infoPopover.dataset.openFor = key;
  infoPopover.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const popRect = infoPopover.getBoundingClientRect();
  const margin = 10;
  let left = rect.left;
  left = Math.min(left, window.innerWidth - popRect.width - margin);
  left = Math.max(margin, left);
  let top = rect.bottom + margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - margin);
  }
  infoPopover.style.left = `${left}px`;
  infoPopover.style.top = `${top}px`;
}

document.querySelectorAll<HTMLButtonElement>(".info-icon").forEach((btn) => {
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const key = btn.dataset.infoKey;
    if (!key) return;
    if (!infoPopover.hidden && infoPopover.dataset.openFor === key) {
      closeInfoPopover();
      return;
    }
    openInfoPopover(key, btn);
  });
});
infoPopoverClose.addEventListener("click", closeInfoPopover);
document.addEventListener("click", (ev) => {
  if (infoPopover.hidden) return;
  const target = ev.target as HTMLElement;
  if (infoPopover.contains(target) || target.closest(".info-icon")) return;
  closeInfoPopover();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !infoPopover.hidden) closeInfoPopover();
});
window.addEventListener("resize", () => {
  if (!infoPopover.hidden) closeInfoPopover();
});

const resultsSection = document.querySelector<HTMLElement>("#results")!;
const clearResultsBtn = document.querySelector<HTMLButtonElement>("#clear-results")!;
const exportPdfBtn = document.querySelector<HTMLButtonElement>("#export-pdf-btn")!;
const zeroRiskBanner = document.querySelector<HTMLElement>("#zero-risk-banner")!;
const reportMeta = document.querySelector<HTMLElement>("#report-meta")!;
const machineLocationsBox = document.querySelector<HTMLElement>("#machine-locations-box")!;
const machineLocationsList = document.querySelector<HTMLOListElement>("#machine-locations-list")!;

// PDF export: the browser's own print pipeline, styled by the @media
// print rules in style.css (hides the map/inputs, keeps only the
// results panel plus a report header) — no extra dependencies, no
// screenshot/CORS issues with the Leaflet tiles, and "Save as PDF" is a
// stock option in every modern browser's print dialog.
exportPdfBtn.addEventListener("click", () => window.print());

/** Hide the results panel and wipe the risk grid / placement markers, without touching the drawn boundary. */
function resetResults() {
  frostMap.clearAnalysisLayers();
  resultsSection.hidden = true;
  clearResultsBtn.hidden = true;
  crosscheckBox.hidden = true;
}

frostMap.onBoundaryChange((b) => {
  currentBoundary = b;
  // A changed boundary invalidates whatever was last analyzed.
  resetResults();
});

document.querySelector<HTMLButtonElement>("#load-demo")!.addEventListener(
  "click",
  () => {
    frostMap.setBoundary(DEMO_BOUNDARY_GEOJSON as unknown as Boundary);
  }
);

document.querySelector<HTMLButtonElement>("#clear-boundary")!.addEventListener(
  "click",
  () => {
    frostMap.clearBoundary();
  }
);

clearResultsBtn.addEventListener("click", resetResults);

const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze")!;
const resultsSourceNote = document.querySelector<HTMLElement>("#results-source-note")!;
const crosscheckBox = document.querySelector<HTMLElement>("#crosscheck-box")!;
const crosscheckNote = document.querySelector<HTMLElement>("#crosscheck-note")!;

analyzeBtn.addEventListener("click", async () => {
  const boundary = currentBoundary ?? frostMap.drawnBoundary();
  if (!boundary) {
    alert("Draw a property boundary first (or load the demo block).");
    return;
  }

  const growthStage = (document.querySelector<HTMLSelectElement>(
    "#growth-stage"
  )!.value) as GrowthStage;
  const windBearingDeg = Number(
    document.querySelector<HTMLInputElement>("#wind-bearing")!.value
  );
  const cropValuePerAcre = Number(
    document.querySelector<HTMLInputElement>("#crop-value")!.value
  );
  const frostNightsPerSeason = Number(
    document.querySelector<HTMLInputElement>("#frost-nights")!.value
  );
  const thresholdF = LT50_THRESHOLDS_F[growthStage] ?? 28;

  // Start every analysis from a clean slate — re-running with new
  // parameters, or after redrawing, should never leave stale grid cells
  // or machine markers behind.
  frostMap.clearAnalysisLayers();

  const originalLabel = analyzeBtn.textContent;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing…";

  let cells: RiskCell[];
  let sourceNote: string;
  try {
    // 1. Try FortyGuard's real Create Heatmap endpoint (analytic_type
    //    "exceedance", direction "below"), aggregated across the last
    //    CLIMATOLOGY_SEASON_COUNT spring seasons rather than one date
    //    window — see src/lib/fortyguard.ts's fetchClimatologyRiskCells.
    const climatology = await fetchClimatologyRiskCells({
      boundary,
      thresholdF,
      onProgress: (completed, total) => {
        analyzeBtn.textContent = `Analyzing… (${completed}/${total})`;
      },
    });
    cells = climatology.cells;
    sourceNote =
      `Live FortyGuard climatology — worst of spring seasons ${climatology.seasonsUsed.join(", ")} ` +
      `(most cells' worst season: ${climatology.dominantWorstSeasonYear}).`;
    connectionLog.setStatus("connected");
    // That request just spent credits — refresh the meter (fire-and-forget,
    // shouldn't block or fail the analysis flow if it errors).
    void refreshCreditsUsage();

    // Independent cross-check against Open-Meteo's historical reanalysis
    // (see src/lib/openMeteoCrossCheck.ts) — only runs when the live
    // FortyGuard climatology itself succeeded, since "cross-check" only
    // means something next to real FortyGuard data, not our own
    // simulated fallback. Best-effort: a failure here just hides the box,
    // it never breaks the main Analyze flow.
    try {
      const [centroidLng, centroidLat] = turf
        .centroid(boundary)
        .geometry.coordinates as [number, number];
      const crossCheck = await fetchOpenMeteoFrostCrossCheck({
        lat: centroidLat,
        lng: centroidLng,
        years: climatology.seasonsUsed,
        thresholdF,
      });
      const fgAvgWorstSeasonRisk =
        cells.reduce((sum, c) => sum + c.riskScore, 0) / cells.length;
      crosscheckBox.hidden = false;
      crosscheckNote.textContent =
        `Open-Meteo historical reanalysis, at this property's centroid (independent of FortyGuard, a single point — not per-tile): ` +
        `worst season ${crossCheck.worstSeasonYear} was ${(crossCheck.worstSeasonFraction * 100).toFixed(1)}% of spring hours below ${thresholdF}°F ` +
        `(typical season: ${(crossCheck.typicalFraction * 100).toFixed(1)}%). ` +
        `FortyGuard's own per-tile average worst-season risk across this property: ${(fgAvgWorstSeasonRisk * 100).toFixed(1)}%. ` +
        `A large gap between these two numbers is itself informative — see the info icon.`;
    } catch (crossCheckErr) {
      console.warn("Open-Meteo cross-check failed:", crossCheckErr);
      crosscheckBox.hidden = true;
    }
  } catch (err) {
    // 2. No key configured yet (expected until .env.local is set up), or
    //    the live call failed for some other reason — fall back to the
    //    simulated cold-air-drainage model so the demo never breaks.
    if (err instanceof FortyGuardConfigError) {
      connectionLog.setStatus("not_configured");
    } else {
      console.warn("FortyGuard live fetch failed, falling back to simulated data:", err);
      connectionLog.setStatus("fallback");
    }
    const cellPolygons = buildPropertyGrid(boundary);
    cells = cellPolygons.map((poly, i) => {
      const samples = generateMockSamplesForCell(poly, boundary);
      return scoreCell(`cell-${i}`, poly, samples, thresholdF);
    });
    sourceNote =
      err instanceof FortyGuardConfigError
        ? "Simulated data — no FortyGuard API key configured yet (see .env.example)."
        : "Simulated data — the live FortyGuard climatology request failed after retrying (likely a brief upstream hiccup, not a bad API key — the credits badge above checks a separate, lighter endpoint). Click Analyze again in a moment; see the connection badge for the exact error.";
  }

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = originalLabel;

  // 3. Greedy placement using the asymmetric wind-machine footprint.
  const placements = planPlacements(cells, { windBearingDeg });

  // 4. Savings, with assumptions shown, not hidden.
  const savings = estimateSavings({
    cells,
    placements,
    cropValuePerAcre,
    historicalFrostNightsPerSeason: frostNightsPerSeason,
  });

  // 5. The other half of the picture: what it costs to install and run the
  //    machines just recommended, netted against the gross crop savings.
  const installedCostPerMachine = Number(
    document.querySelector<HTMLInputElement>("#installed-cost")!.value
  );
  const fuelBurnGalPerHour = Number(
    document.querySelector<HTMLInputElement>("#fuel-burn-rate")!.value
  );
  const fuelPricePerGal = Number(
    document.querySelector<HTMLInputElement>("#fuel-price")!.value
  );
  const hoursPerFrostNight = Number(
    document.querySelector<HTMLInputElement>("#fuel-hours-per-night")!.value
  );
  const machineCost = estimateMachineCost({
    machineCount: placements.length,
    installedCostPerMachine,
    fuelBurnGalPerHour,
    fuelPricePerGal,
    hoursPerFrostNight,
    frostNightsPerSeason,
    grossAnnualSavingsLow: savings.estimatedAnnualSavingsLow,
    grossAnnualSavingsHigh: savings.estimatedAnnualSavingsHigh,
  });

  frostMap.renderRiskGrid(cells);
  frostMap.renderPlacements(placements);

  resultsSection.hidden = false;
  clearResultsBtn.hidden = false;
  resultsSourceNote.textContent = sourceNote;

  const growthStageLabel =
    document.querySelector<HTMLSelectElement>("#growth-stage")!
      .selectedOptions[0]?.textContent ?? growthStage;
  const windReadout =
    document.querySelector("#compass-readout")?.textContent ?? `${windBearingDeg}°`;
  reportMeta.textContent =
    `Growth stage: ${growthStageLabel} · Wind (blowing toward): ${windReadout} · ` +
    `Crop value: $${cropValuePerAcre.toLocaleString()}/acre · Frost nights/season: ${frostNightsPerSeason} · ` +
    `Machine: ${DEFAULT_WIND_MACHINE_PROFILE.name} ($${installedCostPerMachine.toLocaleString()}/machine) · ` +
    `Report generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`;

  zeroRiskBanner.hidden = placements.length !== 0;

  document.querySelector("#stat-machines")!.textContent = String(
    placements.length
  );
  document.querySelector("#stat-acres")!.textContent =
    `${savings.acresProtected} / ${savings.acresAnalyzed}`;
  document.querySelector("#stat-savings")!.textContent =
    `$${savings.estimatedAnnualSavingsLow.toLocaleString()} – $${savings.estimatedAnnualSavingsHigh.toLocaleString()}`;

  document.querySelector("#stat-installed-cost")!.textContent =
    `$${machineCost.totalInstalledCost.toLocaleString()}`;
  document.querySelector("#stat-fuel-cost")!.textContent =
    `$${machineCost.annualFuelCost.toLocaleString()}`;
  document.querySelector("#stat-net-savings")!.textContent =
    `$${machineCost.netAnnualSavingsLow.toLocaleString()} – $${machineCost.netAnnualSavingsHigh.toLocaleString()}`;
  document.querySelector("#stat-payback")!.textContent =
    placements.length === 0
      ? "No machines recommended"
      : machineCost.paybackYearsLow == null
      ? "Fuel cost exceeds estimated savings"
      : machineCost.paybackYearsHigh == null
        ? `${machineCost.paybackYearsLow}+ yr (worst case doesn't break even)`
        : machineCost.paybackYearsLow === machineCost.paybackYearsHigh
          ? `${machineCost.paybackYearsHigh} yr`
          : `${machineCost.paybackYearsLow} – ${machineCost.paybackYearsHigh} yr`;

  document.querySelector("#assumptions")!.innerHTML = [
    ...savings.assumptions,
    ...machineCost.assumptions,
  ]
    .map((a) => `<li>${a}</li>`)
    .join("");

  machineLocationsBox.hidden = placements.length === 0;
  machineLocationsList.innerHTML = placements
    .map((p) => {
      const lat = p.lat.toFixed(5);
      const lng = p.lng.toFixed(5);
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      return (
        `<li><strong>${p.id}</strong> &mdash; ${lat}, ${lng} ` +
        `(<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">view on map &#8599;</a>)</li>`
      );
    })
    .join("");
});
