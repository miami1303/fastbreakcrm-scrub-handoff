/**
 * Reusable vehicle catalog.
 *
 * Another CRM can copy `lib/vehicle-catalog` and call these functions.
 * Saving office-typed names is the host app's job (this CRM uses
 * `intake_vehicle_customs`). Looking up a name must never throw; a failure
 * is an empty list so the person can type the vehicle and continue.
 */

export {
  FALLBACK_MAKES,
  NHTSA_MAKE_TYPE_SLUGS,
  VEHICLE_TYPES,
  VEHICLE_YEAR_MIN,
  isListedVehicleYear,
  vehicleYearMax,
  vehicleYearOptions,
} from "./constants";
export {
  catalogHas,
  catalogKey,
  customItemsToStore,
  mergeCatalogNames,
  readNhtsaMakeNames,
  readNhtsaModelNames,
  sanitizeCustomItem,
  titleCaseCatalogName,
  type CatalogCustomItem,
  type CatalogCustomKind,
  type TypedVehicleNames,
} from "./names";
export {
  DEFAULT_MAKE_ORDER,
  MAJOR_MAKES,
  MAJOR_MAKE_NAMES,
  MODEL_TYPES,
  annotateMakes,
  defaultMakeOptions,
  defaultTypeFor,
  filterByPrefix,
  isMajorMake,
  modelsForMake,
  nameStartsWith,
  suggestMakes,
  suggestModels,
  withKnownType,
  type CatalogModel,
  type ListedMake,
  type MajorMake,
  type ModelType,
} from "./major-makes";
export { getNhtsaMakes, getNhtsaModels, type NhtsaList } from "./nhtsa";
