# Fast Break CRM handoff (2026-11-02)

## Done
- Built from the live source (feat/crm-core-flow @ 0300ae3), copied read-only. The source repo was not changed.
- Removed all Driving America branding, domains, emails, phones, DOT/MC, staff names, logos (including the base64 email logo), company policy and CC terms, deploy log and seed lead.
- Replaced them with Fastbreak CRM placeholders: support@fastbreakcrm.test, 555-010-01xx numbers, and job numbers FB######.
- Payments: no payee or processor defaults. Stripe methods appear only when STRIPE_* keys are set, and Zelle only when PAY_ZELLE is set. With no processor, the CRM shows "Payments aren't set up. Call us to enable payments." Card entry is encrypted with CARD_ENCRYPTION_KEY from env, and the card can still be viewed, booked and e-signed.
- Network login and the admin/supervisor/rep roles are kept. Search indexing stays off (robots.txt and noindex).
- Lint: 0 errors. Unit tests: 310 pass, 7 fail; the same 7 also fail on the source code. Build: passes.

## Not done
- Multi-tenant support. Each company needs its own isolated users and workspace, with a company_id on every table plus RLS. Until then, use one deployment and one Supabase project per company.
- The FLEX flexible-date flag is kept as a generic feature.
- Logos are simple text placeholders.
- Felicia (the demo voice agent) is not started. Her stack needs ElevenLabs and HeyGen, and both connections need auth.

## Blockers
- miami1303 needs Write collaborator access on drivingamerica-inc/fastbreakcrm.
- The Fast Break Supabase project (fastbreakcrm) is not connected. Apply supabase/migrations to that project, never to rdvzcryehtnkrzqnuppr.
- The Vercel project fastbreakcrm23 is not connected. Set the env vars from .env.example there.
- Commits pushed through the GitHub connector show the org account's identity, including its email. Squash-merge under a neutral identity.

## Next steps
1. Connect the Fast Break Supabase project, apply the migrations, and bootstrap the first admin (see README).
2. Connect Vercel and set the env vars: Supabase, CARD_ENCRYPTION_KEY, NETWORK_ID/PASSWORD, SMTP.
3. Build multi-tenant support.
4. Felicia demo agent.
