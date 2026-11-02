# Website Get a Quote → CRM go-live (Fast Break)

The CRM endpoint is already live: `POST https://crm.fastbreakcrm.test/api/website-leads`.
your mail host's native Contact form 18 can only email, so we replace it with custom HTML that posts straight to the CRM. Free — no paid service.

## What happens on "Get a Quote"
1. Estimate created, status **unassigned**, lead source **Web Lead** → shows in **Assign New Estimate**.
2. Email to **WEBSITE_LEAD_NOTICE_TO**: subject `New Web Lead - <customer name>`, body = job number, link to the lead (`/estimates/<id>`), customer name/email/phone, ZIPs, vehicles.
3. CRM banner `unassigned_lead` for admins/supervisors.
4. Customer sees an inline thank-you with their job number (no page change).

## Paste steps (your mail host Website Builder)
1. Deploy this branch first (needs the subject/link + vehicle-textarea change). Until then the live API still works but uses the old subject and ignores the single vehicle textarea.
2. your mail host → Websites → Edit website → **Get a Quote** page.
3. Select **Contact form 18** → delete it (or hide it). **Do not touch the Booking/card form.**
4. Add element → **Embed code** (Custom HTML) where the form was. Paste the full contents of `docs/website-quote-form-snippet.html`.
5. Save → **Publish** (embeds only run on the published site, not in the editor/preview).

## Test
1. Open https://fastbreakcrm.test (and the www version) → Get a Quote.
2. Submit a test: name "Test Lead", your email, phone, 80202 → 33101, "2020 Toyota Camry".
3. Expect: green thank-you with job #; CRM **Assign New Estimate** shows Test Lead, source Web Lead; Gmail inbox has "New Web Lead - Test Lead" with a working link.
4. Delete/release the test lead afterwards.

## Troubleshooting
- Red "only be sent from the Fast Break website" → page was not on the live domain (preview/zyrosite). Publish and test live.
- Lead saved but no email → check CRM operations note on the lead (mailer env not set).
- Fallback only: Gmail Apps Script scraping your mail host form email (not primary).
