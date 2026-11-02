import { formatCentsComma as formatCents } from "@/lib/money";
import type { VehiclePriceCell } from "@/lib/pricing";

/** One vehicle row's Price cell (see vehiclePriceCell in lib/pricing.ts). */
export default function VehiclePrice({ cell }: { cell: VehiclePriceCell }) {
  if (cell.kind === "own") return <span data-testid="veh-price-cell" data-kind="own">{formatCents(cell.cents)}</span>;
  if (cell.kind === "total") return <span data-testid="veh-price-cell" data-kind="total" title="Job Total (Deposit + Carrier COD + extra charges)">{formatCents(cell.cents)}</span>;
  if (cell.kind === "inTotal") return <span className="muted" data-testid="veh-price-cell" data-kind="inTotal" title="Included in the job Total">in Total</span>;
  return <span className="pending" data-testid="veh-price-cell" data-kind="pending">price pending</span>;
}
