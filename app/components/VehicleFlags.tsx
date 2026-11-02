/** FLEX / ASAP / INOP / Enclosed / EXPEDITED chips. Same chip, different colors so several can show on one vehicle.
 * INOP is red. INOP = the vehicle's Run is No (is_running false); Enclosed = is_enclosed.
 * All chips sit together in one row that never wraps (same look, same row when several are on). */
export default function VehicleFlags({ flex, asap, inop, enclosed, expedited, expeditedTestId = "vehicle-expedited-tag", flexTestId = "vehicle-flex-tag", asapTestId = "vehicle-asap-tag", inopTestId = "vehicle-inop-tag", enclosedTestId = "vehicle-enclosed-tag" }: {
  flex?: boolean;
  asap?: boolean;
  inop?: boolean;
  enclosed?: boolean;
  expedited?: boolean;
  expeditedTestId?: string;
  flexTestId?: string;
  asapTestId?: string;
  inopTestId?: string;
  enclosedTestId?: string;
}) {
  if (!flex && !asap && !inop && !enclosed && !expedited) return null;
  return (
    <span className="veh-flag-row" data-testid="vehicle-flag-row">
      {flex && <span className="flex-tag" data-testid={flexTestId}>FLEX</span>}
      {asap && <span className="flex-tag asap-tag" data-testid={asapTestId}>ASAP</span>}
      {inop && <span className="flex-tag inop-tag" data-testid={inopTestId}>INOP</span>}
      {enclosed && <span className="flex-tag enclosed-tag" data-testid={enclosedTestId}>Enclosed</span>}
      {expedited && <span className="flex-tag asap-tag expedited-tag" data-testid={expeditedTestId}>EXPEDITED</span>}
    </span>
  );
}
