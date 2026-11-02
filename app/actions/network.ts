"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NETWORK_COOKIE, networkSecret, signNetworkToken } from "@/lib/network-gate";
import { checkNetworkCredentials, clearFailures, rateLimited, recordFailure } from "@/lib/network-auth";

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Network Login: company Network ID + Network Password, then User Login. */
export async function enterNetwork(formData: FormData) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  if (rateLimited(ip)) { await pause(800); redirect("/?error=locked"); }
  const id = String(formData.get("network_id") || "").slice(0, 200);
  const password = String(formData.get("network_password") || "").slice(0, 500);
  if (!id.trim() || !password) redirect("/?error=missing");
  const result = checkNetworkCredentials(id, password);
  const secret = networkSecret();
  if (result === "not_configured" || !secret) redirect("/?error=configuration");
  if (result !== "ok") {
    recordFailure(ip);
    await pause(600);
    redirect("/?error=credentials");
  }
  clearFailures(ip);
  (await cookies()).set(NETWORK_COOKIE, await signNetworkToken(secret), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
  });
  redirect("/user-login");
}
