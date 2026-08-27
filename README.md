# Frost Line

A property-scale frost mitigation planner built for **FortyGuard Hackathon'26**
(Track 02: Future Buildings & Energy). Draw a vineyard boundary, get a
frost-risk map built from FortyGuard's hyperlocal temperature history,
get wind-machine placements recommended using real published field physics,
and see an estimated dollar range for what that protects.

Demo property: **Caymus Vineyards**, Rutherford, Napa Valley, CA.

## Status

Solo build for the Aug 18–30, 2026 hackathon sprint. Full plan, day-by-day
schedule, and the reasoning behind every architectural choice below live at:
**https://claude.ai/code/artifact/43682455-ffba-4b0f-a243-098689c64c55**

This scaffold runs end-to-end right now on **simulated** temperature data —
see [Wiring up the real API](#wiring-up-the-real-api) for what's left.

## Quickstart

```bash
npm install
npm run dev
```

Open the printed localhost URL, click **Load demo block**, then **Analyze
property**. You should see a colored risk grid, one or more recommended
wind-machine markers with their coverage footprints, and a savings estimate
in the left panel.

## How it works

1. **Boundary** — draw a polygon on the map (Leaflet + Leaflet.draw), or load
   the placeholder demo block near Caymus Vineyards. (`src/components/map.ts`)
2. **Grid** — the property is gridded into ~20 m cells via Turf's
   `squareGrid`, matched to FortyGuard's own data resolution.
   (`src/lib/grid.ts`)
3. **Risk scoring** — each cell gets historical hourly samples (currently
   simulated, see below) and a risk score = fraction of nights that dropped
   at/below the active LT50 frost threshold for the selected grapevine growth
   stage. (`src/lib/mockData.ts`, `src/lib/constants.ts`)
4. **Placement** — a greedy algorithm repeatedly places a wind machine at the
   highest-risk uncovered cell, using an **asymmetric** coverage footprint
   (stretched downwind, per real measured field data — not a circle) until a
   risk floor or machine budget is hit. (`src/lib/placement.ts`)
5. **Savings** — acres protected × frost nights/season × crop value/acre ×
   the measured inversion-strength reduction range (30–50%), with every
   assumption shown in the UI rather than hidden. (`src/lib/savings.ts`)

## The science

The placement footprint and warming numbers come from Yi Dai, *Wind Machines
for Frost Damage Mitigation* (TU Delft PhD dissertation, 2025) — see
`Resources/` in the project folder. Measured, not assumed:

- +3 K average in-canopy warming within 40 minutes of startup
- 30–50% reduction in inversion strength (30% over 2.66 ha, 50% over 0.45 ha)
- Asymmetric footprint under light wind: ~550 m downstream, ~150 m upstream,
  ~250 m cross-stream each side
- Real-world density benchmark: ~1 machine per 29 acres (Quincy vineyard, 60
  machines / 700 ha)

Grapevine frost thresholds (LT50, Sugar et al. 2003, Pinot noir) are in
`src/lib/constants.ts` — swap in variety-specific values if better data
turns up.

## Wiring up the real API

This is the main thing left to do. `docs-api.fortyguard.com` wouldn't render
during planning, so the real historical-data endpoint shape is still
unconfirmed. To wire it in:

1. Register for the hackathon (if not already) and get the API key by email.
2. Run the FortyGuard **Temperature API Quickstart** (a runnable Python
   sandbox) to see the real request/response shapes.
3. Copy `.env.example` to `.env.local` and set `FORTYGUARD_API_KEY`.
4. Update `api/fortyguard/historical.ts` — the request body sent to
   FortyGuard and the response mapping are both marked `TODO` with the one
   sample shape that *was* confirmed (a single current reading via
   `POST /v1/heat-intelligence`).
5. Update `src/lib/fortyguard.ts`'s response mapping to match.
6. In `src/main.ts`, swap `generateMockSamplesForCell()` for
   `fetchHistoricalTemperatures()`.
7. Run `vercel dev` instead of `npm run dev` so the `/api` routes actually
   execute locally (plain Vite doesn't run them).

## Deploying

```bash
npm i -g vercel   # if not already installed
vercel             # first deploy, follow prompts
vercel env add FORTYGUARD_API_KEY   # paste the real key
vercel --prod
```

## Submission checklist

- [ ] Public GitHub repo
- [ ] Add `fortyguard` as a repo collaborator
- [ ] Live demo link (Vercel URL above)
- [ ] Submit before ~Saturday night — the deadline is 30 Aug 2026 (GST),
      **no late submissions**; confirm the exact cutoff time from the
      registration email.

## Known gaps (by design, for a 4-day build)

- Wind direction is a manual input, not pulled from data — confirm whether
  FortyGuard's payload includes it; if not, NOAA/Open-Meteo historical is the
  fallback.
- No terrain/elevation layer yet — cold-air drainage is only crudely
  approximated in the mock data generator. A real DEM (USGS 3DEP or
  Open-Elevation) should replace this.
- The demo boundary is an approximate placeholder, not a surveyed parcel —
  redraw it over the satellite layer for something closer to the real block.
- Greedy placement, not an exact solver — revisit only if there's real time
  left after the demo is solid.
