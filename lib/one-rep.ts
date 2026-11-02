/**
 * A lead belongs to one representative. assigned_rep_id is that rep.
 * owner_id is that same person's login, so their Follow-Up Menu is the only one that lists it.
 * Assignment does not set a priority. A new lead stays blank until someone picks a label.
 * Changing the user on a lead that already has a status keeps its priority (this patch omits it).
 */
export function oneRepPatch(
  rep: { id: string; userId: string },
  status: string,
): { assigned_rep_id: string; owner_id: string; status?: "draft" } {
  const patch: { assigned_rep_id: string; owner_id: string; status?: "draft" } = {
    assigned_rep_id: rep.id,
    owner_id: rep.userId,
  };
  if (status === "unassigned") patch.status = "draft";
  return patch;
}
