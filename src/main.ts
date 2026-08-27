import "./style.css";
import { initFrostMap, type Boundary } from "./components/map";
import { buildPropertyGrid, scoreCell } from "./lib/grid";
import { generateMockSamplesForCell } from "./lib/mockData";
import { fetchLiveRiskCells, fetchCreditsUsage, FortyGuardConfigError } from "./lib/fortyguard";
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
        <h2>FortyGuard API credits</h2>
        <div class="credits-bar"><div class="credits-bar-fill" id="credits-bar-fill"></div></div>
        <p class="credits-line" id="credits-line">Checking usage…</p>
        <p class="hint" id="credits-detail"></p>
      </section>

      <section class="panel-section">
        <h2>1. Property boundary</h2>
        <p class="hint">Draw one or more polygons — separate blocks are fine, they're combined automatically into one property when you analyze. Or load the demo block near Caymus Vineyards to start.</p>
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
          Prevailing cold-night wind (° blowing toward)
          <input id="wind-bearing" type="number" min="0" max="359" value="150" />
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
`;

const frostMap = initFrostMap("map");
let currentBoundary: Boundary | null = null;

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
  } catch (err) {
    creditsBarFill.style.width = "0%";
    if (err instanceof FortyGuardConfigError) {
      creditsLine.textContent = "Not configured";
      creditsDetail.textContent = "Set FORTYGUARD_API_KEY in .env.local to track credit usage.";
    } else {
      creditsLine.textContent = "Usage unavailable";
      creditsDetail.textContent = "Could not reach FortyGuard — check the browser console.";
      console.warn("FortyGuard credits usage check failed:", err);
    }
  }
}

refreshCreditsUsage();

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
    // That request just spent credits — refresh the meter (fire-and-forget,
    // shouldn't block or fail the analysis flow if it errors).
    void refreshCreditsUsage();
  } catch (err) {
    // 2. No key configured yet (expected until .env.local is set up), or
    //    the live call failed for some other reason — fall back to the
    //    simulated cold-air-drainage model so the demo never breaks.
    if (!(err instanceof FortyGuardConfigError)) {
      console.warn("FortyGuard live fetch failed, falling back to simulated data:", err);
    }
    const cellPolygons = buildPropertyGrid(boundary);
    cells = cellPolygons.map((poly, i) => {
      const samples = generateMockSamplesForCell(poly, boundary);
      return scoreCell(`cell-${i}`, poly, samples, thresholdF);
    });
    sourceNote =
      err instanceof FortyGuardConfigError
        ? "Simulated data — no FortyGuard API key configured yet (see .env.example)."
        : "Simulated data — the live FortyGuard request failed; check the browser console.";
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
