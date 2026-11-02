// LANE RATES (Owner, 2026-10-31): learn what carriers accepted per mile on a corridor.
// Every booked job is a sample: carrier pay (COD + money sent to the carrier) / miles.
// Corridors are bucketed by ZIP, not raw miles: Miami / Ft Lauderdale / Palm Beach all share
// "South FL"; Key West is its own "FL Keys" bucket; West Coast metros are separate.
// Lookup ladder: metro -> metro, then state -> state, then region -> region. The most specific
// level with at least one sample wins, so it starts useful with a tiny pool and sharpens itself
// as more jobs book. No extra table: it is computed from booked estimates every time.

type Range = [number, number];
const zip3 = (zip: string | null | undefined): number | null => {
  const m = String(zip ?? "").match(/^\s*(\d{5})/);
  return m ? Number(m[1].slice(0, 3)) : null;
};

// Florida Keys (Monroe County) ZIP5s: Key Largo .. Key West. Different market than South FL.
const KEYS_ZIP5 = new Set(["33001", "33036", "33037", "33040", "33041", "33042", "33043", "33044", "33045", "33050", "33051", "33052", "33070"]);

const METROS: { key: string; label: string; ranges: Range[] }[] = [
  { key: "SOFL", label: "South FL", ranges: [[330, 334]] },
  { key: "ORL", label: "Orlando", ranges: [[327, 328], [347, 347]] },
  { key: "TPA", label: "Tampa Bay", ranges: [[335, 338], [346, 346]] },
  { key: "JAX", label: "Jacksonville", ranges: [[320, 320], [322, 322]] },
  { key: "NYC", label: "NY metro", ranges: [[100, 119], [70, 76]] },
  { key: "BOS", label: "Boston", ranges: [[18, 24]] },
  { key: "PHL", label: "Philadelphia", ranges: [[189, 191], [80, 81]] },
  { key: "DC", label: "DC metro", ranges: [[200, 209], [220, 223]] },
  { key: "ATL", label: "Atlanta", ranges: [[300, 303]] },
  { key: "CHI", label: "Chicago", ranges: [[600, 608]] },
  { key: "DFW", label: "Dallas", ranges: [[750, 753], [760, 761]] },
  { key: "HOU", label: "Houston", ranges: [[770, 775]] },
  { key: "DEN", label: "Denver", ranges: [[800, 803]] },
  { key: "PHX", label: "Phoenix", ranges: [[850, 853]] },
  { key: "LAS", label: "Las Vegas", ranges: [[889, 891]] },
  { key: "LA", label: "LA / SoCal", ranges: [[900, 918], [925, 928]] },
  { key: "SD", label: "San Diego", ranges: [[919, 921]] },
  { key: "SFB", label: "SF Bay", ranges: [[940, 951]] },
  { key: "SEA", label: "Seattle", ranges: [[980, 984]] },
];

const STATES: [number, number, string][] = [
  [5, 5, "NY"], [6, 9, "PR"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"],
  [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"],
  [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"],
  [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

const REGIONS: Record<string, string[]> = {
  "Northeast": ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA"],
  "Mid-Atlantic": ["DE", "MD", "DC", "VA", "WV"],
  "Southeast": ["NC", "SC", "GA", "AL", "TN", "MS", "KY"],
  "Florida": ["FL"],
  "Midwest": ["OH", "IN", "MI", "IL", "WI", "MN", "IA", "MO", "KS", "NE", "SD", "ND"],
  "South Central": ["TX", "OK", "LA", "AR"],
  "Mountain": ["CO", "WY", "MT", "ID", "UT", "NM"],
  "West Coast": ["CA", "OR", "WA", "NV", "AZ"],
  "Non-contiguous": ["AK", "HI", "PR"],
};

export type Place = { metro: string | null; metroLabel: string | null; state: string | null; region: string | null };

export function placeFor(zip: string | null | undefined): Place {
  const z5 = String(zip ?? "").trim().slice(0, 5);
  const z = zip3(zip);
  if (z === null) return { metro: null, metroLabel: null, state: null, region: null };
  const state = STATES.find(([a, b]) => z >= a && z <= b)?.[2] ?? null;
  const region = state ? Object.keys(REGIONS).find(r => REGIONS[r].includes(state)) ?? null : null;
  if (KEYS_ZIP5.has(z5)) return { metro: "KEYS", metroLabel: "FL Keys", state, region };
  const m = METROS.find(x => x.ranges.some(([a, b]) => z >= a && z <= b));
  return { metro: m?.key ?? null, metroLabel: m?.label ?? null, state, region };
}

export type LaneSample = { pickup_zip: string | null; delivery_zip: string | null; carrier_pay: number; miles: number; at: string };
export type LaneLevel = "metro" | "state" | "region";
export type LaneRate = { perMile: number; count: number; level: LaneLevel; label: string; min: number; max: number };

/** Carrier pay per mile, rounded to cents. null when either side is missing or not positive. */
export function perMile(pay: number | null | undefined, miles: number | null | undefined): number | null {
  if (!pay || !miles || !(pay > 0) || !(miles > 0)) return null;
  return Math.round((pay / miles) * 100) / 100;
}

export const perMileLabel = (v: number) => `$${v.toFixed(2)} per mile`;

const HALF_LIFE_DAYS = 60;

/**
 * Recency-weighted average $/mi on the closest-matching corridor. Newer jobs count more
 * (60-day half-life), so the number follows the market as it moves.
 */
export function laneRate(fromZip: string | null | undefined, toZip: string | null | undefined, samples: LaneSample[], now = Date.now()): LaneRate | null {
  const a = placeFor(fromZip), b = placeFor(toZip);
  const levels: { level: LaneLevel; key: (p: Place) => string | null; name: (p: Place) => string | null }[] = [
    { level: "metro", key: p => p.metro, name: p => p.metroLabel },
    { level: "state", key: p => p.state, name: p => p.state },
    { level: "region", key: p => p.region, name: p => p.region },
  ];
  const valid = samples.map(s => ({ s, pm: perMile(s.carrier_pay, s.miles) })).filter((x): x is { s: LaneSample; pm: number } => x.pm !== null && x.pm < 20);
  for (const L of levels) {
    const ka = L.key(a), kb = L.key(b);
    if (!ka || !kb) continue;
    const hits = valid.filter(x => L.key(placeFor(x.s.pickup_zip)) === ka && L.key(placeFor(x.s.delivery_zip)) === kb);
    if (!hits.length) continue;
    let wsum = 0, sum = 0;
    for (const h of hits) {
      const ageDays = Math.max(0, (now - Date.parse(h.s.at)) / 86_400_000) || 0;
      const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      wsum += w; sum += w * h.pm;
    }
    const pms = hits.map(h => h.pm);
    return { perMile: Math.round((sum / wsum) * 100) / 100, count: hits.length, level: L.level, label: `${L.name(a)} → ${L.name(b)}`, min: Math.min(...pms), max: Math.max(...pms) };
  }
  return null;
}
