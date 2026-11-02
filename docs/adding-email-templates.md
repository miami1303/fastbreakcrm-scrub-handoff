# Adding a customer email / document template

Every customer-facing document and email (E-Quote, booked quote, CC authorization form,
and anything added later) renders through one shared layout, so they all look the same:

- new logo header (`public/brand/fastbreak-logo.png`) with **Call {main phone}** on the right
- brand colors (`lib/brand.ts`: red `#B12E39`, navy `#26446E`, gray `#424649`)
- company info + rep block, read at render/send time from **Admin > Maintenance > Company Settings**
  (`company_settings` table) and the lead's rep (**Maintenance > Users**: phone/email)
- one clean 640px page body
- red e-sign link(s) (`Click this link to E-sign …`)
- footer (company name, address, Call line, email, website)

Nothing contact-related is hard-coded in a template. `DEFAULT_COMPANY`
(`lib/templates/company.ts`) mirrors the migration seed and is only used if the table can't be read.

## Files

| File | What it is |
|---|---|
| `lib/templates/layout.ts` | Shared layout: `renderLayoutBody()`, `documentShell()`, header/footer, `esignLinkRow()`, `paymentBlock()`, `repBlock()` |
| `lib/templates/company.ts` | `CompanyInfo` type, setting keys/labels, seed defaults |
| `lib/templates/registry.ts` | `TEMPLATES` registry and `renderTemplate(key, input)` |
| `lib/templates/example.ts` | A complete minimal example (`example_notice`) to copy |
| `lib/company-settings.ts` | Server-only loader `getCompanyInfo()` (no caching; edits show on the next render) |

## Add a template in 3 steps

1. Copy `lib/templates/example.ts` to `lib/templates/<your-template>.ts` and set:
   - `key` (unique, e.g. `pickup_reminder`)
   - `title` (shown in the blue title bar)
   - `flags`: `{ esign: boolean, showPayment: boolean }`
     - `esign: true` adds the red e-sign link at the bottom (customer signs on `/d/<token>`)
     - `showPayment: true` passes the deposit paid (Payments tab) so you can show
       Total (black) / Customer Payment (green) / Customer Balance (red) with `paymentBlock()`
   - `subject(input)` and `rows(input)`: your body as `<tr>…</tr>` rows
2. Register it in `TEMPLATES` in `lib/templates/registry.ts`.
3. Render it: `renderTemplate("<key>", docInput(bundle, origin, mode))` returns
   `{ subject, bodyHtml, html, text }`. `html` is a complete email; `bodyHtml` embeds on a page.

## Email-client safety rules (keep these)

- Tables for layout (`role="presentation"`), **inline styles only**, no `<style>`/external CSS, no scripts.
- Images use **absolute URLs** (`assetBaseUrl` + path); set `width` and `alt`.
- 640px max width; Arial/Helvetica (Times for template legal text).
- Escape every dynamic value with `escapeHtml()`.
- Never put a full card number or CVV in a template; use `ccLast4Display(last4)`.

## Adding a user (until "Add User" is built)

Maintenance > Users edits existing users only. To add one for now:

1. Supabase dashboard > **Authentication > Users > Add user** (email + password, or invite).
   Copy the new user's UUID.
2. SQL editor:
   ```sql
   insert into public.user_profiles (user_id, display_name, role, is_active)
   values ('<uuid>', 'First Last', 'salesperson', true);   -- or 'supervisor' / 'admin'
   insert into public.user_identities (user_id, username) values ('<uuid>', '<username>');
   ```
3. Open **Admin > Maintenance > Users**, click **Edit**, and set phone, email, rotation and
   (Salesman) "Can take leads from Assign New Estimates". Saving creates the rep record used on
   that user's customer documents.
