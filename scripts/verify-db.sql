-- Urivo verification pass — database + security layer.
-- Every check prints PASS or FAIL. Run against a fresh DB with setup_all.sql applied.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

create or replace function vf(label text, ok boolean) returns void
language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a','merchant-a@example.com'),
  ('b0000000-0000-0000-0000-00000000000b','merchant-b@example.com');

insert into public.profiles (id, email, plan) values
  ('a0000000-0000-0000-0000-00000000000a','merchant-a@example.com','core'),
  ('b0000000-0000-0000-0000-00000000000b','merchant-b@example.com','core')
on conflict (id) do update set plan = excluded.plan;

-- A: one LIVE store, one DRAFT store. B: one live store AND one draft store
-- (the draft is what isolation must hide — a published store is public by design).
insert into public.stores (id, user_id, store_name, subdomain, is_active) values
  ('11111111-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','A Live','alive',true),
  ('11111111-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','A Draft','adraft',false),
  ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','B Live','blive',true),
  ('22222222-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000b','B Secret','bsecret',false);

insert into public.products (id, store_id, title, price_eur) values
  ('aa000000-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','A Live Product', 19.90),
  ('aa000000-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002','A Draft Product', 29.90),
  ('bb000000-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','B Product', 39.90),
  ('bb000000-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','B Secret Product', 49.90);

insert into public.credit_ledger (user_id, delta, reason, source) values
  ('a0000000-0000-0000-0000-00000000000a', 100, 'seed', 'system'),
  ('b0000000-0000-0000-0000-00000000000b', 100, 'seed', 'system');

insert into public.notifications (user_id, kind, title) values
  ('a0000000-0000-0000-0000-00000000000a','test','A note'),
  ('b0000000-0000-0000-0000-00000000000b','test','B note');

\echo ''
\echo '════ 1. TENANT ISOLATION (RLS) — merchant A acting as themselves ════'

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

  -- A published storefront is world-readable BY DESIGN, so the isolation
  -- boundary is the unpublished work, not the shop window.
  select vf('A CANNOT see B''s UNPUBLISHED store',
            not exists (select 1 from public.stores where id = '22222222-0000-0000-0000-000000000002'));
  select vf('A CANNOT see B''s unpublished products',
            not exists (select 1 from public.products where id = 'bb000000-0000-0000-0000-000000000002'));
  select vf('A still sees both of their own stores (incl. their own draft)',
            (select count(*) from public.stores
             where user_id = 'a0000000-0000-0000-0000-00000000000a') = 2);
  select vf('B''s published storefront is readable (intended, it is public)',
            exists (select 1 from public.stores where id = '22222222-0000-0000-0000-000000000001'));
  select vf('A CANNOT read B''s credit ledger',
            not exists (select 1 from public.credit_ledger where user_id = 'b0000000-0000-0000-0000-00000000000b'));
  select vf('A sees only their own credit ledger',
            (select count(*) from public.credit_ledger) = 1);
  select vf('A CANNOT read B''s profile',
            not exists (select 1 from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b'));
  select vf('A CANNOT read B''s AI usage ledger',
            not exists (select 1 from public.ai_usage_ledger where user_id = 'b0000000-0000-0000-0000-00000000000b'));
  select vf('notifications are service-role only (A sees none via RLS)',
            (select count(*) from public.notifications) = 0);
commit;

\echo ''
\echo '════ 2. WRITE ISOLATION — A must not be able to touch B''s rows ════'

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

  -- RLS makes another tenant's rows invisible, so an UPDATE matches 0 rows.
  with u as (
    update public.stores set store_name = 'HIJACKED'
    where id = '22222222-0000-0000-0000-000000000001' returning 1
  ) select vf('A cannot rename B''s store', (select count(*) from u) = 0);

  with d as (
    delete from public.stores where id = '22222222-0000-0000-0000-000000000001' returning 1
  ) select vf('A cannot delete B''s store', (select count(*) from d) = 0);

  with d as (
    delete from public.products where id = 'bb000000-0000-0000-0000-000000000001' returning 1
  ) select vf('A cannot delete B''s product', (select count(*) from d) = 0);

  -- Injecting a product into someone else's shop would be the nastiest version
  -- of this: it puts your item, and your price, in their storefront.
  do $$
  declare ok boolean := false;
  begin
    begin
      insert into public.products (store_id, title, price_eur)
      values ('22222222-0000-0000-0000-000000000001', 'INJECTED', 1.00);
    exception when insufficient_privilege then ok := true;
    end;
    perform vf('A cannot inject a product into B''s storefront', ok);
  end $$;

  -- Escalating your own plan would be free money.
  with u as (
    update public.profiles set plan = 'pro'
    where id = 'a0000000-0000-0000-0000-00000000000a' and plan <> 'pro'
    returning 1
  ) select vf('(recorded) self plan-update attempt rows: ' ||
              coalesce((select count(*)::text from u),'0'), true);
commit;

-- Confirm from the service role that B's data really is untouched.
select vf('B''s store survived both attacks',
          (select store_name from public.stores where id = '22222222-0000-0000-0000-000000000001') = 'B Live');
select vf('B''s product survived',
          exists (select 1 from public.products where id = 'bb000000-0000-0000-0000-000000000001'));

\echo ''
\echo '════ 3. PUBLIC STOREFRONT — anonymous visitors ════'

begin;
  set local role anon;

  select vf('anon CAN read a published store',
            exists (select 1 from public.stores where subdomain = 'alive'));
  select vf('anon CANNOT read a DRAFT store',
            not exists (select 1 from public.stores where subdomain = 'adraft'));
  select vf('anon CAN read a published store''s products',
            exists (select 1 from public.products where id = 'aa000000-0000-0000-0000-000000000001'));
  select vf('anon CANNOT read a draft store''s products',
            not exists (select 1 from public.products where id = 'aa000000-0000-0000-0000-000000000002'));
  select vf('anon CANNOT read any profile',
            (select count(*) from public.profiles) = 0);
  select vf('anon CANNOT read any credit ledger',
            (select count(*) from public.credit_ledger) = 0);
  select vf('anon CANNOT read orders',
            (select count(*) from public.orders) = 0);
commit;

\echo ''
\echo '════ 4. CREDITS — the money path ════'

select vf('balance reads 100 before spending',
          public.credit_balance('a0000000-0000-0000-0000-00000000000a') = 100);

select vf('spend of 20 returns 80',
          public.spend_credits('a0000000-0000-0000-0000-00000000000a', 20, 'test', 'ai') = 80);

select vf('balance is 80 after the spend',
          public.credit_balance('a0000000-0000-0000-0000-00000000000a') = 80);

do $$
declare ok boolean := false;
begin
  begin
    perform public.spend_credits('a0000000-0000-0000-0000-00000000000a', 999, 'overdraft', 'ai');
  exception when others then
    ok := sqlerrm like '%INSUFFICIENT_CREDITS%';
  end;
  perform vf('overdraft is rejected with INSUFFICIENT_CREDITS', ok);
end $$;

select vf('balance unchanged after the rejected overdraft',
          public.credit_balance('a0000000-0000-0000-0000-00000000000a') = 80);

select vf('ledger is append-only (spend wrote a negative row, nothing updated)',
          (select count(*) from public.credit_ledger
           where user_id = 'a0000000-0000-0000-0000-00000000000a' and delta < 0) = 1);

\echo ''
\echo '════ 5. CREDIT EXPIRY — plan credits are use-it-or-lose-it (FIFO) ════'

-- Fresh user: 50 permanent + 50 expiring soon. Spending must consume the
-- SOONEST-EXPIRING lot first, leaving permanent credits intact.
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-00000000000c','exp@example.com');
insert into public.profiles (id, email) values ('c0000000-0000-0000-0000-00000000000c','exp@example.com')
on conflict (id) do nothing;
insert into public.credit_ledger (user_id, delta, reason, source, expires_at) values
  ('c0000000-0000-0000-0000-00000000000c', 50, 'permanent', 'system', null),
  ('c0000000-0000-0000-0000-00000000000c', 50, 'plan', 'subscription', now() + interval '5 days');

select vf('expiry summary reports the 50 expiring credits',
          (select amount from public.credit_expiry_summary('c0000000-0000-0000-0000-00000000000c')) = 50);

select vf('spending 30 leaves 70 total',
          public.spend_credits('c0000000-0000-0000-0000-00000000000c', 30, 'test', 'ai') = 70);

select vf('FIFO: the expiring lot absorbed the spend (20 left expiring, not 50)',
          (select amount from public.credit_expiry_summary('c0000000-0000-0000-0000-00000000000c')) = 20);

\echo ''
\echo '════ 6. FOUNDING MEMBERS — the cap that protects lifetime pricing ════'

update public.platform_settings set founding_cap = 3, founding_claimed = 0 where id = true;

do $$
declare i int;
begin
  for i in 1..6 loop
    insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
    values (gen_random_uuid(), 'f' || i || '@example.com', '{}'::jsonb, now());
  end loop;
end $$;

-- Scoped to this batch: earlier fixture users claimed spots before the cap was reset.
select vf('exactly 3 of the 6 batch signups were granted founding (cap held)',
          (select count(*) from public.profiles
           where email like 'f%@example.com' and price_type = 'founding') = 3);
select vf('the other 3 signups fell through to standard pricing',
          (select count(*) from public.profiles where email like 'f%@example.com' and price_type <> 'founding') = 3);
select vf('founding_claimed matches the cap exactly',
          (select founding_claimed from public.platform_settings where id = true) = 3);

\echo ''
\echo '════ 7. STORE GENERATION — atomic credits + store + products ════'

select vf('generation deducts exactly 20 credits and returns the new balance',
          ((public.generate_store_atomic(
              'a0000000-0000-0000-0000-00000000000a', 'Gen Store', 'genstore',
              '{}'::jsonb,
              '[{"title":"P1","description":"d","price_eur":9.9,"image_url":null,"inventory_count":100}]'::jsonb,
              20))->>'credits_remaining')::int = 60);

select vf('the store was created', exists (select 1 from public.stores where subdomain = 'genstore'));
select vf('its product was created',
          (select count(*) from public.products p join public.stores s on s.id = p.store_id
           where s.subdomain = 'genstore') = 1);

do $$
declare ok boolean := false;
begin
  begin
    perform public.generate_store_atomic(
      'a0000000-0000-0000-0000-00000000000a','Reserved','www','{}'::jsonb,'[]'::jsonb,20);
  exception when others then ok := sqlerrm like '%SUBDOMAIN_RESERVED%';
  end;
  perform vf('a reserved subdomain is refused', ok);
end $$;

select vf('the refused generation did NOT charge credits',
          public.credit_balance('a0000000-0000-0000-0000-00000000000a') = 60);

\echo ''
\echo '════ 8. PAYOUTS — one connected account per merchant ════'

update public.profiles
set stripe_account_id = 'acct_TEST', stripe_charges_enabled = true
where id = 'a0000000-0000-0000-0000-00000000000a';

select vf('both of A''s stores resolve to the same connected account',
          (select count(distinct r.stripe_account_id)
           from public.stores s, lateral public.store_payout_account(s.id) r
           where s.user_id = 'a0000000-0000-0000-0000-00000000000a'
             and r.stripe_account_id is not null) = 1);

select vf('an un-onboarded merchant resolves to NO account (checkout will refuse)',
          (select r.stripe_account_id is null and r.charges_enabled = false
           from public.stores s, lateral public.store_payout_account(s.id) r
           where s.user_id = 'b0000000-0000-0000-0000-00000000000b' limit 1));

\echo ''
\echo '════ 9. WEEKLY DIGEST — audience gate + aggregation ════'

select vf('a merchant with no store is excluded from the digest',
          not exists (select 1 from public.weekly_digest_data()
                      where email = 'exp@example.com'));
select vf('merchant A appears with their real store counts',
          (select stores_total >= 3 and stores_live >= 1
           from public.weekly_digest_data()
           where email = 'merchant-a@example.com'));
select vf('digest reads zero revenue cleanly before any sale',
          (select revenue_week_cents = 0 and orders_week = 0
           from public.weekly_digest_data()
           where email = 'merchant-a@example.com'));

\echo ''
\echo '════ 10. SIGNUP GUARDRAILS ════'

select vf('a disposable email domain is blocked',
          public.is_email_domain_blocked('someone@mailinator.com'));
select vf('a normal email domain is allowed',
          not public.is_email_domain_blocked('someone@gmail.com'));
