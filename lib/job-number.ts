/** Job numbers are 'FB' + a number from public.job_number_seq (first job FB400001; grows past 999999). */
export const JOB_PREFIX = "FB";
export const JOB_NUMBER_RE = /^FB\d{4,12}$/;

/** "FB400001", "fb 400001" or "400001" -> "FB400001"; anything else -> "". */
export function normalizeJobNumber(input: string): string {
  const m = /^\s*(?:fb)?\s*-?\s*(\d{4,12})\s*$/i.exec(String(input || ""));
  return m ? `${JOB_PREFIX}${m[1]}` : "";
}
