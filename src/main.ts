import "./style.css";
import { initFrostMap, type Boundary } from "./components/map";
import { buildPropertyGrid, scoreCell } from "./lib/grid";
import { generateMockSamplesForCell } from "./lib/mockData";
import { fetchLiveRiskCells, fetchCreditsUsage, FortyGuardConfigError } from "./lib/fortyguard";
import * as connectionLog from "./lib/connectionLog";
import { planPlacements } from "./lib/placement";
import { estimateSavings } from "./lib/savings";
import {
  DEMO_BOUNDARY_GEOJSON,
  DEMO_SITE,
  LT50_THRESHOLDS_F,
} from "./lib/constants";
import type { GrowthStage, RiskCell } from "./lib/types";

/** Default historical window: last spring's frost season, a plausible demo range that's always in the past. Kept to <= 1 month per FortyGuard's range-of-days cap. */
function defaultFrostSeasonRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { start: `${year}-04-01`, end: `${year}-04-30` };
}

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
          Growth stage
          <select id="growth-stage">
            <option value="greenSwollenBud">Green swollen bud (26°F)</option>
            <option value="budBurst" selected>Bud burst (28°F)</option>
            <option value="twoLeaf">Two-leaf (29°F)</option>
            <option value="fourLeaf">Four-leaf (30°F)</option>
          </select>
        </label>
        <label class="field">
          Prevailing cold-night wind (blowing toward)
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
              <text x="70" y="15" class="compass-label" text-anchor="middle">N</text>
              <text x="125" y="74" class="compass-label" text-anchor="middle">E</text>
              <text x="70" y="133" class="compass-label" text-anchor="middle">S</text>
              <text x="15" y="74" class="compass-label" text-anchor="middle">W</text>
              <g id="compass-needle">
                <line x1="70" y1="70" x2="70" y2="22" class="compass-needle-line" />
                <polygon points="70,13 64,26 76,26" class="compass-needle-head" />
              </g>
              <circle cx="70" cy="70" r="4" class="compass-hub" />
            </svg>
            <div class="compass-readout" id="compass-readout">150° · SSE</div>
          </div>
          <input id="wind-bearing" type="hidden" value="150" />
        </label>
        <label class="field">
          Crop value ($/acre)
          <input id="crop-value" type="number" min="0" step="500" value="35000" />
        </label>
        <label class="field">
          Frost nights / season (for savings estimate)
          <input id="frost-nights" type="number" min="0" max="365" value="10" />
        </label>
        <label class="field">
          Historical window start (FortyGuard data, ≤ 1 month)
          <input id="history-start" type="date" value="${defaultFrostSeasonRange().start}" />
        </label>
        <label class="field">
          Historical window end
          <input id="history-end" type="date" value="${defaultFrostSeasonRange().end}" />
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
        <h2>Results</h2>
        <p class="hint data-note" id="results-source-note"></p>
        <div class="stat-row">
          <div class="stat"><strong id="stat-machines">–</strong><span>machines recommended</span></div>
          <div class="stat"><strong id="stat-acres">–</strong><span>acres protected / analyzed</span></div>
        </div>
        <div class="savings-box">
          <div class="savings-label">Estimated annual savings</div>
          <div class="savings-value" id="stat-savings">–</div>
        </div>
        <ul class="assumptions" id="assumptions"></ul>
      </section>
    </aside>
    <main id="map"></main>
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

initWindCompass();

/**
 * Click/drag/keyboard-driven compass for "prevailing cold-night wind,
 * blowing toward" — replaces a bare degree number field with something you
 * can actually point. Bearing convention matches placement.ts exactly:
 * 0 = wind blows toward true north, 90 = toward east, clockwise. Writes
 * into the existing hidden #wind-bearing input, so nothing downstream
 * (the analyze handler, planPlacements) needs to know this exists.
 */
function initWindCompass() {
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

const resultsSection = document.querySelector<HTMLElement>("#results")!;
const clearResultsBtn = document.querySelector<HTMLButtonElement>("#clear-results")!;

/** Hide the results panel and wipe the risk grid / placement markers, without touching the drawn boundary. */
function resetResults() {
  frostMap.clearAnalysisLayers();
  resultsSection.hidden = true;
  clearResultsBtn.hidden = true;
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
  const historyStart = document.querySelector<HTMLInputElement>("#history-start")!.value;
  const historyEnd = document.querySelector<HTMLInputElement>("#history-end")!.value;
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
    //    "exceedance", direction "below") — one request per polygon in the
    //    boundary, polled to completion. See src/lib/fortyguard.ts.
    cells = await fetchLiveRiskCells({
      boundary,
      thresholdF,
      startDate: historyStart,
      endDate: historyEnd,
    });
    sourceNote = `Live FortyGuard data, ${historyStart} to ${historyEnd}.`;
    connectionLog.setStatus("connected");
    // That request just spent credits — refresh the meter (fire-and-forget,
    // shouldn't block or fail the analysis flow if it errors).
    void refreshCreditsUsage();
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
        : "Simulated data — the live FortyGuard request failed; check the browser console (or the connection badge above) for details.";
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

  frostMap.renderRiskGrid(cells);
  frostMap.renderPlacements(placements);

  resultsSection.hidden = false;
  clearResultsBtn.hidden = false;
  resultsSourceNote.textContent = sourceNote;
  document.querySelector("#stat-machines")!.textContent = String(
    placements.length
  );
  document.querySelector("#stat-acres")!.textContent =
    `${savings.acresProtected} / ${savings.acresAnalyzed}`;
  document.querySelector("#stat-savings")!.textContent =
    `$${savings.estimatedAnnualSavingsLow.toLocaleString()} – $${savings.estimatedAnnualSavingsHigh.toLocaleString()}`;
  document.querySelector("#assumptions")!.innerHTML = savings.assumptions
    .map((a) => `<li>${a}</li>`)
    .join("");
});
