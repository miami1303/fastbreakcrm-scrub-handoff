import test from "node:test";
import assert from "node:assert/strict";
import { VEHICLE_TYPES as FORM_TYPES, yearOptions } from "../lib/vehicle-fields.ts";
import { VEHICLE_TYPES as CATALOG_TYPES } from "../lib/vehicle-catalog/constants.ts";
import {
  DEFAULT_MAKE_ORDER,
  MAJOR_MAKES,
  MAJOR_MAKE_NAMES,
  MODEL_TYPES,
  annotateMakes,
  defaultMakeOptions,
  defaultTypeFor,
  filterByPrefix,
  modelsForMake,
  nameStartsWith,
  suggestMakes,
  suggestModels,
  withKnownType,
} from "../lib/vehicle-catalog/major-makes.ts";

const REMOVED = [
  "Airstream", "Winnebago", "Thor", "Jayco", "Keystone", "Forest River", "Tiffin", "Coachmen", "Fleetwood", "Newmar", "Grand Design",
  "Harley-Davidson", "Ducati", "Indian", "Kawasaki", "KTM", "Polaris", "Yamaha", "Can-Am", "Arctic Cat", "Club Car", "E-Z-GO", "Triumph",
  "Sea Ray", "Sea-Doo", "Bayliner", "Boston Whaler", "MasterCraft",
  "Freightliner", "Kenworth", "Peterbilt", "Hino", "International", "Mack", "Western Star",
];

const MUST = {
  Ford: ["F-150", "F-250", "F-350", "F-450", "F-550", "Ranger", "Explorer", "Escape", "Bronco", "Mustang", "Edge", "Expedition", "Maverick", "Transit", "F-150 Lightning", "Mustang Mach-E", "Flex", "GT"],
  Chevrolet: ["Silverado 1500", "Silverado 2500HD", "Silverado 3500HD", "Equinox", "Malibu", "Tahoe", "Suburban", "Traverse", "Colorado", "Camaro", "Corvette", "Silverado EV", "Equinox EV", "Blazer EV", "Bolt", "Bolt EUV", "Volt", "Avalanche", "HHR", "SS", "Cobalt"],
  GMC: ["Sierra 1500", "Sierra 2500HD", "Yukon", "Acadia", "Terrain", "Sierra EV", "Envoy", "Jimmy", "Hummer EV Pickup", "Hummer EV SUV"],
  Ram: ["1500", "2500", "3500", "4500", "5500", "Dakota", "Rampage"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X", "Semi", "Roadster"],
  Toyota: ["Camry", "Corolla", "RAV4", "Tacoma", "Tundra", "Highlander", "4Runner", "Sienna", "Prius", "Crown", "Yaris", "GR Corolla", "Matrix"],
  Honda: ["Accord", "Civic", "CR-V", "Pilot", "Odyssey", "Ridgeline", "Prologue", "Element", "Clarity", "CR-Z", "S2000", "Crosstour"],
  Hyundai: ["Elantra", "Sonata", "Tucson", "Santa Fe", "Ioniq 6", "Ioniq 9", "Veloster", "Nexo", "Genesis Coupe"],
  Kia: ["Sorento", "Sportage", "Telluride", "Forte", "K5", "Niro", "Optima", "Sedona", "Cadenza"],
  Mazda: ["CX-5", "Mazda3", "CX-50", "CX-90", "CX-9", "CX-3", "CX-7", "CX-60", "Mazda2", "RX-8", "MX-30"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Gladiator", "Liberty", "Patriot", "Commander", "Recon"],
  Dodge: ["Charger", "Challenger", "Durango", "Grand Caravan", "Dart", "Avenger", "Nitro", "Caliber", "Viper", "Magnum", "Caravan"],
  Nissan: ["Altima", "Rogue", "Sentra", "Frontier", "Titan", "Pathfinder", "Juke", "Z", "GT-R", "Xterra", "Quest", "Rogue Sport"],
  Cadillac: ["Escalade", "XT5", "CT5", "ATS", "CTS", "XTS", "SRX", "Optiq", "Vistiq", "Escalade IQ"],
  Lincoln: ["Navigator", "Aviator", "Corsair", "Nautilus", "MKC", "MKX", "Town Car"],
  Audi: ["A4", "Q5", "A6", "Q7", "R8", "Q4 e-tron", "Q6 e-tron", "e-tron GT", "allroad"],
  Volkswagen: ["Jetta", "Tiguan", "Atlas", "Golf", "GTI", "ID.Buzz", "Touareg", "Beetle"],
  BMW: ["3 Series", "X5", "X3", "5 Series", "X1", "1 Series", "6 Series", "X2", "X4", "X6", "i3", "i5", "i7", "XM"],
  "Mercedes-Benz": ["C-Class", "E-Class", "GLE", "GLC", "S-Class", "AMG GT", "SL", "SLC", "EQB", "EQE", "EQS", "GLK", "ML", "Maybach S-Class"],
  Subaru: ["Outback", "Forester", "Crosstrek", "Tribeca", "Baja"],
  "Land Rover": ["Range Rover", "Defender", "Discovery", "LR2", "LR3", "LR4"],
  Lexus: ["RX", "ES", "NX", "CT", "LC", "SC"],
  Porsche: ["Cayenne", "Macan", "911", "Carrera GT"],
  Acura: ["MDX", "RDX", "TLX", "TL", "TSX", "RLX", "ZDX", "RSX"],
  Buick: ["Encore", "Enclave", "Envision", "Verano", "Regal", "Envista", "Lucerne"],
  Volvo: ["XC90", "XC60", "S60", "C40", "V70", "XC70", "S80"],
  Chrysler: ["Pacifica", "300", "Voyager", "Town & Country", "Sebring", "PT Cruiser"],
};

test("default make list is the short passenger list, best sellers first, and hides the rest until typed", () => {
  const known = ["Toyota", "Zimmer", "Proton", "Mahindra", "BMW", "FORD", "Saab"];
  const makes = annotateMakes(known, ["Office Special"]);
  assert.equal(makes.find(make => make.name === "Toyota")?.major, true);
  assert.equal(makes.find(make => make.name === "Saab")?.major, false);
  assert.equal(makes.find(make => make.name === "Zimmer")?.major, false);
  assert.equal(makes.find(make => make.name === "Proton")?.major, false);
  assert.equal(makes.find(make => make.name === "Office Special")?.custom, true);
  assert.equal(makes.find(make => make.name === "Office Special")?.major, false);

  const defaults = defaultMakeOptions(annotateMakes([]));
  assert.deepEqual(defaults, [...DEFAULT_MAKE_ORDER]);
  assert.equal(defaults.includes("Pontiac") && defaults.includes("Saturn") && defaults.includes("Oldsmobile") && defaults.includes("Mercury"), true);
  for (const name of ["Zimmer", "Proton", "Mahindra", "Holden", "Lada", "Saab"]) {
    assert.equal(defaults.includes(name), false, `${name} stays off the default list`);
  }
  assert.equal(MAJOR_MAKE_NAMES.includes("Saab"), true, "Saab stays searchable when typed");
  for (const name of REMOVED) {
    assert.equal(defaults.includes(name), false, `${name} stays off the default list`);
    assert.equal(MAJOR_MAKE_NAMES.includes(name), false, `${name} is not a curated make`);
  }

  const withObscure = annotateMakes(["Zimmer", "Mahindra", "Proton"], ["Alpha Custom", "Office Special"]);
  const open = suggestMakes(withObscure, "");
  assert.deepEqual(open.slice(0, DEFAULT_MAKE_ORDER.length), [...DEFAULT_MAKE_ORDER]);
  assert.deepEqual(open.slice(DEFAULT_MAKE_ORDER.length), ["Alpha Custom", "Office Special"]);
  assert.equal(open.includes("Zimmer"), false);
  assert.equal(open.includes("Ram") && nameStartsWith("Ram", "M"), false);

  const typedM = suggestMakes(withObscure, "M");
  assert.ok(typedM.includes("Mazda") && typedM.includes("Mercedes-Benz") && typedM.includes("Mini") && typedM.includes("Mercury"));
  assert.ok(typedM.includes("Mahindra"), "obscure makes appear once the letters match");
  assert.equal(nameStartsWith("Zimmer", "M"), false);
  assert.ok(typedM.indexOf("Mazda") < typedM.indexOf("Zimmer"), "a letter inside Zimmer ranks after names that start with M");
  const prefix = typedM.filter(name => nameStartsWith(name, "M"));
  const rest = typedM.filter(name => !nameStartsWith(name, "M"));
  assert.deepEqual(typedM, [...prefix, ...rest]);
  assert.ok(rest.includes("Ram") && rest.includes("BMW") && rest.includes("GMC"));
  assert.ok(prefix.indexOf("Mazda") < rest.indexOf("Ram"));
  assert.deepEqual(suggestMakes(withObscure, "zi"), ["Zimmer"]);
  assert.deepEqual(suggestMakes(withObscure, "Me").slice(0, 2), ["Mercedes-Benz", "Mercury"]);
  assert.deepEqual(suggestMakes(withObscure, "merc"), ["Mercedes-Benz", "Mercury"]);
  assert.deepEqual(suggestMakes(annotateMakes([]), "saab"), ["Saab"]);
});

test("each default make has its models, and a letter can match anywhere in the model name", () => {
  const seen = new Set();
  for (const make of MAJOR_MAKES) {
    const key = make.name.toLowerCase();
    assert.equal(seen.has(key), false, `duplicate make ${make.name}`);
    seen.add(key);
    assert.equal(make.major, DEFAULT_MAKE_ORDER.includes(make.name));
    if (make.major) assert.ok(make.models.length >= 3, `${make.name} has at least 3 models`);
    else assert.ok(make.models.length > 0, `${make.name} has models`);
    const models = new Set();
    for (const model of make.models) {
      const modelKey = model.name.toLowerCase();
      assert.equal(models.has(modelKey), false, `${make.name} lists ${model.name} twice`);
      models.add(modelKey);
      assert.ok(MODEL_TYPES.includes(model.type), `${make.name} ${model.name} type ${model.type}`);
      for (const alias of model.aliases ?? []) {
        assert.equal(alias.toLowerCase() === model.name.toLowerCase(), false);
      }
    }
  }
  for (const [make, models] of Object.entries(MUST)) {
    const have = modelsForMake(make);
    for (const model of models) assert.ok(have.includes(model), `${make} ${model}`);
  }
  assert.equal(modelsForMake("Kia").includes("Sorano"), false);
  assert.equal(modelsForMake("Audi").includes("A1"), false);
  assert.equal(modelsForMake("BMW").includes("330i"), false);
  assert.equal(modelsForMake("Honda").includes("Gold Wing"), false);
  assert.deepEqual(modelsForMake("Ford").slice(0, 13), ["F-150", "F-250", "F-350", "F-450", "Ranger", "Explorer", "Escape", "Bronco", "Mustang", "Edge", "Expedition", "Maverick", "Transit"]);
  assert.deepEqual(modelsForMake("Chevrolet").slice(0, 4), ["Silverado 1500", "Silverado 2500HD", "Silverado 3500HD", "Equinox"]);
  assert.deepEqual(modelsForMake("Toyota").slice(0, 4), ["Camry", "Corolla", "RAV4", "Tacoma"]);

  const ford = suggestModels({ make: "Ford", query: "", catalogModels: ["F-53", "Mustang"], customModels: ["Shop Truck"] });
  assert.equal(ford[0], "F-150");
  assert.ok(ford.includes("F-150") && ford.includes("Mustang") && ford.includes("Shop Truck"));
  assert.equal(ford.at(-1), "Shop Truck");
  assert.equal(ford.includes("F-53"), false, "extra catalog models wait until the letters match");
  const f = suggestModels({ make: "ford", query: "f", catalogModels: ["F-53"], customModels: [] });
  assert.ok(f.includes("F-150") && f.includes("F-250") && f.includes("Fusion") && f.includes("F-53"));
  assert.equal(f.includes("Mustang"), false);
  assert.deepEqual(suggestModels({ make: "Zimmer", query: "", catalogModels: ["Golden Spirit"], customModels: ["Custom"] }), ["Custom", "Golden Spirit"]);
});

test("type-ahead keeps a prefix match ahead of a match later in the name", () => {
  const names = ["Mazda", "Mercedes-Benz", "Mini", "Ram", "BMW"];
  assert.deepEqual(filterByPrefix(names, ""), names);
  assert.deepEqual(filterByPrefix(names, "   "), names);
  assert.deepEqual(filterByPrefix(names, "M"), ["Mazda", "Mercedes-Benz", "Mini"]);
  assert.deepEqual(filterByPrefix(names, "Me"), ["Mercedes-Benz"]);
  assert.deepEqual(filterByPrefix(names, "me"), ["Mercedes-Benz"]);
  assert.deepEqual(filterByPrefix(names, "R"), ["Ram"]);
  assert.deepEqual(filterByPrefix(names, "X"), []);
  assert.deepEqual(filterByPrefix(["Mini", "Mazda"], "M"), ["Mini", "Mazda"], "order of the source list is kept");

  const years = yearOptions("2026-10-23");
  const twenties = filterByPrefix(years, "20");
  assert.equal(twenties[0], "2027");
  assert.ok(twenties.every(year => year.startsWith("20")));
  assert.equal(twenties.includes("1999"), false);
  assert.deepEqual(filterByPrefix(years, "195"), ["1959", "1958", "1957", "1956", "1955", "1954", "1953", "1952", "1951", "1950"]);

  assert.deepEqual(filterByPrefix([...FORM_TYPES], "S"), ["Sedan", "SUV"]);
  assert.deepEqual(filterByPrefix([...FORM_TYPES], "Su"), ["SUV"]);
  assert.deepEqual(filterByPrefix([...FORM_TYPES], "Se"), ["Sedan"]);
  assert.deepEqual(filterByPrefix([...FORM_TYPES], "V"), ["Van"]);
  assert.deepEqual(filterByPrefix([...FORM_TYPES, "Motorcycle"], "Mo"), ["Motorcycle"]);

  const makes = annotateMakes(["Zimmer", "Mahindra"], ["Office Special"]);
  const typedM = suggestMakes(makes, "M");
  assert.ok(typedM.includes("Mazda") && typedM.includes("Mercedes-Benz") && typedM.includes("Mini") && typedM.includes("Mahindra"));
  assert.equal(nameStartsWith("Ram", "M"), false);
  assert.ok(typedM.indexOf("Mazda") < typedM.indexOf("Ram"));
  assert.deepEqual(suggestMakes(makes, "Me").slice(0, 2), ["Mercedes-Benz", "Mercury"]);
  const ford = suggestModels({ make: "Ford", query: "f", catalogModels: ["F-53"], customModels: ["Shop Truck"] });
  assert.ok(ford.includes("F-150") && ford.includes("Fusion"));
  assert.equal(ford.includes("Mustang"), false);
  assert.deepEqual(suggestModels({ make: "Ford", query: "mu", catalogModels: [], customModels: [] }), ["Mustang", "Mustang Mach-E"]);
  assert.deepEqual(suggestModels({ make: "Ford", query: "Lightning", catalogModels: [], customModels: [] }), ["F-150 Lightning"]);
  assert.deepEqual(suggestModels({ make: "Ford", query: "150", catalogModels: [], customModels: [] }), ["E-150", "F-150", "F-150 Lightning"]);
  assert.equal(suggestModels({ make: "BMW", query: "330" })[0], "3 Series");
  assert.equal(suggestModels({ make: "BMW", query: "335" })[0], "3 Series");
  assert.equal(suggestModels({ make: "Mercedes-Benz", query: "C300" })[0], "C-Class");
  assert.equal(suggestModels({ make: "Mercedes-Benz", query: "E350" })[0], "E-Class");
  assert.equal(suggestModels({ make: "Mercedes-Benz", query: "S550" })[0], "S-Class");
  assert.equal(suggestModels({ make: "Lexus", query: "ES350" })[0], "ES");
  assert.equal(suggestModels({ make: "Subaru", query: "xv" })[0], "Crosstrek");
});

test("choosing a make and model fills the type, and a hand-typed pair does not", () => {
  assert.equal(defaultTypeFor("Toyota", "Camry"), "Sedan");
  assert.equal(defaultTypeFor("Toyota", "rav4"), "SUV");
  assert.equal(defaultTypeFor("Honda", "CR-V"), "SUV");
  assert.equal(defaultTypeFor("Ford", "F-150"), "Pickup");
  assert.equal(defaultTypeFor("Honda", "Odyssey"), "Van");
  assert.equal(defaultTypeFor("Chevrolet", "Bolt"), "Hatchback");
  assert.equal(defaultTypeFor("GMC", "Hummer EV SUV"), "SUV");
  assert.equal(defaultTypeFor("GMC", "Hummer EV Pickup"), "Pickup");
  assert.equal(defaultTypeFor("Ford", "F-150 Lightning"), "Pickup");
  assert.equal(defaultTypeFor("Ford", "Mustang Mach-E"), "SUV");
  assert.equal(defaultTypeFor("BMW", "330i"), "Sedan");
  assert.equal(defaultTypeFor("BMW", "M3"), "Sedan");
  assert.equal(defaultTypeFor("Mercedes-Benz", "C300"), "Sedan");
  assert.equal(defaultTypeFor("Mercedes-Benz", "E350"), "Sedan");
  assert.equal(defaultTypeFor("Mercedes-Benz", "S550"), "Sedan");
  assert.equal(defaultTypeFor("Lexus", "ES350"), "Sedan");
  assert.equal(defaultTypeFor("Airstream", "Flying Cloud"), "");
  assert.equal(defaultTypeFor("Harley-Davidson", "Sportster"), "");
  assert.equal(defaultTypeFor("Freightliner", "Cascadia"), "");
  assert.equal(defaultTypeFor("Toyota", "Not A Model"), "");
  assert.equal(defaultTypeFor("Zimmer", "Golden Spirit"), "");
  assert.equal(modelsForMake("Toyota").includes("RAV4"), true);
  assert.deepEqual(withKnownType({ make: "Toyota", model: "", vehicle_type: "Sedan" }, { model: "RAV4" }).vehicle_type, "SUV");
  assert.equal("vehicle_type" in withKnownType({ make: "Zimmer", model: "", vehicle_type: "Coupe" }, { model: "Golden Spirit" }), false);
  assert.equal("vehicle_type" in withKnownType({ make: "Harley-Davidson", model: "", vehicle_type: "Motorcycle" }, { model: "VL" }), false);
  assert.deepEqual([...FORM_TYPES], ["Sedan", "SUV", "Pickup", "Van", "Trailer", "ATV", "Golf Cart"]);
  assert.equal(CATALOG_TYPES.includes("Crossover"), true, "catalog list still mentions Crossover; it is not a form choice");
  assert.equal(FORM_TYPES.includes("Crossover"), false);
});
