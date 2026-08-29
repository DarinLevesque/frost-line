# Frost Line

A frost-mitigation planner for vineyards, built for **FortyGuard Hackathon'26**
(Track 02: Future Buildings & Energy). Draw a property boundary, get a
multi-year frost-risk map built from FortyGuard's Temperature API, get
wind-machine placement recommendations grounded in published field physics,
and see a dollar-range estimate of what that protects — plus, as of this
build, an independent second opinion on the risk numbers themselves.

**Live demo:** https://frost-line-fortyguard.vercel.app
**Demo property:** Stone Tower Winery, Leesburg, VA (Loudoun County)
**Repo:** https://github.com/DarinLevesque/frost-line

## Project summary

### The problem

Spring radiative frost is one of the costliest, least-insurable risks a
vineyard faces: a single cold, clear, still night after bud break can wipe
out most of a season's crop in hours. Wind machines are a proven mitigation
(mixing the warmer inversion layer down into the canopy), but they're
expensive — tens of thousands of dollars installed, plus fuel — and where to
put them, and whether they pencil out at all, is normally a guess based on
a grower's memory of "the cold corner of the property."

### The solution

Frost Line turns that guess into a data-driven placement plan:

1. Draw (or load) a property boundary on a map.
2. The property is gridded into cells at FortyGuard's own tile resolution.
3. FortyGuard's Temperature API supplies multi-year, per-tile cold-hour
   history for the property, scored against the grapevine growth stage
   that's actually vulnerable (bud burst, two-leaf, etc.).
4. A greedy placement algorithm recommends wind-machine locations using a
   real, published asymmetric coverage footprint (not a generic circle),
   prioritizing the highest-risk cells first.
5. The tool estimates acres protected and a dollar range of crop value at
   stake, with every assumption shown rather than hidden.

### Why frost, why wineries — a deliberately novel use of the platform

FortyGuard's Large Temperature Model is built and marketed around **heat**:
urban heat islands, heat risk for insurers, utilities, logistics, and data
centers. Nothing in FortyGuard's own product materials mentions cold, frost,
or agriculture. We chose this direction anyway, for two reasons:

- **Real, current, expensive impact.** The night of April 20–21, 2026, a
  radiative freeze hit Virginia wine country hard — Loudoun County growers
  reported lows in the mid-20s°F and 50–80%+ crop loss on vines past bud
  break (Virginia Vineyards Association, Loudoun Now, WSET, CBS19; see
  Sources below). Agriculture is exactly the kind of underserved, high-stakes
  use case a general-purpose temperature model should be able to serve if it
  generalizes beyond its original design target — and frost is the sharpest
  possible test of whether it does.
- **A genuine platform stress-test, not just a new UI on the same use case.**
  Heat risk and cold risk are different physics (radiative inversion vs.
  convective heat buildup) at a different, harder resolution (a single bad
  night, not a seasonal average). Building for frost meant actually
  exercising FortyGuard's temperature data at the edge of what it was likely
  tuned for — which is exactly what turned up the finding below.

### What we found — and how the product responds to it

Querying FortyGuard directly for the April 20–21, 2026 freeze at two
independent Loudoun County sites returned coldest readings roughly 15–20°F
**warmer** than the well-documented ground conditions that night (see
[Known limitations](#known-limitations)). Rather than quietly shipping
numbers we didn't trust, or abandoning the idea, we did three things:

1. **Cross-checked against a second, independent data source** (Open-Meteo /
   ERA5 reanalysis) for the same site and years, using the same
   worst-season-not-averaged scoring — see `src/lib/openMeteoCrossCheck.ts`.
   The two sources land close to each other (within ~0.1–0.3 percentage
   points on this property), which is itself informative: it suggests this
   may be a broader challenge for gridded/reanalysis temperature products at
   hyper-local, fast-moving radiative frost, not a bug unique to FortyGuard.
2. **Built that cross-check into the live UI**, not as a footnote — every
   live analysis shows FortyGuard's own worst-season risk right next to the
   independent Open-Meteo estimate for the same property, framed as a
   transparency feature rather than a claim that either source is "ground
   truth."
3. **Made the placement algorithm robust to the gap.** An earlier version
   used a fixed absolute risk threshold (stop recommending machines once
   risk drops below 5%) tuned around expectations from heat-domain risk
   scores. Once real frost data came in running under 2%, that fixed
   threshold silently recommended **zero machines everywhere** — a
   product-breaking bug that would have surfaced live, on camera, during the
   hackathon demo. We caught it in testing and replaced it with a
   *relative* floor (`src/lib/placement.ts`): stop once a cell's risk drops
   below 40% of the highest-risk cell on that same property. This ranks
   cells against each other instead of against a hardcoded absolute number,
   so the recommendation logic keeps working regardless of the overall
   magnitude FortyGuard (or any future-corrected version of it) reports.

### Impact, if the underlying numbers get closer to ground truth

Even with today's conservative risk fractions, the live demo on a real
111-acre Loudoun County vineyard recommends a full placement plan (10
machines, 100% of analyzed acreage covered) with an estimated
$28,900–$48,200/year in protected crop value against roughly $300,000 in
installed machine cost — a project a grower could actually take to a bank.
If FortyGuard's model is retuned or recalibrated for sub-freezing radiative
events (a training-data/parameter question, not an architecture one — see
below), the same pipeline gets more accurate without any change to this
application.

## How it works

1. **Boundary** — draw a polygon on the map (Leaflet + Leaflet.draw), or
   load the demo property at Stone Tower Winery. (`src/components/map.ts`)
2. **Grid** — the property is gridded into cells via Turf's `squareGrid`,
   matched to FortyGuard's tile resolution (60/80/100 m options).
   (`src/lib/grid.ts`)
3. **Risk scoring** — `fetchClimatologyRiskCells()` pulls FortyGuard's
   `exceedance`/`below`-threshold data for the 3 most recent spring seasons
   (Mar 1–May 31) per cell, and scores each cell by its **worst single
   season's** fraction of below-threshold hours — not a multi-year average,
   which would dilute one devastating spring across two mild ones.
   (`src/lib/fortyguard.ts`)
4. **Placement** — a greedy set-cover algorithm repeatedly places a wind
   machine at the highest-risk uncovered cell, using a real asymmetric
   coverage footprint (stretched downwind per measured field data), stopping
   at a relative risk floor or a machine cap. (`src/lib/placement.ts`)
5. **Savings** — acres protected × frost nights/season × crop value/acre ×
   a measured 30–50% inversion-strength reduction range, all editable in
   the UI. (`src/lib/savings.ts`, `src/lib/machineCost.ts`)
6. **Cross-check** — an independent Open-Meteo historical estimate for the
   same property/years, shown alongside FortyGuard's own number.
   (`src/lib/openMeteoCrossCheck.ts`)

## FortyGuard API usage

- **Auth:** header `api-key: <key>` on every request (not OAuth/Bearer).
  Proxied server-side via Vercel functions (`api/fortyguard/*.ts`) so the
  key never reaches the browser.
- **Task model:** `POST https://api.fortyguard.com/v1/heatmap` returns
  `{ data: { activity_id } }` immediately; poll
  `GET /v1/status/{activity_id}` until `status` is `Completed` (credits are
  only deducted on completion) or `Failed`.
- **Analytic type used:** `exceedance`, `direction: "below"` — FortyGuard's
  own model counts hours below our threshold per tile, so the app doesn't
  re-derive risk from raw temperature samples. `threshold` is set per
  grapevine growth stage (see LT50 table below).
- **Request shape:** `filter_type: 4` (date range), capped at 1 month per
  request by the API, so a full Mar–May season is fetched as 3 monthly
  calls per year × 3 years = 9 requests per full property analysis.
- **Response shape:** `{ result: { map_data, stats_data } }` where
  `map_data` is a GeoJSON FeatureCollection of tiles, each
  `properties: { tile_id, value }`. `tile_id` is stable across separate
  requests, used as the join key when aggregating seasons.
- **Credits:** `POST /v1/system/fetch-api-key-usage` — hackathon plan is
  2,000,000 credits (Aug 19–Sep 23, 2026 cycle); a full 9-request property
  analysis costs roughly 38,000 credits (~1.9% of the cycle).
- **Live status badge:** the app's sidebar shows real-time connection
  status and remaining credits, reading directly from this endpoint.

## The science

Placement footprint and warming numbers come from Yi Dai, *Wind Machines for
Frost Damage Mitigation* (TU Delft PhD dissertation, 2025;
DOI: [10.4233/uuid:7000b291-671c-4ab3-86fa-beeff39bf5df](https://doi.org/10.4233/uuid:7000b291-671c-4ab3-86fa-beeff39bf5df),
full text via the TU Delft Repository):

- +3 K average in-canopy warming within 40 minutes of startup
- 30–50% reduction in inversion strength (30% over 2.66 ha, 50% over 0.45 ha)
- Asymmetric footprint under light wind: ~550 m downstream, ~150 m upstream,
  ~250 m cross-stream each side
- Real-world density benchmark: ~1 machine per 29 acres (Quincy vineyard, 60
  machines / 700 ha)

Grapevine frost thresholds (LT50, Sugar et al. 2003) used as the risk
threshold per growth stage: green swollen bud 26°F, bud burst 28°F,
two-leaf 29°F, four-leaf 30°F. (`src/lib/constants.ts`)

Power-generating wind turbines are explicitly *not* the same tool — see the
in-app "Why not a power-generating turbine?" explainer (calm-night physics:
radiative frost happens in still air, well below a turbine's ~9 mph cut-in
speed).

## Known limitations

- **FortyGuard's cold-temperature numbers appear to sit outside the model's
  tuned operating envelope.** Querying FortyGuard directly for the night of
  the documented April 20–21, 2026 Virginia freeze at two independent sites
  (Stone Tower Winery and Doukenie Winery, Hillsboro VA) returned coldest
  readings of 30.1°F and 31.0°F — roughly 15–20°F warmer than the mid-20s to
  10°F lows growers and news coverage reported on the ground that night. All
  42 tiles at the second site returned the *identical* reading (zero spatial
  variance), suggesting the sub-freezing/short-duration end of the range may
  be an under-tuned training parameter for FortyGuard's Large Temperature
  Model rather than a data bug — consistent with FortyGuard's own product
  pages, which are entirely heat-focused with no mention of cold or
  agriculture. An independent source (Open-Meteo/ERA5 reanalysis) shows the
  same low numbers for the same site and night, which argues this may be a
  harder problem for gridded/regional temperature products generally at this
  scale, not something specific to FortyGuard.
- **Placement uses a relative, not absolute, risk floor** (see above) as a
  direct, shipped response to this finding — the tool keeps recommending a
  sensible plan today, and gets more accurate automatically if FortyGuard's
  absolute numbers are refined.
- **Wind direction is a manual/estimated input.** The app offers a one-click
  "estimate from historical wind data" (Open-Meteo), but a grower should
  confirm it against local knowledge — FortyGuard's own payload does not
  currently include prevailing wind.
- **No terrain/elevation layer.** Cold-air drainage (frost pooling in low
  ground) isn't modeled; a real DEM (USGS 3DEP) would improve placement
  accuracy on properties with meaningful slope.
- **Greedy placement, not an exact solver.** Explainable and fast; revisit
  only if there's a measurable accuracy gain worth the complexity.
- **Single default machine profile** (Orchard-Rite 2600-class). Other sizes
  are stubbed in the UI but not yet wired up.

## Quickstart

```bash
npm install
npm run dev
```

Open the printed localhost URL, click **Load demo block**, then **Analyze
property**. Plain `npm run dev` (Vite only) can't run the `/api` proxy
routes, so it falls back to simulated data automatically — use
`vercel dev` (see below) to exercise the real FortyGuard connection locally.

## Deploying

```bash
npm i -g vercel
vercel                                 # first deploy, follow prompts
vercel env add FORTYGUARD_API_KEY      # paste the real key (Production)
vercel dev                             # local dev WITH the /api proxy live
npm run build && vercel --prod         # production deploy
```

## Sources (April 2026 Virginia frost event)

- [Virginia Vineyards Association — President's Corner, April 21, 2026](https://virginiavineyardsassociation.org/presidents-corner-april-21-2026-frost/)
- [Loudoun Now — "Budding wine crop hard hit by freeze"](https://www.loudounnow.com/news/budding-wine-crop-hard-hit-by-freeze/article_55ed9752-abb2-4e30-90e5-ad5db2cabc26.html)
- [CBS19 — "VWA: late-April frost caused substantial damage"](https://www.cbs19news.com/news/vwa-late-april-frost-caused-substantial-damage/article_16d72cd6-5d77-4b76-bdbb-3e081767a80b.html)
- [WSET — "Late spring freeze devastates Virginia vineyards"](https://wset.com/news/local/late-spring-freeze-devastates-virginia-vineyards-threatening-2026-grape-harvest)
- [Northern Virginia Magazine — "NoVA wineries hit hard by spring frost"](https://northernvirginiamag.com/food-and-drink/2026/04/28/northern-virginia-wineries-hit-hard-by-spring-frost/)
- [Blue Ridge Life — "Area vineyard owners assessing damage"](https://blueridgelife.com/2026/04/22/area-vineyard-owners-assessing-damage-from-recent-freeze/)

## Submission checklist

- [x] Public GitHub repo — https://github.com/DarinLevesque/frost-line
- [x] `fortyguard` invited as repo collaborator (pending acceptance) +
      `Hackathon-FG` also invited
- [x] Live demo — https://frost-line-fortyguard.vercel.app
- [x] Written project summary (this README, "Project summary" above)
- [x] FortyGuard API usage documentation (this README, "FortyGuard API
      usage" above)
- [ ] 2–5 min video walkthrough
- [ ] Submit via the Google Form before 30 Aug 2026, 11:59 PM GST
      (3:59 PM ET) — no late submissions
