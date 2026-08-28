// Content for the "info" popovers next to each input in the sidebar. Kept as
// plain data (not JSX/templating) so main.ts can render every popover from
// one shared DOM element instead of duplicating markup per field.
//
// Each entry answers three things the user asked for explicitly: what the
// parameter does, where to get a real value for it, and how (or whether) it
// connects to Yi Dai's TU Delft dissertation, "Wind Machines for Frost
// Damage Mitigation" (2025) — the source behind this app's placement and
// warming-effect math.

export interface ParameterInfo {
  title: string;
  whatItDoes: string;
  whereToGetIt: string;
  dissertationConnection: string;
}

export const PARAMETER_INFO: Record<string, ParameterInfo> = {
  "growth-stage": {
    title: "Growth stage",
    whatItDoes:
      "Picks the LT50 threshold — the temperature at which roughly half of that tissue is killed — used to score every hour of temperature data as \"frost risk\" or not. Grapevine cold tolerance changes fast as buds develop: a dormant bud shrugs off cold that would kill a burst bud outright.",
    whereToGetIt:
      "Walk the block, or check your vineyard manager's phenology notes for the block's current stage. Your local ag extension office publishes phenology-stage guides if you need help identifying it.",
    dissertationConnection:
      "The dissertation's field trial is built around exactly this vulnerability window — wind machines only matter economically because a single cold night during bud burst through fruit set can wipe out a season. The LT50 numbers themselves come from a separate source (Sugar et al. 2003, Oregon State), not the dissertation.",
  },
  "wind-bearing": {
    title: "Prevailing cold-night wind",
    whatItDoes:
      "The compass direction the coldest nights' wind blows TOWARD. Wind machine coverage isn't a circle — it's a long stretch downwind and a short stretch upwind — so this bearing changes where machines get placed more than almost anything else in the model.",
    whereToGetIt:
      "Click \"Estimate from historical wind data\" below the compass to pull it automatically from free historical weather data for this site, filtered to cold spring/autumn nights. The fallback link to the Iowa Environmental Mesonet's wind rose tool works too if you'd rather look it up yourself.",
    dissertationConnection:
      "Straight from the dissertation's field measurements: the study measured a strongly asymmetric coverage footprint under light background wind — 550 m downstream, 150 m upstream, 250 m cross-stream. That asymmetry is why this app doesn't just draw circles around each machine, and why getting the bearing right matters.",
  },
  "crop-value": {
    title: "Crop value ($/acre)",
    whatItDoes:
      "Dollar value of a healthy acre of this crop, used to translate \"acres protected from frost\" into an actual savings estimate.",
    whereToGetIt:
      "Your own harvest records or crop-insurance appraisal are the most accurate source. Absent that, a university extension per-acre cost-of-production budget for your varietal and region is a reasonable stand-in.",
    dissertationConnection:
      "Not from the dissertation — that study measured physical protection (temperature rise, inversion-strength reduction), not economics. This field is this app's own layer, translating the dissertation's physical results into a dollar figure.",
  },
  "frost-nights": {
    title: "Frost nights / season",
    whatItDoes:
      "How many nights per season, on average, drop below the active LT50 threshold at this site. Combined with crop value, this scales the savings estimate — more frost nights mean more nights the machines are worth having on.",
    whereToGetIt:
      "The historical FortyGuard data behind the risk map above is the most site-specific source. NOAA/NWS climate normals, or a nearby ag-weather station's frost-day summaries, are good alternatives.",
    dissertationConnection:
      "Not published in the dissertation — its field trial is a physical/engineering study of a small number of specific frost events, not a multi-year climatology. This figure is supplied by you.",
  },
  "history-window": {
    title: "Historical window (FortyGuard climatology)",
    whatItDoes:
      "Instead of scoring risk from one arbitrary date window, this app fetches FortyGuard's live exceedance data for the Mar 1–May 31 window of each of the last few spring seasons and aggregates every grid cell's exceedance hours across all of them. riskScore becomes “fraction of all spring hours, across those years, that this cell spent below threshold” — a real historical frequency, not a single snapshot. Only spring is fetched: every LT50 growth stage this app tracks (dormant through four-leaf) is a spring bud-development stage, so autumn data wouldn't change the score.",
    whereToGetIt:
      "Confirmed directly against FortyGuard's own API documentation: historical data is available from 2019-01-01 through about 12 hours ahead of the current time, and a single request is capped at roughly one month of range — which is why this needs 3 requests (Mar/Apr/May) per spring season rather than one.",
    dissertationConnection:
      "Not dissertation-sourced — this is FortyGuard's own data coverage and is unrelated to the TU Delft study.",
  },
  "wind-turbine-vs-machine": {
    title: "Why not a power-generating wind turbine?",
    whatItDoes:
      "This app only ever recommends propane-fired frost-protection wind machines, never power-generating wind turbines — on purpose. Radiation frost forms specifically on calm, clear nights, when there's too little ambient wind to spin a turbine past its cut-in speed (roughly 9 mph even for small turbines) in the first place. A frost machine actively burns fuel to force warm inversion-layer air down onto the canopy; a turbine passively extracts energy FROM wind that, on a frost night, mostly isn't there. A turbine on the same property can still be a good investment for its own sake — just not as frost protection, so this app doesn't model it as a substitute.",
    whereToGetIt:
      "FAO's frost-protection fundamentals and UC Davis's Principles of Frost Protection both describe the calm-wind/temperature-inversion mechanics behind this; small-turbine cut-in speeds are documented by turbine manufacturers and reference sources like Wikipedia's Small wind turbine article.",
    dissertationConnection:
      "The dissertation cites wind-turbine wake research only as a modeling technique (borrowing wake math to simulate the frost fan's own airflow) — it never proposes power-generating turbines as a frost-mitigation method themselves.",
  },
  "machine-profile": {
    title: "Wind machine model",
    whatItDoes:
      "Which machine's physical specs — rotor size, hub height, engine power — the coverage footprint and cost defaults below are built from.",
    whereToGetIt:
      "Manufacturer spec sheets (Orchard-Rite, Agrofrost, Cascade, and similar) publish rotor diameter, hub height, and engine size for the models they sell.",
    dissertationConnection:
      "The default profile here matches the machine used in the dissertation's field trial almost spec-for-spec: a two-blade, 6 m rotor at 10.7 m hub height, driven by a 126 kW Caterpillar C7.1 diesel engine, tilted 8° downward. That's why the 550/150/250 m footprint numbers this app uses are measured defaults, not guesses — and why other sizes are marked \"coming soon\" rather than offered with made-up footprints.",
  },
  "installed-cost": {
    title: "Installed cost ($/machine)",
    whatItDoes:
      "Upfront dollars to purchase and install one machine. Multiplied by the recommended machine count to show total capital cost and a rough payback period alongside the crop-savings estimate.",
    whereToGetIt:
      "Get quotes from wind-machine dealers/installers in your region for the most accurate number. County assessor filings and university extension cost studies are useful public benchmarks if you don't have a quote yet.",
    dissertationConnection:
      "Not in the dissertation — it's a physical/engineering study with no cost data. This default ($30,000/machine installed) comes from a Napa County Assessor filing and a UC Cooperative Extension Napa-area cost study instead.",
  },
  "fuel-runtime": {
    title: "Fuel & runtime",
    whatItDoes:
      "Fuel burn rate, price per gallon, and hours run per frost night. Combined with machine count and frost nights/season, this estimates the annual operating cost — the piece this app was missing before: a savings number with no cost to weigh it against.",
    whereToGetIt:
      "Your fuel supplier's current price and the manufacturer's fuel-consumption spec for your engine size are the most accurate inputs. The U.S. Energy Information Administration publishes a national average residential propane price if you don't have a local quote.",
    dissertationConnection:
      "Not in the dissertation. These defaults (12.5 gal/hr propane burn, 5 hrs run per frost night) come from a UC Cooperative Extension Napa-area cost study; the $/gal default comes from U.S. EIA data.",
  },
};
