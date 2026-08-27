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
    title: "Historical window (FortyGuard data)",
    whatItDoes:
      "The date range FortyGuard's live API is queried over when scoring frost risk, cell by cell, across the property.",
    whereToGetIt:
      "Confirmed directly against FortyGuard's own API documentation: historical data is available from 2019-01-01 through about 12 hours ahead of the current time. A single request is capped at roughly one month of range, so this defaults to one representative recent frost-season month — pick any other ≤1-month window back to 2019 if you want a different season.",
    dissertationConnection:
      "Not dissertation-sourced — this is FortyGuard's own data coverage and is unrelated to the TU Delft study.",
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
