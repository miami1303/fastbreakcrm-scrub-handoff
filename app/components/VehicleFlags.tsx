/** ASAP / INOP / Enclosed / EXPEDITED chips. Same chip, different colors so several can show on one vehicle.
 * INOP is red. INOP = the vehicle's Run is No (is_running false); Enclosed = is_enclosed.
 * All chips sit together in one row that never wraps (same look, same row when several are on). */
export default function VehicleFlags({ asap, inop, enclosed, expedited, expeditedTestId = "vehicle-expedited-tag", asapTestId = "vehicle-asap-tag", inopTestId = "vehicle-inop-tag", enclosedTestId = "vehicle-enclosed-tag" }: {
  asap?: boolean;
  inop?: boolean;
  enclosed?: boolean;
  expedited?: boolean;
  expeditedTestId?: string;
  asapTestId?: string;
  inopTestId?: string;
  enclosedTestId?: string;
}) {
  if (!asap && !inop && !enclosed && !expedited) return null;
  return (
    <span className="veh-flag-row" data-testid="vehicle-flag-row">
      {asap && <span className="veh-tag asap-tag" data-testid={asapTestId}>ASAP</span>}
      {inop && <span className="veh-tag inop-tag" data-testid={inopTestId}>INOP</span>}
      {enclosed && <span className="veh-tag enclosed-tag" data-testid={enclosedTestId}>Enclosed</span>}
      {expedited && <span className="veh-tag asap-tag expedited-tag" data-testid={expeditedTestId}>EXPEDITED</span>}
    </span>
  );
}
