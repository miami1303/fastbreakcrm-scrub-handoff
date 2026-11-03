# Fast Break CRM — Copilot instructions (read this first)

You are working on **Fast Break CRM only**. It is a separate product from Driving America.

## Hard rules (never break)
1. **Own stack only.** Repo = Fast Break. Vercel = `fastbreakcrm23`. Supabase = Fast Break project (`fastbreakcrm` / fastbreakcrmtest@proton.me or fascrmtest23@proton.me). NEVER touch Driving America production Supabase `rdvzcryehtnkrzqnuppr`. NEVER push to Driving America CRM repos for this work.
2. **No DA IP.** Never reintroduce Driving America name, domains, emails, phones, DOT/MC, staff names (Danny/Katie/Hanna/Justin/Ghouchi), Hostinger DA mail, DA logos, DA policy/CC text, DA Zelle, or live DA Stripe/payment credentials.
3. **Do not rebuild from scratch.** The scrubbed app already exists. Pull it; then add only what is listed under "Still to build".

## Where the code already is (pull from here)

| What | Where | Tip / note |
|------|--------|------------|
| **Best full scrub (use this)** | `drivingamerica-inc/fastbreakcrm` branch `feat/full-scrub-live-da` | Tip `507feb2` — full live CRM scrubbed from DA `feat/crm-core-flow` @ `0300ae3` |
| Backup copy | `miami1303/fastbreakcrm` `main` | Tip ~`a80a02b` / `ed7cb35` — same scrub + handoff |
| Org `main` today | `drivingamerica-inc/fastbreakcrm` `main` | Tip `b513d6f` — **old bootstrap only** (Copilot PR #1). Do NOT treat main as current until scrub is merged |
| Source that was scrubbed | DA `feat/crm-core-flow` @ `0300ae3` | Reference only. Copy features from scrubbed Fast Break branches, not by re-cloning DA into Fast Break |
| Local box (Grok Bot) | `/workspace/fastbreakcrm` | Matches miami tip |

**First action every session:** check out / sync `feat/full-scrub-live-da` (or miami `main` if you cannot see the org branch). Diff against that tip. Do not start another "bootstrap CRM" PR.

## What is already built (do not redo)
- Full CRM feature set scrubbed into Fast Break: ops strip, estimate→book, email center, inbox paths, payments shell, network login, admin/supervisor/rep roles, robots/noindex.
- DA branding removed; placeholders: Fastbreak CRM, `support@fastbreakcrm.test`, `555-010-01xx`, job numbers `FB######`.
- Payments: Stripe UI only if keys set; Zelle only if `PAY_ZELLE` set; else "Payments aren't set up. Call us to enable payments." Encrypted card entry via `CARD_ENCRYPTION_KEY` kept for view/book/e-sign.
- New env placeholders: `OPS_ALERT_EMAIL`, `WEBSITE_LEAD_NOTICE_TO`.
- Lint 0 errors; unit tests ~310 pass / 7 fail (same 7 fail on DA source); production build passes with placeholder env.
- Docs: `docs/HANDOFF.md` (human handoff). This file is for you.

## What is NOT done (do these, in order)

### A. Unblock deploy (Danny / human — you cannot fake these)
1. Merge `feat/full-scrub-live-da` → org `main` (PR Submit may be waiting on Danny).
2. Grant `miami1303` Write on `drivingamerica-inc/fastbreakcrm` if still 404.
3. Connect **Fast Break** Supabase → apply `supabase/migrations` **only there**.
4. Connect Vercel project **`fastbreakcrm23`** → set env from `.env.example`.
5. Authorize ElevenLabs + HeyGen connectors for Felicia.

### B. Code you should build next
1. **Multi-tenant (required for multi-company):** `company_id` on every tenant table + RLS so each company has its own users/workspace/network login/invites. Until this ships: one deploy+DB per company.
2. **Owner console:** logins, activity, plans, dues, retention, bulk invites (5–10).
3. **Sign-up / Buy now:** packages Premium $99 / Deluxe $129, $125 to start; payment method page.
4. **Felicia:**
   - Cheap path: bake once 15s VI intro + 15s close (HeyGen Avatar III ~1¢/sec → ~30¢ one-time, reuse forever). Optional ElevenLabs voice bumper.
   - Real demo path: FaceTime-style both-talk ~20 min ≈ $2–3/session (HeyGen LiveAvatar + ElevenLabs Agents). Do not generate a new VI per visitor.
   - Sales rules: smart confident closer; never please/sorry/honestly/to be honest; first name unless they ask for Mr./title; after packages assume sale → "which package?" → HARD SILENCE; same silence after payment ask; learn from closes; warm transfer / call Danny when stuck.
5. Re-add binary logos under `public/brand/*.png`, `public/logo.gif`, `public/cc-logo.jpg` (text-only pushes skipped these).
6. Restore CI workflow on miami if missing (OAuth lacked `workflow` scope once).

## Deploy checklist (Fast Break only)
- [ ] Org `main` = scrub tip (not bootstrap-only `b513d6f`)
- [ ] Supabase = Fast Break project (NOT `rdvzcryehtnkrzqnuppr`)
- [ ] Migrations applied on Fast Break
- [ ] First admin created (see README)
- [ ] Vercel `fastbreakcrm23` env: Supabase URL/keys, `CARD_ENCRYPTION_KEY`, `NETWORK_ID`/`NETWORK_PASSWORD`, SMTP, `OPS_ALERT_EMAIL`, `WEBSITE_LEAD_NOTICE_TO`
- [ ] Smoke: network login → admin → create lead → estimate

## If you are confused
- Wrong repo / wrong Vercel / wrong Supabase → stop.
- Rebuilding the CRM from DA again → stop; use `feat/full-scrub-live-da`.
- Adding DA branding back → stop and scrub.
- Touching DA production → stop.

Updated: 2026-11-02. Prefer this file + `docs/HANDOFF.md` over chat memory.
