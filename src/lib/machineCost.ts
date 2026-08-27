// Wind machine identity and cost modeling. Kept separate from savings.ts on
// purpose: savings.ts is gross crop-value math straight from the
// dissertation's measured warming effect, while this file is equipment
// economics (installed cost, fuel) sourced separately from real-world cost
// studies — mixing the two would blur which numbers come from where.

export interface WindMachineProfile {
  id: string;
  /** Shown in the <select>; the default is the only one currently selectable. */
  name: string;
  specSummary: string;
  comingSoon: boolean;
}

/**
 * The default (and, for now, only selectable) profile. Specs match the
 * machine used in Yi Dai's TU Delft dissertation, "Wind Machines for Frost
 * Damage Mitigation" (2025) almost exactly — Orchard-Rite manufacturer,
 * 6 m two-straight-blade rotor, 10.7 m hub height, 126 kW Caterpillar C7.1
 * diesel engine, 8° downward rotor tilt, ~5-minute rotation period. These
 * specs line up closely with Orchard-Rite's commercially sold Model 2600,
 * though the dissertation itself doesn't name a model number.
 */
export const DEFAULT_WIND_MACHINE_PROFILE: WindMachineProfile = {
  id: "orchard-rite-2600-class",
  name: "Orchard-Rite 2600-class (default)",
  specSummary:
    "6 m two-blade rotor · 10.7 m hub height · 126 kW Caterpillar C7.1 diesel · 8° downward tilt · ~5 min rotation period",
  comingSoon: false,
};

/**
 * Placeholder future profiles — deliberately unselectable (rendered as
 * disabled <option>s). Showing the shape of what's coming, rather than
 * hiding it, was an explicit ask: it signals scope without overclaiming
 * footprint numbers this app hasn't measured yet.
 */
export const COMING_SOON_WIND_MACHINE_PROFILES: WindMachineProfile[] = [
  {
    id: "compact-orchard",
    name: "Compact / low-tower (coming soon)",
    specSummary: "Smaller rotor, shorter tower — tighter coverage footprint, lower cost.",
    comingSoon: true,
  },
  {
    id: "large-tower",
    name: "Large tower / high-output (coming soon)",
    specSummary: "Larger rotor, taller tower — wider coverage footprint, higher cost.",
    comingSoon: true,
  },
  {
    id: "tow-behind",
    name: "Tow-behind / portable (coming soon)",
    specSummary: "Trailer-mounted, relocatable between blocks — different footprint and duty cycle.",
    comingSoon: true,
  },
];

export interface MachineCostInputs {
  machineCount: number;
  installedCostPerMachine: number;
  fuelBurnGalPerHour: number;
  fuelPricePerGal: number;
  hoursPerFrostNight: number;
  frostNightsPerSeason: number;
  /** From estimateSavings() — gross crop-value savings, before subtracting operating cost. */
  grossAnnualSavingsLow: number;
  grossAnnualSavingsHigh: number;
}

export interface MachineCostEstimate {
  totalInstalledCost: number;
  annualFuelCost: number;
  netAnnualSavingsLow: number;
  netAnnualSavingsHigh: number;
  /** Years to recover the installed cost from net savings; null when net savings isn't positive (no payback). */
  paybackYearsLow: number | null;
  paybackYearsHigh: number | null;
  assumptions: string[];
}

/**
 * The other half of the picture: what it costs to install and run the
 * machines the placement algorithm just recommended, netted against the
 * gross crop-savings estimate from savings.ts.
 */
export function estimateMachineCost(inputs: MachineCostInputs): MachineCostEstimate {
  const {
    machineCount,
    installedCostPerMachine,
    fuelBurnGalPerHour,
    fuelPricePerGal,
    hoursPerFrostNight,
    frostNightsPerSeason,
    grossAnnualSavingsLow,
    grossAnnualSavingsHigh,
  } = inputs;

  const totalInstalledCost = machineCount * installedCostPerMachine;
  const annualFuelCost =
    machineCount * fuelBurnGalPerHour * fuelPricePerGal * hoursPerFrostNight * frostNightsPerSeason;

  const netAnnualSavingsLow = grossAnnualSavingsLow - annualFuelCost;
  const netAnnualSavingsHigh = grossAnnualSavingsHigh - annualFuelCost;

  const paybackYearsLow =
    netAnnualSavingsHigh > 0 ? Math.round((totalInstalledCost / netAnnualSavingsHigh) * 10) / 10 : null;
  const paybackYearsHigh =
    netAnnualSavingsLow > 0 ? Math.round((totalInstalledCost / netAnnualSavingsLow) * 10) / 10 : null;

  return {
    totalInstalledCost: Math.round(totalInstalledCost),
    annualFuelCost: Math.round(annualFuelCost),
    netAnnualSavingsLow: Math.round(netAnnualSavingsLow),
    netAnnualSavingsHigh: Math.round(netAnnualSavingsHigh),
    paybackYearsLow,
    paybackYearsHigh,
    assumptions: [
      `${machineCount} machine${machineCount === 1 ? "" : "s"} at $${installedCostPerMachine.toLocaleString()}/machine installed = $${Math.round(totalInstalledCost).toLocaleString()} total capital cost (Napa County Assessor / UC Cooperative Extension cost study).`,
      `Fuel: ${fuelBurnGalPerHour} gal/hr × ${hoursPerFrostNight} hrs/night × ${frostNightsPerSeason} nights/season × $${fuelPricePerGal.toFixed(2)}/gal × ${machineCount} machine${machineCount === 1 ? "" : "s"} ≈ $${Math.round(annualFuelCost).toLocaleString()}/season in fuel.`,
      `Net savings and payback are the crop-savings estimate above minus this fuel cost — maintenance, financing, and insurance aren't included.`,
    ],
  };
}
