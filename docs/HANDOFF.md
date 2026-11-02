# Fast Break CRM handoff (2026-11-02)

## Source of truth right now
- **Code pushed:** https://github.com/miami1303/fastbreakcrm — tip `a80a02b` on `main` (369 files, scrubbed from DA `feat/crm-core-flow` @ `0300ae3`).
- **Org repo:** https://github.com/drivingamerica-inc/fastbreakcrm — tip `b513d6f` (merged Copilot PR #1 older bootstrap only). miami1303 cannot push there until Write collaborator is granted. Mirror miami → org when access lands.
- **Local box:** `/workspace/fastbreakcrm` matches miami tip.
- **Driving America CRM:** untouched. Do not apply Fast Break migrations to `rdvzcryehtnkrzqnuppr`.

## Done
- Scrubbed full live CRM feature set into Fast Break (ops strip, payments shell, email center, inbox code paths, estimate→book, etc.).
- Removed DA branding, domains, emails, phones, DOT/MC, staff names, logos (incl. email logo), company policy/CC terms, deploy log, seed lead.
- Placeholders: Fastbreak CRM, support@fastbreakcrm.test, 555-010-01xx, job numbers `FB######`.
- Payments: processors off until configured; UI “Payments aren't set up. Call us to enable payments.” Manual encrypted card entry/view/book/e-sign kept.
- Network login + admin/supervisor/rep kept. robots/noindex kept.
- Lint: 0 errors. Unit tests: 310 pass / 7 fail (same 7 fail on DA source). Build: passes.
- Copilot PR #1 merged on org repo earlier today (bootstrap only).

## Not done (must for multi-company)
- **Multi-tenant:** each company needs its own isolated workspace + users (`company_id` / tenant RLS on every table, company-specific Network ID, invite links, banners). Today = **single workspace** — for 10 testers use one deploy+DB **per company** until tenant work ships.
- Owner console (logins, activity, plans, dues, retention, bulk invites 5–10).
- Felicia live voice+face demo/close (silence rules, packages $99/$129 + $125 down, learn-from-close, warm transfer / call Danny). ElevenLabs + HeyGen plugins installed; **both needAuth**.
- CRM Sign-up tab + Buy now / payment method page for clients.
- Deploy: Vercel `fastbreakcrm23` not connected. Supabase Fast Break project not connected.
- Re-add CI workflow on miami repo (OAuth lacked `workflow` scope on first push).
- Second IP audit after tenant work; replace placeholder logos with real brand when ready.

## Blockers (Danny)
1. Add **miami1303** as Write collaborator on [drivingamerica-inc/fastbreakcrm](https://github.com/drivingamerica-inc/fastbreakcrm/settings/access) (or transfer/mirror miami repo into the org).
2. Connect Supabase signed in as Fast Break (`fastbreakcrm` / fastbreakcrmtest@proton.me or fascrmtest23@proton.me) — apply `supabase/migrations` there only.
3. Connect Vercel team/project **fastbreakcrm23**; set env from `.env.example` (Supabase, `CARD_ENCRYPTION_KEY`, network ID/password, SMTP).
4. Authorize ElevenLabs + HeyGen connect cards for Felicia.
5. Drop Claude sales-project handoff for Felicia brain when ready.

## Deploy status
- **Not deployed.** No Fast Break Vercel project visible on connected accounts; no FB Supabase project on connected accounts.

## Suggested next session (usage resets Thu Nov 5 ~7:06 PM CT)
1. Collaborator → mirror `miami1303/fastbreakcrm` → `drivingamerica-inc/fastbreakcrm` (PR or force-sync main).
2. Wire Supabase + Vercel; first admin bootstrap (README).
3. Multi-tenant schema + RLS (hard requirement for multiple companies / own users).
4. Felicia agent (ElevenLabs conversational + HeyGen avatar) with hard silence closes + transfer-to-Danny.
5. Owner console + invite emails.

## Felicia hard rules (saved)
- Salesperson sizzle; never please / sorry / honestly / to be honest.
- First name unless they ask for Mr./title.
- After packages: assume sale → “which package?” → **hard silence** (first to speak loses). Same silence after asking for payment method / $125 down.
- Live interactive (both speak); answer basic workflow Qs; if hanging without no → transfer/call Danny via CRM.
- Learn from each close via customer response; voice inflection never monotone; appearance/positioning psychology.
