/**
 * Passenger vehicles for the make and model dropdown.
 *
 * Cars, SUVs, pickups, and vans from about 1985 through 2026. Motorcycles,
 * ATVs, golf carts, RVs, trailers, boats, and heavy-truck makes are not listed.
 * A name the office types is still saved and still shows up. Heavy-truck makes
 * can still come from the NHTSA list when someone types them.
 *
 * `major: true` is the short default list: best sellers first, then the rest
 * A to Z. Other passenger makes stay in this file so typing finds them and
 * their models, and they stay off the default list.
 *
 * Names are the series or the family, not a trim code: "3 Series" rather than
 * "330i", "F-150" rather than "XLT". Hidden aliases send a typed code to that
 * family. Crossovers use SUV. The Bolt is a Hatchback.
 *
 * Audi A1 was not sold in the United States, so it is not listed. Rampage
 * ended in 1984 and CX-60 was not the US nameplate; both are listed because
 * offices still ask for them.
 */

import { catalogKey, mergeCatalogNames } from "./names";

export const MODEL_TYPES = ["Sedan", "SUV", "Pickup", "Van", "Coupe", "Convertible", "Hatchback", "S. Wagon", "Truck"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export type CatalogModel = { name: string; type: ModelType; aliases?: string[] };
export type MajorMake = { name: string; major: boolean; models: CatalogModel[] };
export type ListedMake = { name: string; major: boolean; custom: boolean };

type Row = [string, ModelType] | [string, ModelType, readonly string[]];

function rows(list: readonly Row[]): CatalogModel[] {
  return list.map((row) => {
    const [name, type, aliases] = row;
    return aliases && aliases.length ? { name, type, aliases: [...aliases] } : { name, type };
  });
}

/** Best sellers stay in the given order. The rest are A to Z. */
function listed(name: string, major: boolean, priority: readonly Row[], rest: readonly Row[]): MajorMake {
  const models = [
    ...rows(priority),
    ...rows(rest).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
  ];
  return { name, major, models };
}

export const DEFAULT_MAKE_ORDER = [
  "Ford", "Chevrolet", "Toyota", "Honda", "Nissan", "Jeep", "Ram", "GMC",
  "Hyundai", "Kia", "Subaru", "Tesla", "BMW", "Mercedes-Benz", "Lexus", "Audi",
  "Dodge", "Volkswagen",
  "Acura", "Buick", "Cadillac", "Chrysler", "Infiniti", "Land Rover", "Lincoln",
  "Mazda", "Mercury", "Mitsubishi", "Oldsmobile", "Pontiac", "Porsche", "Saturn", "Volvo",
] as const;

const BMW_3 = ["318i", "320i", "323i", "325i", "328i", "330i", "335i", "340i", "318", "320", "323", "325", "328", "330", "335", "340", "M340i", "330e"];
const BMW_5 = ["525i", "528i", "530i", "535i", "540i", "545i", "550i", "525", "528", "530", "535", "540", "545", "550", "M550i", "528e", "530e"];

export const MAJOR_MAKES: MajorMake[] = [
  listed("Ford", true, [
    ["F-150", "Pickup", ["F150"]],
    ["F-250", "Pickup", ["F250"]],
    ["F-350", "Pickup", ["F350"]],
    ["F-450", "Pickup", ["F450"]],
    ["Ranger", "Pickup"],
    ["Explorer", "SUV"],
    ["Escape", "SUV"],
    ["Bronco", "SUV"],
    ["Mustang", "Coupe"],
    ["Edge", "SUV"],
    ["Expedition", "SUV", ["Expedition Max"]],
    ["Maverick", "Pickup"],
    ["Transit", "Van", ["E-Transit"]],
  ], [
    ["Aerostar", "Van"],
    ["Aspire", "Hatchback"],
    ["Bronco II", "SUV"],
    ["Bronco Sport", "SUV"],
    ["C-Max", "Hatchback"],
    ["Contour", "Sedan"],
    ["Country Squire", "S. Wagon"],
    ["Crown Victoria", "Sedan"],
    ["E-150", "Van"],
    ["E-250", "Van"],
    ["E-350", "Van"],
    ["E-450", "Van"],
    ["EcoSport", "SUV"],
    ["Escort", "Sedan"],
    ["Excursion", "SUV"],
    ["EXP", "Coupe"],
    ["Explorer Sport Trac", "Pickup"],
    ["F-150 Lightning", "Pickup", ["F150 Lightning"]],
    ["F-550", "Pickup", ["F550"]],
    ["Festiva", "Hatchback"],
    ["Fiesta", "Hatchback"],
    ["Five Hundred", "Sedan"],
    ["Flex", "SUV"],
    ["Focus", "Sedan"],
    ["Freestar", "Van"],
    ["Freestyle", "SUV"],
    ["Fusion", "Sedan"],
    ["GT", "Coupe"],
    ["LTD", "Sedan"],
    ["Mustang Mach-E", "SUV"],
    ["Probe", "Coupe"],
    ["Taurus", "Sedan"],
    ["Taurus X", "SUV"],
    ["Tempo", "Sedan"],
    ["Thunderbird", "Coupe"],
    ["Transit Connect", "Van"],
    ["Windstar", "Van"],
    ["ZX2", "Coupe"],
  ]),
  listed("Chevrolet", true, [
    ["Silverado 1500", "Pickup", ["Silverado"]],
    ["Silverado 2500HD", "Pickup"],
    ["Silverado 3500HD", "Pickup"],
    ["Equinox", "SUV"],
    ["Malibu", "Sedan"],
    ["Tahoe", "SUV"],
    ["Suburban", "SUV"],
    ["Traverse", "SUV"],
    ["Colorado", "Pickup"],
    ["Camaro", "Coupe"],
    ["Corvette", "Coupe", ["Stingray"]],
  ], [
    ["Astro", "Van"],
    ["Avalanche", "Pickup"],
    ["Aveo", "Sedan", ["Aveo5"]],
    ["Beretta", "Coupe"],
    ["Blazer", "SUV"],
    ["Blazer EV", "SUV"],
    ["Bolt", "Hatchback"],
    ["Bolt EUV", "SUV"],
    ["C/K", "Pickup", ["CK"]],
    ["Caprice", "Sedan"],
    ["Captiva", "SUV"],
    ["Cavalier", "Sedan"],
    ["Celebrity", "Sedan"],
    ["Chevette", "Hatchback"],
    ["Citation", "Hatchback"],
    ["City Express", "Van"],
    ["Cobalt", "Sedan"],
    ["Corsica", "Sedan"],
    ["Cruze", "Sedan"],
    ["El Camino", "Pickup"],
    ["Equinox EV", "SUV"],
    ["Express", "Van"],
    ["HHR", "S. Wagon"],
    ["Impala", "Sedan"],
    ["Lumina", "Sedan"],
    ["Lumina APV", "Van"],
    ["Malibu Maxx", "S. Wagon"],
    ["Metro", "Hatchback"],
    ["Monte Carlo", "Coupe"],
    ["Nova", "Sedan"],
    ["Prizm", "Sedan"],
    ["S-10", "Pickup", ["S10"]],
    ["SS", "Sedan"],
    ["Silverado EV", "Pickup"],
    ["Sonic", "Sedan"],
    ["Spark", "Hatchback"],
    ["Spectrum", "Sedan"],
    ["Sportvan", "Van", ["Chevy Van"]],
    ["Sprint", "Hatchback"],
    ["SSR", "Pickup"],
    ["Tracker", "SUV"],
    ["Trailblazer", "SUV"],
    ["Trax", "SUV"],
    ["Uplander", "Van"],
    ["Venture", "Van"],
    ["Volt", "Hatchback"],
  ]),
  listed("Toyota", true, [
    ["Camry", "Sedan"],
    ["Corolla", "Sedan"],
    ["RAV4", "SUV", ["RAV4 Prime"]],
    ["Tacoma", "Pickup"],
    ["Tundra", "Pickup"],
    ["Highlander", "SUV"],
    ["4Runner", "SUV", ["4 Runner"]],
    ["Sienna", "Van"],
    ["Prius", "Hatchback", ["Prius Prime", "Prius Plug-in"]],
  ], [
    ["Avalon", "Sedan"],
    ["bZ4X", "SUV"],
    ["C-HR", "SUV"],
    ["Celica", "Coupe"],
    ["Corolla Cross", "SUV"],
    ["Corolla FX", "Hatchback"],
    ["Corolla iM", "Hatchback"],
    ["Cressida", "Sedan"],
    ["Crown", "Sedan"],
    ["Crown Signia", "SUV"],
    ["Echo", "Sedan"],
    ["FJ Cruiser", "SUV"],
    ["GR Corolla", "Hatchback"],
    ["GR86", "Coupe", ["86"]],
    ["Grand Highlander", "SUV"],
    ["Land Cruiser", "SUV"],
    ["Matrix", "Hatchback"],
    ["Mirai", "Sedan"],
    ["MR2", "Coupe", ["MR2 Spyder"]],
    ["Paseo", "Coupe"],
    ["Pickup", "Pickup", ["Hilux"]],
    ["Previa", "Van"],
    ["Prius c", "Hatchback"],
    ["Prius v", "S. Wagon"],
    ["Sequoia", "SUV"],
    ["Solara", "Coupe"],
    ["Supra", "Coupe"],
    ["T100", "Pickup"],
    ["Tercel", "Sedan"],
    ["Van", "Van"],
    ["Venza", "SUV"],
    ["Yaris", "Hatchback"],
    ["Yaris iA", "Sedan"],
  ]),
  listed("Honda", true, [
    ["Accord", "Sedan"],
    ["Civic", "Sedan"],
    ["CR-V", "SUV", ["CRV"]],
    ["Pilot", "SUV"],
    ["Odyssey", "Van"],
    ["Ridgeline", "Pickup"],
  ], [
    ["Civic Wagon", "S. Wagon"],
    ["Clarity", "Sedan"],
    ["Crosstour", "SUV"],
    ["CR-Z", "Hatchback"],
    ["CRX", "Hatchback", ["CR-X"]],
    ["del Sol", "Coupe", ["Civic del Sol"]],
    ["Element", "SUV"],
    ["Fit", "Hatchback"],
    ["HR-V", "SUV", ["HRV"]],
    ["Insight", "Hatchback"],
    ["Passport", "SUV"],
    ["Prelude", "Coupe"],
    ["Prologue", "SUV"],
    ["S2000", "Convertible"],
  ]),
  listed("Nissan", true, [
    ["Altima", "Sedan"],
    ["Rogue", "SUV"],
    ["Sentra", "Sedan"],
    ["Frontier", "Pickup", ["Navara"]],
    ["Titan", "Pickup", ["Titan XD"]],
    ["Pathfinder", "SUV"],
  ], [
    ["200SX", "Coupe"],
    ["240SX", "Coupe"],
    ["Ariya", "SUV"],
    ["Armada", "SUV"],
    ["Cube", "Hatchback"],
    ["GT-R", "Coupe"],
    ["Juke", "SUV"],
    ["Kicks", "SUV"],
    ["Leaf", "Hatchback"],
    ["Maxima", "Sedan"],
    ["Murano", "SUV"],
    ["Murano CrossCabriolet", "Convertible"],
    ["NV", "Van"],
    ["NV200", "Van"],
    ["NX", "Coupe"],
    ["Pickup", "Pickup", ["Hardbody"]],
    ["Pulsar", "Hatchback"],
    ["Quest", "Van"],
    ["Rogue Sport", "SUV", ["Qashqai"]],
    ["Stanza", "Sedan"],
    ["Van", "Van"],
    ["Versa", "Sedan"],
    ["Versa Note", "Hatchback"],
    ["Xterra", "SUV"],
    ["Z", "Coupe", ["300ZX", "350Z", "370Z"]],
  ]),
  listed("Jeep", true, [
    ["Wrangler", "SUV", ["Wrangler Unlimited"]],
    ["Grand Cherokee", "SUV", ["Grand Cherokee L"]],
    ["Cherokee", "SUV"],
    ["Gladiator", "Pickup"],
  ], [
    ["CJ", "SUV", ["CJ-5", "CJ-7", "CJ-8"]],
    ["Comanche", "Pickup"],
    ["Commander", "SUV"],
    ["Compass", "SUV"],
    ["Grand Wagoneer", "SUV"],
    ["J-10", "Pickup"],
    ["J-20", "Pickup"],
    ["Liberty", "SUV"],
    ["Patriot", "SUV"],
    ["Recon", "SUV"],
    ["Renegade", "SUV"],
    ["Wagoneer", "SUV"],
  ]),
  listed("Ram", true, [
    ["1500", "Pickup", ["Ram 1500", "1500 Classic"]],
    ["2500", "Pickup", ["Ram 2500"]],
    ["3500", "Pickup", ["Ram 3500"]],
  ], [
    ["4500", "Pickup", ["Ram 4500"]],
    ["5500", "Pickup", ["Ram 5500"]],
    ["C/V", "Van"],
    ["Dakota", "Pickup"],
    ["ProMaster", "Van"],
    ["ProMaster City", "Van"],
    ["Rampage", "Pickup"],
  ]),
  listed("GMC", true, [
    ["Sierra 1500", "Pickup"],
    ["Sierra 2500HD", "Pickup"],
    ["Yukon", "SUV"],
    ["Acadia", "SUV"],
    ["Terrain", "SUV"],
  ], [
    ["Caballero", "Pickup"],
    ["Canyon", "Pickup"],
    ["Envoy", "SUV"],
    ["Hummer EV Pickup", "Pickup"],
    ["Hummer EV SUV", "SUV"],
    ["Jimmy", "SUV"],
    ["S-15", "Pickup"],
    ["Safari", "Van"],
    ["Savana", "Van"],
    ["Sierra 3500HD", "Pickup"],
    ["Sierra EV", "Pickup"],
    ["Sonoma", "Pickup"],
    ["Suburban", "SUV"],
    ["Syclone", "Pickup"],
    ["Typhoon", "SUV"],
    ["Vandura", "Van", ["Rally"]],
    ["Yukon XL", "SUV"],
  ]),
  listed("Hyundai", true, [
    ["Elantra", "Sedan"],
    ["Sonata", "Sedan"],
    ["Tucson", "SUV"],
    ["Santa Fe", "SUV", ["Santa Fe Sport"]],
  ], [
    ["Accent", "Sedan"],
    ["Azera", "Sedan"],
    ["Elantra GT", "Hatchback"],
    ["Elantra Touring", "S. Wagon"],
    ["Entourage", "Van"],
    ["Equus", "Sedan"],
    ["Excel", "Hatchback"],
    ["Genesis", "Sedan"],
    ["Genesis Coupe", "Coupe"],
    ["Ioniq", "Hatchback"],
    ["Ioniq 5", "SUV"],
    ["Ioniq 6", "Sedan"],
    ["Ioniq 9", "SUV"],
    ["Kona", "SUV", ["Kona Electric"]],
    ["Nexo", "SUV"],
    ["Palisade", "SUV"],
    ["Santa Cruz", "Pickup"],
    ["Scoupe", "Coupe"],
    ["Tiburon", "Coupe"],
    ["Veloster", "Hatchback"],
    ["Venue", "SUV"],
    ["Veracruz", "SUV"],
    ["XG", "Sedan", ["XG300", "XG350"]],
  ]),
  listed("Kia", true, [
    ["Sorento", "SUV"],
    ["Sportage", "SUV"],
    ["Telluride", "SUV"],
    ["Forte", "Sedan"],
    ["K5", "Sedan"],
  ], [
    ["Amanti", "Sedan"],
    ["Borrego", "SUV", ["Mohave"]],
    ["Cadenza", "Sedan"],
    ["Carnival", "Van"],
    ["EV6", "SUV"],
    ["EV9", "SUV"],
    ["Forte Koup", "Coupe"],
    ["Forte5", "Hatchback"],
    ["K900", "Sedan", ["K9"]],
    ["Niro", "SUV"],
    ["Optima", "Sedan"],
    ["Rio", "Sedan"],
    ["Rondo", "Hatchback"],
    ["Sedona", "Van"],
    ["Seltos", "SUV"],
    ["Sephia", "Sedan"],
    ["Soul", "Hatchback"],
    ["Spectra", "Sedan", ["Spectra5"]],
    ["Stinger", "Sedan"],
  ]),
  listed("Subaru", true, [
    ["Outback", "SUV"],
    ["Forester", "SUV"],
    ["Crosstrek", "SUV", ["XV", "XV Crosstrek"]],
  ], [
    ["Ascent", "SUV"],
    ["Baja", "Pickup"],
    ["Brat", "Pickup"],
    ["BRZ", "Coupe"],
    ["DL", "Sedan"],
    ["GL", "Sedan"],
    ["Impreza", "Sedan"],
    ["Justy", "Hatchback"],
    ["Legacy", "Sedan"],
    ["Loyale", "Sedan"],
    ["Solterra", "SUV"],
    ["SVX", "Coupe"],
    ["Tribeca", "SUV", ["B9 Tribeca"]],
    ["WRX", "Sedan", ["WRX STI", "STI"]],
    ["XT", "Coupe"],
  ]),
  listed("Tesla", true, [
    ["Model 3", "Sedan"],
    ["Model Y", "SUV"],
    ["Model S", "Sedan"],
    ["Model X", "SUV"],
  ], [
    ["Cybertruck", "Pickup"],
    ["Roadster", "Convertible"],
    ["Semi", "Truck"],
  ]),
  listed("BMW", true, [
    ["3 Series", "Sedan", BMW_3],
    ["X5", "SUV"],
    ["X3", "SUV"],
    ["5 Series", "Sedan", BMW_5],
    ["X1", "SUV"],
  ], [
    ["1 Series", "Coupe", ["128i", "135i", "135is"]],
    ["2 Series", "Coupe", ["228i", "230i", "M235i", "M240i"]],
    ["4 Series", "Coupe", ["428i", "430i", "435i", "440i"]],
    ["6 Series", "Coupe", ["640i", "650i", "645ci"]],
    ["7 Series", "Sedan", ["735i", "740i", "740iL", "745i", "750i", "750Li", "760i", "760Li"]],
    ["8 Series", "Coupe", ["840i", "850i", "850Ci"]],
    ["i3", "Hatchback"],
    ["i4", "Sedan"],
    ["i5", "Sedan"],
    ["i7", "Sedan"],
    ["i8", "Coupe"],
    ["iX", "SUV"],
    ["M2", "Coupe"],
    ["M3", "Sedan"],
    ["M4", "Coupe"],
    ["M5", "Sedan"],
    ["M6", "Coupe"],
    ["M8", "Coupe"],
    ["X2", "SUV"],
    ["X4", "SUV"],
    ["X6", "SUV"],
    ["X7", "SUV"],
    ["XM", "SUV"],
    ["Z3", "Convertible"],
    ["Z4", "Convertible"],
    ["Z8", "Convertible"],
  ]),
  listed("Mercedes-Benz", true, [
    ["C-Class", "Sedan", ["C220", "C230", "C240", "C250", "C280", "C300", "C320", "C32", "C350", "C36", "C400", "C43", "C450", "C55", "C63"]],
    ["E-Class", "Sedan", ["E300", "E320", "E350", "E400", "E420", "E430", "E450", "E500", "E53", "E55", "E550", "E63", "260E", "300E", "300CE", "300D", "400E", "500E"]],
    ["GLE", "SUV", ["GLE350", "GLE400", "GLE450", "GLE53", "GLE580", "GLE63"]],
    ["GLC", "SUV", ["GLC300", "GLC43", "GLC63"]],
    ["S-Class", "Sedan", ["S350", "S400", "S430", "S450", "S500", "S550", "S560", "S580", "S600", "S63", "S65", "300SEL", "420SEL", "500SEL", "500SEC", "560SEL", "560SEC"]],
  ], [
    ["190E", "Sedan", ["190", "190D"]],
    ["A-Class", "Sedan"],
    ["AMG GT", "Coupe"],
    ["B-Class", "Hatchback", ["B250e"]],
    ["CLA", "Sedan", ["CLA250", "CLA35", "CLA45"]],
    ["CLK", "Coupe", ["CLK320", "CLK350", "CLK430", "CLK500", "CLK55", "CLK550", "CLK63"]],
    ["CLS", "Sedan", ["CLS400", "CLS450", "CLS500", "CLS550", "CLS63"]],
    ["EQB", "SUV"],
    ["EQE", "Sedan"],
    ["EQE SUV", "SUV"],
    ["EQS", "Sedan"],
    ["EQS SUV", "SUV"],
    ["G-Class", "SUV", ["G550", "G63", "G500", "G55", "G-Wagen"]],
    ["GL", "SUV", ["GL350", "GL450", "GL550", "GL63"]],
    ["GLA", "SUV", ["GLA250", "GLA45"]],
    ["GLB", "SUV", ["GLB250", "GLB35"]],
    ["GLK", "SUV", ["GLK250", "GLK350"]],
    ["GLS", "SUV", ["GLS450", "GLS580", "GLS63"]],
    ["ML", "SUV", ["ML320", "ML350", "ML430", "ML500", "ML550", "ML63", "M-Class"]],
    ["Maybach GLS", "SUV"],
    ["Maybach S-Class", "Sedan"],
    ["Metris", "Van"],
    ["R-Class", "SUV", ["R320", "R350", "R500"]],
    ["SL", "Convertible", ["SL500", "SL550", "SL55", "SL63", "SL65", "500SL", "560SL"]],
    ["SLC", "Convertible", ["SLC300", "SLC43"]],
    ["SLK", "Convertible", ["SLK230", "SLK250", "SLK280", "SLK320", "SLK350", "SLK55"]],
    ["Sprinter", "Van"],
  ]),
  listed("Lexus", true, [
    ["RX", "SUV", ["RX300", "RX330", "RX350", "RX350L", "RX400h", "RX450h", "RX500h"]],
    ["ES", "Sedan", ["ES250", "ES300", "ES300h", "ES330", "ES350"]],
    ["NX", "SUV", ["NX200t", "NX300", "NX350", "NX450h"]],
  ], [
    ["CT", "Hatchback", ["CT200h"]],
    ["GS", "Sedan", ["GS300", "GS350", "GS400", "GS430", "GS450h", "GS460"]],
    ["GX", "SUV", ["GX460", "GX470", "GX550"]],
    ["HS", "Sedan", ["HS250h"]],
    ["IS", "Sedan", ["IS250", "IS300", "IS350", "IS500", "IS200t", "IS F"]],
    ["LC", "Coupe", ["LC500"]],
    ["LFA", "Coupe"],
    ["LS", "Sedan", ["LS400", "LS430", "LS460", "LS500", "LS600h"]],
    ["LX", "SUV", ["LX450", "LX470", "LX570", "LX600"]],
    ["RC", "Coupe", ["RC300", "RC350", "RC F"]],
    ["RZ", "SUV", ["RZ450e"]],
    ["SC", "Convertible", ["SC300", "SC400", "SC430"]],
    ["TX", "SUV", ["TX350", "TX500h"]],
    ["UX", "SUV", ["UX200", "UX250h"]],
  ]),
  listed("Audi", true, [
    ["A4", "Sedan", ["S4"]],
    ["Q5", "SUV", ["SQ5"]],
    ["A6", "Sedan", ["S6", "RS6"]],
    ["Q7", "SUV"],
  ], [
    ["100", "Sedan"],
    ["200", "Sedan"],
    ["5000", "Sedan"],
    ["80", "Sedan"],
    ["90", "Sedan"],
    ["A3", "Sedan", ["S3"]],
    ["A4 allroad", "S. Wagon"],
    ["A5", "Coupe", ["S5"]],
    ["A6 allroad", "S. Wagon"],
    ["A7", "Sedan", ["S7", "RS7"]],
    ["A8", "Sedan", ["S8"]],
    ["allroad", "S. Wagon"],
    ["Cabriolet", "Convertible"],
    ["Coupe", "Coupe", ["Coupe GT"]],
    ["e-tron", "SUV"],
    ["e-tron GT", "Sedan"],
    ["Q3", "SUV"],
    ["Q4 e-tron", "SUV"],
    ["Q6 e-tron", "SUV"],
    ["Q8", "SUV"],
    ["Q8 e-tron", "SUV"],
    ["R8", "Coupe"],
    ["TT", "Coupe"],
    ["V8", "Sedan"],
  ]),
  listed("Dodge", true, [
    ["Charger", "Sedan"],
    ["Challenger", "Coupe"],
    ["Durango", "SUV"],
    ["Grand Caravan", "Van"],
  ], [
    ["600", "Sedan"],
    ["Aries", "Sedan"],
    ["Avenger", "Sedan"],
    ["Caliber", "Hatchback"],
    ["Caravan", "Van"],
    ["Colt", "Hatchback"],
    ["Conquest", "Coupe"],
    ["Dakota", "Pickup"],
    ["Dart", "Sedan"],
    ["Daytona", "Coupe"],
    ["Diplomat", "Sedan"],
    ["Dynasty", "Sedan"],
    ["Hornet", "SUV"],
    ["Intrepid", "Sedan"],
    ["Journey", "SUV"],
    ["Lancer", "Hatchback"],
    ["Magnum", "S. Wagon"],
    ["Monaco", "Sedan"],
    ["Neon", "Sedan"],
    ["Nitro", "SUV"],
    ["Omni", "Hatchback"],
    ["Ram 1500", "Pickup", ["D150"]],
    ["Ram 2500", "Pickup", ["D250"]],
    ["Ram 3500", "Pickup", ["D350"]],
    ["Ram Van", "Van"],
    ["Ramcharger", "SUV"],
    ["Shadow", "Sedan"],
    ["Spirit", "Sedan"],
    ["Sprinter", "Van"],
    ["Stealth", "Coupe"],
    ["Stratus", "Sedan"],
    ["Viper", "Coupe"],
  ]),
  listed("Volkswagen", true, [
    ["Jetta", "Sedan", ["GLI"]],
    ["Tiguan", "SUV", ["Tiguan Limited"]],
    ["Atlas", "SUV"],
    ["Golf", "Hatchback", ["Golf R", "R32"]],
  ], [
    ["Arteon", "Sedan"],
    ["Atlas Cross Sport", "SUV"],
    ["Beetle", "Hatchback", ["New Beetle"]],
    ["Cabrio", "Convertible", ["Cabriolet"]],
    ["CC", "Sedan", ["Passat CC"]],
    ["Corrado", "Coupe"],
    ["Eos", "Convertible"],
    ["EuroVan", "Van"],
    ["Fox", "Hatchback"],
    ["Golf SportWagen", "S. Wagon"],
    ["GTI", "Hatchback"],
    ["ID.4", "SUV"],
    ["ID.Buzz", "Van"],
    ["Jetta SportWagen", "S. Wagon"],
    ["Passat", "Sedan"],
    ["Passat Wagon", "S. Wagon"],
    ["Quantum", "Sedan"],
    ["Rabbit", "Hatchback"],
    ["Routan", "Van"],
    ["Scirocco", "Coupe"],
    ["Taos", "SUV"],
    ["Touareg", "SUV"],
    ["Vanagon", "Van"],
  ]),
  listed("Acura", true, [
    ["MDX", "SUV"],
    ["RDX", "SUV"],
    ["TLX", "Sedan"],
  ], [
    ["ADX", "SUV"],
    ["CL", "Coupe"],
    ["ILX", "Sedan"],
    ["Integra", "Sedan"],
    ["Legend", "Sedan"],
    ["NSX", "Coupe"],
    ["RL", "Sedan"],
    ["RLX", "Sedan"],
    ["RSX", "Coupe"],
    ["SLX", "SUV"],
    ["TL", "Sedan"],
    ["TSX", "Sedan", ["TSX Sport Wagon"]],
    ["Vigor", "Sedan"],
    ["ZDX", "SUV"],
  ]),
  listed("Buick", true, [
    ["Encore", "SUV"],
    ["Enclave", "SUV"],
    ["Envision", "SUV"],
  ], [
    ["Cascada", "Convertible"],
    ["Century", "Sedan"],
    ["Electra", "Sedan"],
    ["Encore GX", "SUV"],
    ["Envista", "SUV"],
    ["Estate", "S. Wagon"],
    ["LaCrosse", "Sedan"],
    ["LeSabre", "Sedan"],
    ["Lucerne", "Sedan"],
    ["Park Avenue", "Sedan"],
    ["Rainier", "SUV"],
    ["Reatta", "Coupe"],
    ["Regal", "Sedan"],
    ["Regal TourX", "S. Wagon"],
    ["Rendezvous", "SUV"],
    ["Riviera", "Coupe"],
    ["Roadmaster", "Sedan"],
    ["Skylark", "Sedan"],
    ["Somerset", "Coupe"],
    ["Terraza", "Van"],
    ["Verano", "Sedan"],
  ]),
  listed("Cadillac", true, [
    ["Escalade", "SUV", ["Escalade ESV"]],
    ["XT5", "SUV"],
    ["CT5", "Sedan"],
  ], [
    ["Allante", "Convertible"],
    ["ATS", "Sedan"],
    ["Brougham", "Sedan"],
    ["Catera", "Sedan"],
    ["Celestiq", "Sedan"],
    ["Cimarron", "Sedan"],
    ["CT4", "Sedan"],
    ["CT6", "Sedan"],
    ["CTS", "Sedan", ["CTS-V"]],
    ["DeVille", "Sedan"],
    ["DTS", "Sedan"],
    ["ELR", "Coupe"],
    ["Eldorado", "Coupe"],
    ["Escalade EXT", "Pickup"],
    ["Escalade IQ", "SUV"],
    ["Fleetwood", "Sedan"],
    ["Lyriq", "SUV"],
    ["Optiq", "SUV"],
    ["Seville", "Sedan"],
    ["SRX", "SUV"],
    ["STS", "Sedan"],
    ["Vistiq", "SUV"],
    ["XLR", "Convertible"],
    ["XT4", "SUV"],
    ["XT6", "SUV"],
    ["XTS", "Sedan"],
  ]),
  listed("Chrysler", true, [
    ["Pacifica", "Van"],
    ["300", "Sedan"],
    ["Voyager", "Van"],
  ], [
    ["200", "Sedan"],
    ["300M", "Sedan"],
    ["Aspen", "SUV"],
    ["Cirrus", "Sedan"],
    ["Concorde", "Sedan"],
    ["Conquest", "Coupe"],
    ["Crossfire", "Coupe"],
    ["Fifth Avenue", "Sedan"],
    ["Imperial", "Sedan"],
    ["Laser", "Coupe"],
    ["LeBaron", "Sedan"],
    ["LHS", "Sedan"],
    ["New Yorker", "Sedan"],
    ["PT Cruiser", "Hatchback"],
    ["Sebring", "Sedan"],
    ["TC by Maserati", "Convertible"],
    ["Town & Country", "Van"],
  ]),
  listed("Infiniti", true, [
    ["QX60", "SUV", ["JX35"]],
    ["QX50", "SUV"],
    ["Q50", "Sedan"],
  ], [
    ["EX", "SUV", ["EX35", "EX37"]],
    ["FX", "SUV", ["FX35", "FX37", "FX45", "FX50"]],
    ["G20", "Sedan"],
    ["G35", "Sedan"],
    ["G37", "Sedan"],
    ["I30", "Sedan"],
    ["I35", "Sedan"],
    ["J30", "Sedan"],
    ["M30", "Coupe"],
    ["M35", "Sedan", ["M37"]],
    ["M45", "Sedan", ["M56"]],
    ["Q40", "Sedan"],
    ["Q45", "Sedan"],
    ["Q60", "Coupe"],
    ["Q70", "Sedan"],
    ["QX4", "SUV"],
    ["QX30", "SUV"],
    ["QX55", "SUV"],
    ["QX56", "SUV"],
    ["QX70", "SUV"],
    ["QX80", "SUV"],
  ]),
  listed("Land Rover", true, [
    ["Range Rover", "SUV"],
    ["Defender", "SUV"],
    ["Discovery", "SUV"],
  ], [
    ["Discovery Sport", "SUV"],
    ["Freelander", "SUV"],
    ["LR2", "SUV"],
    ["LR3", "SUV"],
    ["LR4", "SUV"],
    ["Range Rover Evoque", "SUV"],
    ["Range Rover Sport", "SUV"],
    ["Range Rover Velar", "SUV"],
  ]),
  listed("Lincoln", true, [
    ["Navigator", "SUV", ["Navigator L"]],
    ["Aviator", "SUV"],
    ["Corsair", "SUV"],
    ["Nautilus", "SUV"],
  ], [
    ["Blackwood", "Pickup"],
    ["Continental", "Sedan"],
    ["LS", "Sedan"],
    ["Mark LT", "Pickup"],
    ["Mark VII", "Coupe"],
    ["Mark VIII", "Coupe"],
    ["MKC", "SUV"],
    ["MKS", "Sedan"],
    ["MKT", "SUV"],
    ["MKX", "SUV"],
    ["MKZ", "Sedan"],
    ["Town Car", "Sedan"],
    ["Zephyr", "Sedan"],
  ]),
  listed("Mazda", true, [
    ["CX-5", "SUV"],
    ["Mazda3", "Sedan", ["3"]],
    ["CX-50", "SUV"],
    ["CX-90", "SUV"],
  ], [
    ["323", "Sedan"],
    ["626", "Sedan"],
    ["929", "Sedan"],
    ["B-Series", "Pickup", ["B2200", "B2300", "B2500", "B3000", "B4000"]],
    ["CX-3", "SUV"],
    ["CX-30", "SUV"],
    ["CX-60", "SUV"],
    ["CX-7", "SUV"],
    ["CX-70", "SUV"],
    ["CX-9", "SUV"],
    ["GLC", "Hatchback"],
    ["Mazda2", "Hatchback"],
    ["Mazda5", "Van"],
    ["Mazda6", "Sedan"],
    ["Millenia", "Sedan"],
    ["MPV", "Van"],
    ["MX-3", "Coupe"],
    ["MX-30", "SUV"],
    ["MX-5", "Convertible", ["Miata", "MX-5 Miata"]],
    ["MX-6", "Coupe"],
    ["Navajo", "SUV"],
    ["Protege", "Sedan"],
    ["Protege5", "Hatchback"],
    ["RX-7", "Coupe"],
    ["RX-8", "Coupe"],
    ["Tribute", "SUV"],
  ]),
  listed("Mercury", true, [
    ["Grand Marquis", "Sedan"],
    ["Sable", "Sedan"],
    ["Mountaineer", "SUV"],
  ], [
    ["Capri", "Convertible"],
    ["Colony Park", "S. Wagon"],
    ["Cougar", "Coupe"],
    ["Lynx", "Hatchback"],
    ["Marauder", "Sedan"],
    ["Mariner", "SUV"],
    ["Marquis", "Sedan"],
    ["Milan", "Sedan"],
    ["Montego", "Sedan"],
    ["Mystique", "Sedan"],
    ["Topaz", "Sedan"],
    ["Tracer", "Sedan"],
    ["Villager", "Van"],
  ]),
  listed("Mitsubishi", true, [
    ["Outlander", "SUV"],
    ["Eclipse Cross", "SUV"],
    ["Mirage", "Hatchback"],
  ], [
    ["3000GT", "Coupe"],
    ["Cordia", "Coupe"],
    ["Diamante", "Sedan"],
    ["Eclipse", "Coupe"],
    ["Endeavor", "SUV"],
    ["Expo", "Van"],
    ["Galant", "Sedan"],
    ["i-MiEV", "Hatchback"],
    ["Lancer", "Sedan", ["Evolution", "Lancer Evolution", "Evo"]],
    ["Mighty Max", "Pickup"],
    ["Mirage G4", "Sedan"],
    ["Montero", "SUV", ["Pajero"]],
    ["Montero Sport", "SUV"],
    ["Outlander Sport", "SUV"],
    ["Precis", "Hatchback"],
    ["Raider", "Pickup"],
    ["Sigma", "Sedan"],
    ["Starion", "Coupe"],
    ["Tredia", "Sedan"],
    ["Van", "Van", ["Wagon"]],
  ]),
  listed("Oldsmobile", true, [
    ["Eighty-Eight", "Sedan", ["88", "Delta 88"]],
    ["Cutlass Ciera", "Sedan"],
    ["Alero", "Sedan"],
  ], [
    ["Achieva", "Sedan"],
    ["Aurora", "Sedan"],
    ["Bravada", "SUV"],
    ["Custom Cruiser", "S. Wagon"],
    ["Cutlass", "Sedan"],
    ["Cutlass Calais", "Coupe"],
    ["Cutlass Supreme", "Coupe"],
    ["Firenza", "Sedan"],
    ["Intrigue", "Sedan"],
    ["Ninety-Eight", "Sedan", ["98"]],
    ["Silhouette", "Van"],
    ["Toronado", "Coupe", ["Tornado"]],
  ]),
  listed("Pontiac", true, [
    ["Grand Am", "Sedan"],
    ["Grand Prix", "Sedan"],
    ["Bonneville", "Sedan"],
  ], [
    ["6000", "Sedan"],
    ["Aztek", "SUV"],
    ["Fiero", "Coupe"],
    ["Firebird", "Coupe", ["Trans Am"]],
    ["G3", "Hatchback"],
    ["G5", "Coupe"],
    ["G6", "Sedan"],
    ["G8", "Sedan"],
    ["GTO", "Coupe"],
    ["LeMans", "Hatchback"],
    ["Montana", "Van"],
    ["Parisienne", "Sedan"],
    ["Solstice", "Convertible"],
    ["Sunbird", "Coupe"],
    ["Sunfire", "Coupe"],
    ["Torrent", "SUV"],
    ["Trans Sport", "Van"],
    ["Vibe", "Hatchback"],
  ]),
  listed("Porsche", true, [
    ["Cayenne", "SUV"],
    ["Macan", "SUV"],
    ["911", "Coupe"],
  ], [
    ["718", "Coupe"],
    ["918 Spyder", "Convertible"],
    ["924", "Coupe"],
    ["928", "Coupe"],
    ["944", "Coupe"],
    ["968", "Coupe"],
    ["Boxster", "Convertible"],
    ["Carrera GT", "Coupe"],
    ["Cayman", "Coupe"],
    ["Panamera", "Sedan"],
    ["Taycan", "Sedan", ["Taycan Cross Turismo"]],
  ]),
  listed("Saturn", true, [
    ["S-Series", "Sedan", ["SC", "SL", "SW"]],
    ["Vue", "SUV"],
    ["Ion", "Sedan"],
  ], [
    ["Astra", "Hatchback"],
    ["Aura", "Sedan"],
    ["L-Series", "Sedan", ["LS", "LW"]],
    ["Outlook", "SUV"],
    ["Relay", "Van"],
    ["Sky", "Convertible"],
  ]),
  listed("Volvo", true, [
    ["XC90", "SUV"],
    ["XC60", "SUV"],
    ["S60", "Sedan"],
  ], [
    ["240", "Sedan"],
    ["740", "Sedan"],
    ["760", "Sedan"],
    ["780", "Coupe"],
    ["850", "Sedan"],
    ["940", "Sedan"],
    ["960", "Sedan"],
    ["C30", "Hatchback"],
    ["C40", "SUV", ["EC40"]],
    ["C70", "Convertible"],
    ["EX30", "SUV"],
    ["EX90", "SUV"],
    ["S40", "Sedan"],
    ["S70", "Sedan"],
    ["S80", "Sedan"],
    ["S90", "Sedan"],
    ["V50", "S. Wagon"],
    ["V60", "S. Wagon"],
    ["V70", "S. Wagon"],
    ["V90", "S. Wagon"],
    ["XC40", "SUV"],
    ["XC70", "SUV"],
  ]),

  listed("Alfa Romeo", false, [
    ["Giulia", "Sedan", ["Quadrifoglio"]],
    ["Stelvio", "SUV"],
    ["Tonale", "SUV"],
  ], [
    ["164", "Sedan"],
    ["4C", "Coupe"],
    ["8C Competizione", "Coupe"],
    ["Milano", "Sedan"],
    ["Spider", "Convertible"],
  ]),
  listed("Aston Martin", false, [
    ["DBX", "SUV"],
    ["Vantage", "Coupe"],
    ["DB12", "Coupe"],
  ], [
    ["DB11", "Coupe"],
    ["DB7", "Coupe"],
    ["DB9", "Coupe"],
    ["DBS", "Coupe"],
    ["Rapide", "Sedan"],
    ["Vanquish", "Coupe"],
    ["Virage", "Coupe"],
  ]),
  listed("Bentley", false, [
    ["Bentayga", "SUV"],
    ["Continental", "Coupe", ["Continental GT"]],
    ["Flying Spur", "Sedan"],
  ], [
    ["Arnage", "Sedan"],
    ["Azure", "Convertible"],
    ["Brooklands", "Coupe"],
    ["Mulsanne", "Sedan"],
    ["Turbo R", "Sedan"],
  ]),
  listed("Bugatti", false, [
    ["Chiron", "Coupe"],
    ["Veyron", "Coupe"],
  ], []),
  listed("Eagle", false, [
    ["Talon", "Coupe"],
    ["Vision", "Sedan"],
    ["Premier", "Sedan"],
  ], [
    ["Medallion", "Sedan"],
    ["Summit", "Sedan"],
  ]),
  listed("Ferrari", false, [
    ["Purosangue", "SUV"],
    ["Roma", "Coupe"],
    ["296 GTB", "Coupe"],
  ], [
    ["12Cilindri", "Coupe"],
    ["328", "Coupe"],
    ["348", "Coupe"],
    ["360", "Coupe"],
    ["458", "Coupe"],
    ["488", "Coupe"],
    ["550", "Coupe"],
    ["575", "Coupe"],
    ["599", "Coupe"],
    ["812", "Coupe"],
    ["California", "Convertible"],
    ["Enzo", "Coupe"],
    ["F355", "Coupe"],
    ["F430", "Coupe"],
    ["F8", "Coupe"],
    ["FF", "Coupe"],
    ["GTC4Lusso", "Coupe"],
    ["LaFerrari", "Coupe"],
    ["Mondial", "Coupe"],
    ["Portofino", "Convertible"],
    ["SF90", "Coupe"],
    ["Testarossa", "Coupe"],
  ]),
  listed("Fiat", false, [
    ["500", "Hatchback", ["500e"]],
    ["500X", "SUV"],
    ["124 Spider", "Convertible"],
  ], [
    ["500L", "Hatchback"],
  ]),
  listed("Genesis", false, [
    ["GV70", "SUV"],
    ["G70", "Sedan"],
    ["GV80", "SUV"],
  ], [
    ["G80", "Sedan"],
    ["G90", "Sedan"],
    ["GV60", "SUV"],
  ]),
  listed("Geo", false, [
    ["Prizm", "Sedan"],
    ["Tracker", "SUV"],
    ["Metro", "Hatchback"],
  ], [
    ["Spectrum", "Sedan"],
    ["Storm", "Coupe"],
  ]),
  listed("Hummer", false, [
    ["H2", "SUV", ["H2 SUT"]],
    ["H3", "SUV"],
    ["Hummer EV SUV", "SUV"],
  ], [
    ["H1", "SUV"],
    ["H3T", "Pickup"],
    ["Hummer EV Pickup", "Pickup"],
  ]),
  listed("Isuzu", false, [
    ["Rodeo", "SUV"],
    ["Trooper", "SUV", ["Trooper II"]],
    ["Amigo", "SUV", ["Rodeo Sport"]],
  ], [
    ["Ascender", "SUV"],
    ["Axiom", "SUV"],
    ["Hombre", "Pickup"],
    ["i-280", "Pickup"],
    ["i-290", "Pickup"],
    ["i-350", "Pickup"],
    ["i-370", "Pickup"],
    ["I-Mark", "Sedan"],
    ["Impulse", "Coupe"],
    ["Oasis", "Van"],
    ["Pickup", "Pickup"],
    ["Stylus", "Sedan"],
    ["VehiCROSS", "SUV"],
  ]),
  listed("Jaguar", false, [
    ["F-Pace", "SUV"],
    ["F-Type", "Coupe"],
    ["E-Pace", "SUV"],
  ], [
    ["I-Pace", "SUV"],
    ["S-Type", "Sedan"],
    ["XE", "Sedan"],
    ["XF", "Sedan"],
    ["XJ", "Sedan", ["XJ6", "XJ8", "XJL"]],
    ["XJS", "Coupe"],
    ["XK", "Coupe", ["XK8", "XKR"]],
    ["X-Type", "Sedan"],
  ]),
  listed("Lamborghini", false, [
    ["Urus", "SUV"],
    ["Huracan", "Coupe"],
    ["Revuelto", "Coupe"],
  ], [
    ["Aventador", "Coupe"],
    ["Countach", "Coupe"],
    ["Diablo", "Coupe"],
    ["Gallardo", "Coupe"],
    ["Jalpa", "Coupe"],
    ["Murcielago", "Coupe"],
  ]),
  listed("Lotus", false, [
    ["Emira", "Coupe"],
    ["Eletre", "SUV"],
    ["Evora", "Coupe"],
  ], [
    ["Elise", "Coupe"],
    ["Esprit", "Coupe"],
    ["Europa", "Coupe"],
    ["Exige", "Coupe"],
  ]),
  listed("Lucid", false, [
    ["Air", "Sedan"],
    ["Gravity", "SUV"],
  ], []),
  listed("Maserati", false, [
    ["Levante", "SUV"],
    ["Grecale", "SUV"],
    ["Ghibli", "Sedan"],
  ], [
    ["Biturbo", "Coupe"],
    ["Coupe", "Coupe"],
    ["GranCabrio", "Convertible"],
    ["GranTurismo", "Coupe"],
    ["MC20", "Coupe"],
    ["Quattroporte", "Sedan"],
    ["Spyder", "Convertible"],
  ]),
  listed("Maybach", false, [
    ["57", "Sedan"],
    ["62", "Sedan"],
  ], []),
  listed("McLaren", false, [
    ["Artura", "Coupe"],
    ["750S", "Coupe"],
    ["GT", "Coupe"],
  ], [
    ["12C", "Coupe"],
    ["570S", "Coupe"],
    ["650S", "Coupe"],
    ["720S", "Coupe"],
    ["P1", "Coupe"],
    ["Senna", "Coupe"],
  ]),
  listed("Mini", false, [
    ["Cooper", "Hatchback", ["Cooper S"]],
    ["Countryman", "SUV"],
    ["Clubman", "S. Wagon"],
  ], [
    ["Cooper Convertible", "Convertible"],
    ["Paceman", "SUV"],
  ]),
  listed("Plymouth", false, [
    ["Voyager", "Van"],
    ["Neon", "Sedan"],
    ["Acclaim", "Sedan"],
  ], [
    ["Breeze", "Sedan"],
    ["Caravelle", "Sedan"],
    ["Colt", "Hatchback"],
    ["Gran Fury", "Sedan"],
    ["Grand Voyager", "Van"],
    ["Horizon", "Hatchback"],
    ["Laser", "Coupe"],
    ["Prowler", "Convertible"],
    ["Reliant", "Sedan"],
    ["Sundance", "Hatchback"],
    ["Turismo", "Hatchback"],
  ]),
  listed("Polestar", false, [
    ["Polestar 2", "Sedan"],
    ["Polestar 3", "SUV"],
    ["Polestar 4", "SUV"],
  ], [
    ["Polestar 1", "Coupe"],
  ]),
  listed("Rivian", false, [
    ["R1S", "SUV"],
    ["R1T", "Pickup"],
    ["R2", "SUV"],
  ], []),
  listed("Rolls-Royce", false, [
    ["Cullinan", "SUV"],
    ["Ghost", "Sedan"],
    ["Phantom", "Sedan"],
  ], [
    ["Corniche", "Convertible"],
    ["Dawn", "Convertible"],
    ["Silver Seraph", "Sedan"],
    ["Silver Spirit", "Sedan", ["Silver Spur"]],
    ["Spectre", "Sedan"],
    ["Wraith", "Coupe"],
  ]),
  listed("Saab", false, [
    ["9-3", "Sedan"],
    ["9-5", "Sedan"],
    ["900", "Hatchback"],
  ], [
    ["9-2X", "S. Wagon"],
    ["9-4X", "SUV"],
    ["9-7X", "SUV"],
    ["9000", "Sedan"],
  ]),
  listed("Scion", false, [
    ["xB", "Hatchback"],
    ["tC", "Coupe"],
    ["FR-S", "Coupe"],
  ], [
    ["iA", "Sedan"],
    ["iM", "Hatchback"],
    ["iQ", "Hatchback"],
    ["xA", "Hatchback"],
    ["xD", "Hatchback"],
  ]),
  listed("Smart", false, [
    ["Fortwo", "Coupe"],
    ["Fortwo Cabrio", "Convertible"],
  ], []),
  listed("Suzuki", false, [
    ["Grand Vitara", "SUV"],
    ["SX4", "Sedan"],
    ["XL7", "SUV"],
  ], [
    ["Aerio", "Sedan"],
    ["Equator", "Pickup"],
    ["Esteem", "Sedan"],
    ["Forenza", "Sedan"],
    ["Kizashi", "Sedan"],
    ["Reno", "Hatchback"],
    ["Samurai", "SUV"],
    ["Sidekick", "SUV"],
    ["Swift", "Hatchback"],
    ["Verona", "Sedan"],
    ["Vitara", "SUV"],
    ["X-90", "SUV"],
  ]),
];

function checkCatalog(makes: readonly MajorMake[]): void {
  const seenMakes = new Set<string>();
  const major = new Set<string>();
  for (const make of makes) {
    const makeKey = catalogKey(make.name);
    if (seenMakes.has(makeKey)) throw new Error(`duplicate make ${make.name}`);
    seenMakes.add(makeKey);
    if (make.major) major.add(make.name);
    const modelNames = new Map<string, string>();
    for (const model of make.models) {
      const key = catalogKey(model.name);
      if (!key) throw new Error(`${make.name} has an empty model`);
      if (modelNames.has(key)) throw new Error(`${make.name} lists ${model.name} twice`);
      modelNames.set(key, model.name);
    }
    const aliasOwner = new Map<string, string>();
    for (const model of make.models) {
      for (const alias of model.aliases ?? []) {
        const key = catalogKey(alias);
        if (!key) throw new Error(`${make.name} ${model.name} has an empty alias`);
        const modelOwner = modelNames.get(key);
        if (modelOwner && modelOwner !== model.name) {
          throw new Error(`${make.name} alias ${alias} of ${model.name} matches model ${modelOwner}`);
        }
        const prior = aliasOwner.get(key);
        if (prior && prior !== model.name) throw new Error(`${make.name} alias ${alias} is used by ${prior} and ${model.name}`);
        aliasOwner.set(key, model.name);
      }
    }
    if (make.major && make.models.length < 3) throw new Error(`${make.name} needs at least 3 models`);
  }
  for (const name of DEFAULT_MAKE_ORDER) {
    if (!major.has(name)) throw new Error(`${name} is in the default order but is not a default make`);
  }
  for (const name of major) {
    if (!DEFAULT_MAKE_ORDER.includes(name as (typeof DEFAULT_MAKE_ORDER)[number])) {
      throw new Error(`${name} is a default make but is missing from the default order`);
    }
  }
}

checkCatalog(MAJOR_MAKES);

const makeByKey = new Map<string, MajorMake>();
const typeByMake = new Map<string, Map<string, ModelType>>();
for (const make of MAJOR_MAKES) {
  const key = catalogKey(make.name);
  makeByKey.set(key, make);
  const types = new Map<string, ModelType>();
  for (const model of make.models) types.set(catalogKey(model.name), model.type);
  for (const model of make.models) {
    for (const alias of model.aliases ?? []) {
      const aliasKey = catalogKey(alias);
      if (aliasKey && !types.has(aliasKey)) types.set(aliasKey, model.type);
    }
  }
  typeByMake.set(key, types);
}

export const MAJOR_MAKE_NAMES: string[] = mergeCatalogNames(MAJOR_MAKES.map(make => make.name));

/** True only for the short default list. Other curated makes are found by typing. */
export function isMajorMake(name: string): boolean {
  return makeByKey.get(catalogKey(name))?.major === true;
}

/** Full list: curated spelling first, then every other known name, then office-typed names. */
export function annotateMakes(knownNames: string[], customNames: string[] = []): ListedMake[] {
  const customKeys = new Set(customNames.map(catalogKey).filter(Boolean));
  return mergeCatalogNames(MAJOR_MAKE_NAMES, knownNames, customNames).map(name => ({
    name,
    major: isMajorMake(name),
    custom: customKeys.has(catalogKey(name)),
  }));
}

/** Nothing typed: best sellers, then the rest of the default list, then office-typed makes. */
export function defaultMakeOptions(makes: ListedMake[]): string[] {
  const byKey = new Map(makes.map(make => [catalogKey(make.name), make]));
  const ordered: string[] = [];
  const used = new Set<string>();
  for (const name of DEFAULT_MAKE_ORDER) {
    const row = byKey.get(catalogKey(name));
    const key = catalogKey(name);
    if (!row || used.has(key) || (!row.major && !row.custom)) continue;
    ordered.push(row.name);
    used.add(key);
  }
  const customs = makes
    .filter(make => make.custom && !used.has(catalogKey(make.name)))
    .map(make => make.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  return [...ordered, ...customs];
}

/**
 * Year and Type boxes use this. It keeps names that start with the typed letters.
 * A blank query returns the list in its current order (years stay newest-first).
 */
export function filterByPrefix(options: readonly string[], query: string): string[] {
  const q = query.trim();
  if (!q) return [...options];
  return options.filter(name => nameStartsWith(name, q));
}

function matchRank(labels: readonly string[], queryKey: string): number {
  if (!queryKey) return 0;
  let rank = -1;
  for (const label of labels) {
    const key = catalogKey(label);
    if (!key) continue;
    if (key.startsWith(queryKey)) return 0;
    if (rank < 0 && key.includes(queryKey)) rank = 1;
  }
  return rank;
}

function rankNames(entries: readonly { name: string; labels: readonly string[] }[], query: string): string[] {
  const queryKey = catalogKey(query);
  const scored: { name: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = catalogKey(entry.name);
    if (!key || seen.has(key)) continue;
    const rank = matchRank(entry.labels, queryKey);
    if (rank < 0) continue;
    seen.add(key);
    scored.push({ name: entry.name, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return scored.map(item => item.name);
}

/** Empty query = the default list. Typed letters match anywhere, starts-with first. */
export function suggestMakes(makes: ListedMake[], query: string): string[] {
  const q = query.trim();
  if (!q) return defaultMakeOptions(makes);
  return rankNames(makes.map(make => ({ name: make.name, labels: [make.name] })), q);
}

export function modelsForMake(make: string): string[] {
  return makeByKey.get(catalogKey(make))?.models.map(model => model.name) ?? [];
}

export function suggestModels(input: { make: string; query: string; catalogModels?: string[]; customModels?: string[] }): string[] {
  const curated = makeByKey.get(catalogKey(input.make))?.models ?? [];
  const customs = input.customModels ?? [];
  const extra = input.catalogModels ?? [];
  const q = input.query.trim();
  if (!q) {
    if (curated.length) {
      const names = curated.map(model => model.name);
      const more = mergeCatalogNames(customs).filter(name => !names.some(item => catalogKey(item) === catalogKey(name)));
      return [...names, ...more];
    }
    return mergeCatalogNames(extra, customs);
  }
  const hidden = new Set<string>();
  for (const model of curated) {
    hidden.add(catalogKey(model.name));
    for (const alias of model.aliases ?? []) hidden.add(catalogKey(alias));
  }
  return rankNames([
    ...curated.map(model => ({ name: model.name, labels: [model.name, ...(model.aliases ?? [])] })),
    ...[...extra, ...customs]
      .filter(name => !hidden.has(catalogKey(name)))
      .map(name => ({ name, labels: [name] })),
  ], q);
}

/** Type stored for this make and model, including a hidden alias, or "" when the pair is not listed. */
export function defaultTypeFor(make: string, model: string): string {
  return typeByMake.get(catalogKey(make))?.get(catalogKey(model)) ?? "";
}

/** When the chosen make and model are in the list, fill the type. A hand-typed pair is left alone. */
export function withKnownType(current: { make: string; model: string }, patch: { make?: string; model?: string }): { make?: string; model?: string; vehicle_type?: string } {
  const make = patch.make ?? current.make;
  const model = patch.model ?? current.model;
  const type = defaultTypeFor(make, model);
  return type ? { ...patch, vehicle_type: type } : patch;
}

/** True when the name itself starts with what was typed. "M" matches Mazda, not Ram. */
export function nameStartsWith(name: string, query: string): boolean {
  const q = catalogKey(query);
  if (!q) return true;
  return catalogKey(name).startsWith(q);
}
