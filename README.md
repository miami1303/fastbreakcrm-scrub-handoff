# Fastbreak CRM (Fast Break test / demo CRM)

White-label demo CRM. All company details are placeholders (Fastbreak CRM, support@fastbreakcrm.test,
555-010-0100, job numbers FB######). Edit them in **Maintenance > Company Settings**.

**Payments:** no processor or payee account is configured. Without `STRIPE_*` keys the CRM shows
"Payments aren't set up. Call us to enable payments." Reps can still enter a card (encrypted with
`CARD_ENCRYPTION_KEY` from env), view it (authorized roles), book, send documents, and e-sign; run the
card on your own merchant terminal and mark it charged. Zelle instructions appear only when `PAY_ZELLE` is set.

**Single workspace.** Multi-company (tenant) support is a TODO: one deployment + one Supabase project per company for now.
Search engines are blocked (`robots.txt` Disallow + noindex).

Private browser-based CRM for Fastbreak CRM. The app starts at **Network Login**, routes authorized users to **User Login**, and then sends active team members to the appropriate Admin or User menu.

## Included

- Email/password authentication through Supabase Auth with server-managed, HTTP-only cookies.
- Role-based routing for Admin, Supervisor, and Salesperson.
- Follow Up records with five date filters: Today, Yesterday, This Week, Last Week, and Month to Date.
- Postgres row-level security: salespeople can read and manage their own follow-ups; Admins and Supervisors can see team follow-ups.
- Admin-only Team Management to invite staff by email, assign roles, and activate/deactivate accounts.
- Invitation callback and password setup flow; users set their own password from the invitation email.
- **Estimate → Quote → Sign → Book flow**: New Estimate (customer, pickup/delivery + phones, multiple vehicles), salesman quote (deposit + total), optional payment form, instant Sign (colored banners), Book button. Customer view toggle hides deposit unless payment was entered. Recurring tab on user menu. Viewed quote / viewed email banners.
- GitHub Actions CI for lint and production-build checks.

## Local setup

1. Install the supported Node.js version and dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the authorized Fast Break Supabase project.
4. Set `SUPABASE_SERVICE_ROLE_KEY` for server-only team invitation and account administration. Never expose it to browser code or commit a real value.
5. Set `NEXT_PUBLIC_SITE_URL` to the canonical deployed CRM origin. Staff invitations redirect back to this origin.
6. Apply the migrations in `supabase/migrations` to the dedicated Fast Break Supabase project (never a production project of another company) in timestamp order. Includes `20261023030000_estimates.sql` for estimates/vehicles/quotes.
7. Run `npm run dev`; use `npm run lint` and `npm run build` to verify the app.

## First administrator bootstrap

The first administrator must be created once in the authorized Supabase project because no administrator exists yet to invite team members. Create that person in **Supabase Auth** first, then insert a matching row into `public.user_profiles` with the same Auth user UUID, a display name, role `admin`, and `is_active = true`. Do not place passwords, service-role keys, or real customer data in source control. After this one-time bootstrap, administrators can invite the rest of the team through **Admin Menu → Team Management**.

## Production release

Deploy the Next.js app from the `main` branch to the approved hosting environment for **fastbreakcrm.test**. Configure the three environment values above plus the server-only service-role key in that hosting environment. Add `/auth/callback` and the site origin to Supabase Auth's allowed redirect URLs. Verify Network Login → User Login, invitation → Set Password, role-based redirects, follow-up creation/status changes, the admin team screen, and the New Estimate → Sign → Book flow before considering the release ready.

No DNS or domain settings are changed by code commits.
