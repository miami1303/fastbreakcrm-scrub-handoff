# Paste this into Copilot Coding Agent

You are on **Fast Break CRM**, a separate product.

**Own stack:** repo `drivingamerica-inc/fastbreakcrm` (backup `miami1303/fastbreakcrm`), Vercel `fastbreakcrm23`, Fast Break Supabase only. NEVER use DA Supabase `rdvzcryehtnkrzqnuppr`. NEVER put Driving America branding back.

**Do not rebuild.** Full scrubbed app already exists:
- Pull branch `feat/full-scrub-live-da` tip `507feb2` (or miami `main` ~`a80a02b`).
- Org `main` tip `b513d6f` is old bootstrap only — not current.

**Already done:** full CRM scrubbed (ops strip, book flow, email center, inbox, payments shell, network login, roles). DA IP removed. Tests/build green enough (310/317).

**Your job next (in order):**
1. If scrub not on `main`, open/merge PR `feat/full-scrub-live-da` → `main`.
2. Multi-tenant: `company_id` + RLS (each company own users/workspace).
3. Owner console + Sign-up/Buy now ($125 / $99 / $129).
4. Felicia: bake 15s VI intro + 15s close once and reuse; live FaceTime demo later via HeyGen LiveAvatar + ElevenLabs (~$2–3/20 min). Sales rules in `.github/copilot-instructions.md`.
5. Deploy only after Fast Break Supabase + Vercel env are connected (human).

Read `.github/copilot-instructions.md` and `docs/HANDOFF.md` before writing code.
