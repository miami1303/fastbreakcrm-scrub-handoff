"use client";

// Make / model box: pick from the list or type a missing name.
// Nothing typed shows the short passenger-make list (and that make's models,
// best sellers first). Typed letters match anywhere in a name, with names that
// start with those letters first, including obscure makes. A failed list never
// disables the box. Typed names are remembered for next time.
import { useEffect, useState } from "react";
import { annotateMakes, modelsForMake, suggestMakes, suggestModels, type ListedMake } from "@/lib/vehicle-catalog/major-makes";
import { catalogHas } from "@/lib/vehicle-catalog/names";
import { VEHICLE_TYPES } from "@/lib/vehicle-fields";
import { CatalogCombobox } from "./CatalogCombobox";

type MakeCatalog = { source: string; makes: ListedMake[]; customTypes: string[] };

let makesRequest: Promise<MakeCatalog> | null = null;

function loadMakeCatalog(): Promise<MakeCatalog> {
  if (!makesRequest) {
    makesRequest = fetch("/api/vehicle-catalog/makes")
      .then((response) => {
        if (!response.ok) throw new Error("catalog");
        return response.json() as Promise<MakeCatalog>;
      })
      .catch(() => ({ source: "fallback", makes: annotateMakes([]), customTypes: [] }));
  }
  return makesRequest;
}

export function clearMakeCatalogCache() {
  makesRequest = null;
}

export function useCustomTypes(): string[] {
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    loadMakeCatalog().then((data) => setTypes(data.customTypes || [])).catch(() => setTypes([]));
  }, []);
  return types;
}

export async function rememberCustom(item: { kind: "make" | "model" | "type"; value: string; make?: string; year?: string }) {
  const value = item.value.trim();
  if (!value) return;
  if (item.kind === "type" && VEHICLE_TYPES.some((type) => type.toLowerCase() === value.toLowerCase())) return;
  if (item.kind === "model" && !item.make?.trim()) return;
  try {
    await fetch("/api/vehicle-catalog/customs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ kind: item.kind, value, make: item.make || "", year: item.year ? Number(item.year) : null }] }),
    });
    if (item.kind !== "model") clearMakeCatalogCache();
  } catch {
    // The vehicle can still be saved.
  }
}

export function CatalogNameInput({
  kind, value, onChange, year = "", make = "", ariaLabel, testId,
}: {
  kind: "make" | "model";
  value: string;
  onChange: (value: string) => void;
  year?: string;
  make?: string;
  ariaLabel: string;
  testId?: string;
}) {
  const [makes, setMakes] = useState<ListedMake[]>([]);
  const [modelPool, setModelPool] = useState<{ catalog: string[]; custom: string[] }>({ catalog: [], custom: [] });
  const [loaded, setLoaded] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoaded(false);
    (async () => {
      try {
        if (kind === "make") {
          const data = await loadMakeCatalog();
          if (cancel) return;
          setMakes(Array.isArray(data.makes) ? data.makes : annotateMakes([]));
          setHint(data.source === "fallback" ? "Full make list did not load. Type it if it is missing." : "");
        } else if (!make.trim()) {
          if (!cancel) { setModelPool({ catalog: [], custom: [] }); setHint(""); }
        } else {
          const query = new URLSearchParams({ make });
          if (/^\d{4}$/.test(year)) query.set("year", year);
          const response = await fetch(`/api/vehicle-catalog/models?${query}`);
          const data = await response.json() as { models?: string[]; customModels?: string[]; source?: string };
          if (cancel) return;
          setModelPool({ catalog: data.models || [], custom: data.customModels || [] });
          setHint(data.source === "unavailable" ? "Model list did not load. Type it." : "");
        }
      } catch {
        if (!cancel) {
          if (kind === "make") setMakes(annotateMakes([]));
          else setModelPool({ catalog: [], custom: [] });
          setHint("List did not load. Type it.");
        }
      } finally {
        if (!cancel) setLoaded(true);
      }
    })();
    return () => { cancel = true; };
  }, [kind, year, make]);

  const knownNames = kind === "make" ? makes.map(item => item.name) : [...modelsForMake(make), ...modelPool.catalog, ...modelPool.custom];

  function remember(typed: string) {
    if (!loaded || !typed.trim() || catalogHas(knownNames, typed)) return;
    void rememberCustom({ kind, value: typed, make, year });
  }

  return (
    <CatalogCombobox value={value} onChange={onChange} ariaLabel={ariaLabel} testId={testId} maxLength={60}
      title={hint || "Type a name if it is not listed. It is saved for next time."}
      onFinished={remember}
      getOptions={query => (kind === "make"
        ? suggestMakes(makes, query)
        : suggestModels({ make, query, catalogModels: modelPool.catalog, customModels: modelPool.custom }))} />
  );
}
