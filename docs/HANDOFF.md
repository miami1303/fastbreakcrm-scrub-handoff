# Fast Break CRM handoff (2026-11-02)

> Copilot: read `.github/copilot-instructions.md` first. This file is the human status sheet.

## Separate product (never mix with Driving America)
| | Fast Break | Driving America (do not touch) |
|--|------------|--------------------------------|
| GitHub | `drivingamerica-inc/fastbreakcrm` + backup `miami1303/fastbreakcrm` | DA CRM repos / live app |
| Vercel | `fastbreakcrm23` | DA production project |
| Supabase | Fast Break project only | `rdvzcryehtnkrzqnuppr` — **forbidden** |

## Source of truth right now
- **Full scrub (use this):** https://github.com/drivingamerica-inc/fastbreakcrm/tree/feat/full-scrub-live-da — tip `507feb2` (from DA `feat/crm-core-flow` @ `0300ae3`).
- **Org `main`:** still bootstrap tip `b513d6f` (merged Copilot PR #1) until scrub PR is Submitted/merged.
- **Backup:** https://github.com/miami1303/fastbreakcrm `main` (~`a80a02b` / `ed7cb35`).
- **Local box:** `/workspace/fastbreakcrm`.
- **Driving America CRM:** untouched.

## Done
- Scrubbed full live CRM into Fast Break (ops strip, payments shell, email center, inbox paths, estimate→book, etc.).
- Removed all DA branding / domains / emails / phones / DOT/MC / staff / logos (incl. email base64) / policy / CC terms / Zelle default / seed lead.
- Placeholders: Fastbreak CRM, support@fastbreakcrm.test, 555-010-01xx, jobs `FB######`.
- Payments gated on env; encrypted card entry kept for book/e-sign.
- Lint 0 errors; ~310 unit tests pass / 7 fail (same on DA); production build passes.
- Copilot briefing: `.github/copilot-instructions.md`.

## Not done
- Multi-tenant (`company_id` + RLS) — required for multi-company own users.
- Owner console + Sign-up/Buy now ($125 down, $99 / $129).
- Felicia: bake 15s intro/close once (~≤25–30¢ total, reuse); live FaceTime demo ~$2–3/20 min (LiveAvatar + ElevenLabs). Connectors needAuth.
- Deploy: wire Fast Break Supabase + Vercel `fastbreakcrm23`.
- Binary logos + miami CI workflow.

## Blockers (Danny)
1. Submit/merge PR `feat/full-scrub-live-da` → `main` (or grant miami1303 Write and sync).
2. Connect Fast Break Supabase → apply `supabase/migrations` there only.
3. Connect Vercel `fastbreakcrm23` + env from `.env.example`.
4. Authorize ElevenLabs + HeyGen.
5. Optional: Claude sales-project handoff for Felicia brain.

## Suggested next session
1. Merge scrub → org main.
2. Wire Supabase + Vercel; first admin (README).
3. Multi-tenant schema + RLS.
4. Felicia baked clips, then live demo.
5. Owner console + invites.

## Felicia hard rules
- Sizzle salesperson; never please / sorry / honestly / to be honest.
- First name unless they ask for Mr./title.
- After packages: assume sale → which package? → **hard silence**. Same after payment / $125 down.
- Live interactive both-talk; if hanging without no → transfer/call Danny.
- Learn from each close; never monotone.
