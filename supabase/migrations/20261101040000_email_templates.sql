-- Maintenance > Email Center: editable customer letter templates.
-- Additive only. Seeds the 8 letters from lib/templates/customer-messages.ts (same keys, so history
-- labels and Quote-viewed tracking keep working). Admins write; active staff read.
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{1,60}$'),
  name text not null check (length(name) between 1 and 120),
  subject text not null check (length(subject) between 1 and 200),
  body_html text not null default '' check (length(body_html) <= 100000),
  kind text not null default 'letter' check (kind in ('letter', 'free')),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  opens_quote boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;
drop policy if exists "Active staff read email templates" on public.email_templates;
create policy "Active staff read email templates" on public.email_templates for select to authenticated using (public.crm_is_active_staff());
drop policy if exists "Admins write email templates" on public.email_templates;
create policy "Admins write email templates" on public.email_templates for all to authenticated
  using (public.crm_is_active_admin()) with check (public.crm_is_active_admin());

insert into public.email_templates (key, name, subject, body_html, kind, is_active, sort_order, opens_quote) values
  ($tpl$request_received$tpl$, $tpl$Request received$tpl$, $tpl$We received your auto transport request$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">Thank you for your auto transport request with {company_name}! We have received your information, and one of our transport coordinators will contact you shortly with your quote. If you would like to speak with someone right away, call us at {office_phone} or reply to this email.</p><p style="margin:0 0 8px;">We look forward to helping you.</p>$tpl$, 'letter', true, 10, false),
  ($tpl$company_intro$tpl$, $tpl$Company intro$tpl$, $tpl$Why customers choose {company_name}$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">At {company_name}, we make shipping your vehicle seamless and stress-free. With access to a vast network of over 40 terminals and hundreds of trusted national carriers, we ensure safe and timely vehicle delivery from start to finish.</p><p style="margin:0 0 8px;">Our team of highly experienced auto transport coordinators handles the entire process door-to-door, providing expert guidance every step of the way. With years of industry experience and some of the most competitive rates among reputable carriers, we are committed to delivering exceptional service and value.</p><p style="margin:0 0 8px;">Our goal is not just to earn your business today, but to be your trusted auto transport provider for years to come. Contact us today to book your shipment or get answers to any questions you may have.</p>$tpl$, 'letter', true, 20, false),
  ($tpl$ready_to_book$tpl$, $tpl$Ready to book$tpl$, $tpl$Your auto transport quote - ready to reserve (Job {job_number})$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">We appreciate your request for service with {company_name}. Your shipment to {delivery_state} is ready to be scheduled under job number {job_number}.</p><p style="margin:0 0 8px;">To lock in your guaranteed price and secure your transport dates, reserve online using the secure link below, or call me directly to book. The deposit shown on your quote reserves your spot, and the remaining balance is due upon delivery of your vehicle.</p><p style="margin:0 0 8px;">Reserve Online Now: {reservation_link}</p><p style="margin:0 0 8px;">Or call me directly: {rep_direct_line}</p><p style="margin:0 0 8px;">Once you make your reservation, you will receive a confirmation email and a receipt for your deposit.</p><p style="margin:0 0 8px;">Important: if you have not already, please send your pickup and delivery addresses. If you do not have the full addresses yet, just confirm the zip codes and write &quot;TBD&quot; for now.</p><p style="margin:0 0 8px;">We look forward to providing you with a seamless, stress-free transport experience.</p>$tpl$, 'letter', true, 30, true),
  ($tpl$flex_pricing$tpl$, $tpl$FLEX pricing$tpl$, $tpl$Save on your auto transport with FLEX pricing$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">Why pay premium pricing if there is no rush to ship your vehicle?</p><p style="margin:0 0 8px;">At {company_name}, we offer exclusive FLEX Pricing, a smart, cost-effective option for customers with flexible pickup dates. If you can provide a pickup window of 1-10 days, or book at least 30 days in advance, we will secure some of the lowest rates in the industry without sacrificing service or reliability.</p><p style="margin:0 0 8px;">Price Match Guarantee: already have a quote? We will match or beat any rate from a reputable, licensed carrier. Just send us the written estimate.</p><p style="margin:0 0 8px;">Ready to lock in your savings? Reply with your preferred pickup dates or let us know how flexible your schedule is, and we will handle the rest.</p><p style="margin:0 0 8px;">Looking forward to assisting you!</p>$tpl$, 'letter', true, 40, false),
  ($tpl$honest_followup$tpl$, $tpl$Honest quote follow-up$tpl$, $tpl$A quick note about your auto transport quote$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">I wanted to take a moment to share something important as you explore your auto transport options. A lot of companies advertise ultra-low rates just to get your business, but what they do not always mention is that those prices often will not get your vehicle picked up. It can lead to unexpected delays or last-minute price increases when a carrier declines the job.</p><p style="margin:0 0 8px;">At {company_name}, we like to keep things simple and upfront. We work directly with our trusted network of carriers and give you a clear, honest quote designed to secure your vehicle's pickup and delivery as promised, with no hidden fees, no surprises, and no unnecessary stress.</p><p style="margin:0 0 8px;">If you would like help with your transport or just have questions, reach out by phone, text, or reply to this email. We are here to make things easy for you!</p>$tpl$, 'letter', true, 50, false),
  ($tpl$booked_scheduled$tpl$, $tpl$Booked - you're scheduled$tpl$, $tpl$You're scheduled! Job {job_number}$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">Thank you for choosing {company_name} for your transportation needs!</p><p style="margin:0 0 8px;">You are now scheduled for pickup from {pickup_city_state_zip} to {delivery_city_state_zip}, with the first available pickup date being {pickup_date}. We will confirm your pickup date and time of arrival within 24 to 48 hours before your confirmed pickup date. Please contact us directly if you have any questions or changes.</p><p style="margin:0 0 8px;">Thanks again and welcome aboard!</p>$tpl$, 'letter', true, 60, false),
  ($tpl$pickup_confirmed$tpl$, $tpl$Pickup confirmed$tpl$, $tpl$Your pickup is confirmed for {pickup_date} (Job {job_number})$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">We are pleased to confirm that your vehicle pickup is scheduled for {pickup_date}. You can view your assigned carrier's contact information by clicking your job number below. In the &quot;Additional Notes&quot; section, you will find the carrier's name and phone number.</p><p style="margin:0 0 8px;">The driver will contact you directly with an estimated time of arrival as they approach your pickup location. Should you need updates before then, you are welcome to reach out to the carrier directly or contact our office for assistance.</p><p style="margin:0 0 8px;">If you have any further questions or need help reaching your carrier, please do not hesitate to reach out. We are here to help ensure everything goes smoothly.</p><p style="margin:0 0 8px;">Thank you for choosing us for your vehicle transport needs. We appreciate your business!</p>$tpl$, 'letter', true, 70, false),
  ($tpl$hi_lets_chat$tpl$, $tpl$Hi, let's chat!$tpl$, $tpl$Hi, let's chat! (Job {job_number})$tpl$, $tpl$<p style="margin:0 0 8px;">Dear {customer_name},</p><p style="margin:0 0 8px;">Hi, let's chat. I saw that you looked at your quote for job {job_number}, and I am here if you want to talk it through.</p><p style="margin:0 0 8px;">You can call me directly at {rep_direct_line}, or open your quote with the job-number button below. If you are ready to reserve, use this link: {reservation_link}</p>$tpl$, 'letter', true, 80, true)

on conflict (key) do nothing;

-- Rep title for the letter signature ({rep_title}); blank = "Transport Coordinator".
alter table public.crm_reps add column if not exists title text check (title is null or length(title) <= 80);

-- Sends from Maintenance templates: custom_letter (pixel) / custom_quote (landing page), plus which row.
alter table public.crm_emails add column if not exists template_id uuid references public.email_templates(id) on delete set null;
alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in (
    'cc_form', 'e_quote', 'booked_esign', 'free_text',
    'request_received', 'company_intro', 'ready_to_book', 'flex_pricing',
    'honest_followup', 'booked_scheduled', 'pickup_confirmed', 'hi_lets_chat',
    'payment_link', 'carrier_confirm', 'custom_letter', 'custom_quote'
  ));
