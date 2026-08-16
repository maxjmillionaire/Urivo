#!/usr/bin/env bash
#
# Cross-tenant isolation, proven rather than assumed.
#
# WHY THIS EXISTS SEPARATELY FROM adversarial-db.sh
#
# The older suite answers "can a signed-in user escalate their own privileges",
# and it answers it well: every probe there is a write, and a write that RLS
# refuses reports `UPDATE 0`, which is real evidence.
#
# Its cross-tenant READ probes were not real evidence. They ran
# `select count(*) … where user_id = B` and accepted `0` as proof of denial —
# but `0` is also what an empty database returns. At the time of writing this
# file, production held exactly ONE profile, so "merchant B" did not exist and
# every cross-tenant read passed by describing an empty set. The suite reported
# 25 denials and had tested nothing about tenancy.
#
# So this script never accepts a zero on its own. Every isolation probe is a
# PAIR of counts:
#
#     n_real  — counted as the table owner, with RLS out of the way
#     n_seen  — counted as merchant A, through RLS
#
#   PASS          n_real > 0 AND n_seen = 0   → data existed and was withheld
#   FAIL          n_seen > 0                  → merchant A read merchant B
#   INCONCLUSIVE  n_real = 0                  → nothing to withhold; proves nothing
#
# INCONCLUSIVE is a first-class result and is NOT counted as a pass. A suite
# that cannot tell "denied" from "absent" is worse than no suite, because it
# produces a green line that a founder can quote at an investor.
#
# Writes are checked the same way: read B's value, attempt the write as A, read
# it back as the owner and require it to be unchanged. `UPDATE 0` is corroborating
# evidence, not the assertion.
#
# Merchant B is seeded here rather than borrowed, so the test is deterministic
# on any database, and removed again at the end.
#
# Usage:
#   PGURL="postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres" \
#     scripts/adversarial-tenancy.sh
#   scripts/adversarial-tenancy.sh          # local postgres on /tmp:5433, db "urivo"
#
# Requires an owner/superuser connection: it seeds fixtures and reads around RLS
# to establish ground truth. Never point it at a database you cannot dirty — it
# cleans up after itself, but it does write.

set -uo pipefail

if [[ -n "${PGURL:-}" ]]; then PSQL=(psql "$PGURL" -tAc)
else PSQL=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-urivo}" -tAc); fi

sql()     { "${PSQL[@]}" "$1" 2>&1; }
as_a()    { "${PSQL[@]}" "set role authenticated; select set_config('request.jwt.claim.sub','$A',true); $1" 2>&1; }
as_anon() { "${PSQL[@]}" "set role anon; $1" 2>&1; }

pass=0; fail=0; inconc=0
ok()     { printf "  \033[32mPASS\033[0m          %-46s (owner saw %s, merchant A saw %s)\n" "$1" "$2" "$3"; pass=$((pass+1)); }
bad()    { printf "  \033[31mFAIL\033[0m          %-46s %s\n" "$1" "$2"; fail=$((fail+1)); }
unknown(){ printf "  \033[33mINCONCLUSIVE\033[0m  %-46s %s\n" "$1" "$2"; inconc=$((inconc+1)); }

# ── Fixtures ──────────────────────────────────────────────────────────────
# Two merchants, both with real rows. A is the attacker, B is the victim.
A_MAIL="adv-a@urivo.test"; B_MAIL="adv-b@urivo.test"
A=""; B=""; SA=""; SB=""; SD=""

seed() {
  sql "
  do \$\$
  declare a uuid; b uuid;
  begin
    -- auth.users first: profiles.id references it.
    insert into auth.users (id, email, instance_id, aud, role)
      values (gen_random_uuid(), '$A_MAIL', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
      on conflict (email) do nothing;
    insert into auth.users (id, email, instance_id, aud, role)
      values (gen_random_uuid(), '$B_MAIL', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
      on conflict (email) do nothing;
    select id into a from auth.users where email = '$A_MAIL';
    select id into b from auth.users where email = '$B_MAIL';

    insert into public.profiles (id, email, full_name) values (a, '$A_MAIL', 'Adversary A')
      on conflict (id) do nothing;
    insert into public.profiles (id, email, full_name) values (b, '$B_MAIL', 'Victim B')
      on conflict (id) do nothing;

    -- B's store is ACTIVE on purpose: an inactive store would be hidden by the
    -- row filter and the probe would pass without testing ownership at all.
    -- It carries a payout account, because the columns worth stealing off a
    -- live store are the owner and the money, not the shop window.
    insert into public.stores (user_id, store_name, subdomain, is_active,
                               stripe_account_id, stripe_charges_enabled)
      values (b, 'Victim Store', 'adv-victim-b', true, 'acct_VICTIM_PAYOUT', true)
      on conflict (subdomain) do nothing;

    -- And an UNPUBLISHED one, because the mirror-image mistake is just as bad:
    -- an active store is public by design, so it cannot test the row filter
    -- either. Only a draft store can.
    insert into public.stores (user_id, store_name, subdomain, is_active)
      values (b, 'Victim Draft', 'adv-victim-b-draft', false)
      on conflict (subdomain) do nothing;
    insert into public.stores (user_id, store_name, subdomain, is_active)
      values (a, 'Attacker Store', 'adv-attacker-a', true)
      on conflict (subdomain) do nothing;
  end \$\$;"

  A=$(sql "select id from public.profiles where email='$A_MAIL'")
  B=$(sql "select id from public.profiles where email='$B_MAIL'")
  SB=$(sql "select id from public.stores where subdomain='adv-victim-b'")
  SD=$(sql "select id from public.stores where subdomain='adv-victim-b-draft'")
  SA=$(sql "select id from public.stores where subdomain='adv-attacker-a'")

  # B's owned rows across every store-scoped surface.
  #
  # NOT silenced, and verified below. This block used to end in `>/dev/null`,
  # and it was failing on every run: `store_visits.session_hash` is NOT NULL
  # and no value was supplied. psql runs a multi-statement string as ONE
  # transaction, so that single violation rolled back the products, orders and
  # credit_ledger inserts alongside it. The suite then reported seven
  # INCONCLUSIVE probes — technically honest, and completely silent about the
  # fact that the fixtures, not the database, were the reason.
  local seed_out
  seed_out=$(sql "
  insert into public.products (store_id, title, description, price_eur)
    select '$SB','Victim widget','secret catalogue',99.00
    where not exists (select 1 from public.products where store_id='$SB');
  insert into public.products (store_id, title, description, price_eur)
    select '$SD','Unreleased widget','not launched yet',149.00
    where not exists (select 1 from public.products where store_id='$SD');
  insert into public.orders (store_id, customer_email, customer_name, amount_total, status)
    select '$SB','buyer@example.com','A Real Buyer',4200,'paid'
    where not exists (select 1 from public.orders where store_id='$SB');
  insert into public.store_visits (store_id, session_hash, path, device, is_bot)
    select '$SB', 'adv-seed-session', '/', 'desktop', false
    where not exists (select 1 from public.store_visits where store_id='$SB');
  insert into public.credit_ledger (user_id, delta, reason, source)
    select '$B', 25, 'seed', 'system'
    where not exists (select 1 from public.credit_ledger where user_id='$B');
  ")
  if grep -qiE 'error' <<<"$seed_out"; then
    echo "Fixture seeding failed — every probe below would be INCONCLUSIVE for the" >&2
    echo "wrong reason. Fix this before reading any result:" >&2
    echo "$seed_out" >&2
    exit 2
  fi

  # Prove the fixtures are actually there. An inconclusive result must mean the
  # database withheld nothing, never that the suite forgot to put anything in.
  local missing=""
  [[ "$(sql "select count(*) from public.products where store_id='$SB'")"     == "0" ]] && missing+=" products"
  [[ "$(sql "select count(*) from public.products where store_id='$SD'")"     == "0" ]] && missing+=" draft-products"
  [[ "$(sql "select count(*) from public.orders where store_id='$SB'")"       == "0" ]] && missing+=" orders"
  [[ "$(sql "select count(*) from public.store_visits where store_id='$SB'")" == "0" ]] && missing+=" store_visits"
  [[ "$(sql "select count(*) from public.credit_ledger where user_id='$B'")"  == "0" ]] && missing+=" credit_ledger"
  if [[ -n "$missing" ]]; then
    echo "Fixtures missing after seeding:$missing — refusing to report on empty tables." >&2
    exit 2
  fi
}

cleanup() {
  sql "
  delete from public.stores   where subdomain in ('adv-victim-b','adv-victim-b-draft','adv-attacker-a');
  delete from public.profiles where email in ('$A_MAIL','$B_MAIL');
  delete from auth.users      where email in ('$A_MAIL','$B_MAIL');
  " >/dev/null
}
trap cleanup EXIT

# ── The paired probe ──────────────────────────────────────────────────────
# $1 label · $2 the FROM/WHERE that selects B's rows
hidden() {
  local label="$1" q="$2"
  local n_real n_seen
  n_real=$(sql "select count(*) $q")
  n_seen=$(as_a "select count(*) $q" | tail -1)
  if ! [[ "$n_real" =~ ^[0-9]+$ ]]; then unknown "$label" "ground truth failed: $n_real"; return; fi
  if [[ "$n_real" == "0" ]]; then unknown "$label" "no victim rows existed — proves nothing"; return; fi
  if ! [[ "$n_seen" =~ ^[0-9]+$ ]]; then ok "$label" "$n_real" "denied ($n_seen)"; return; fi
  if [[ "$n_seen" == "0" ]]; then ok "$label" "$n_real" "0"; else bad "$label" "merchant A read $n_seen of $n_real victim rows"; fi
}

# $1 label · $2 the write A attempts · $3 a value on B's data that must not move
unchanged() {
  local label="$1" write="$2" probe="$3"
  local before after out
  before=$(sql "$probe")
  out=$(as_a "$write")
  after=$(sql "$probe")
  if [[ "$before" != "$after" ]]; then bad "$label" "victim value changed: '$before' → '$after'"; return; fi
  if [[ -z "$before" ]]; then unknown "$label" "no victim value to protect"; return; fi
  ok "$label" "'$before' intact" "$(grep -qiE 'permission denied|violates|UPDATE 0|DELETE 0|INSERT 0' <<<"$out" && echo refused || echo 'no effect')"
}

echo "Seeding two merchants with real data…"
seed
[[ -z "$A" || -z "$B" || -z "$SB" || -z "$SD" ]] && { echo "Seeding failed — is this an owner connection?" >&2; exit 2; }
echo "  attacker A = $A   victim B = $B   victim store = $SB"
echo

echo "── Cross-tenant reads (each requires victim rows to exist) ────────────"

# The victim's store is ACTIVE, which makes a row count the wrong instrument:
# a live storefront is public by design, so merchant A seeing the ROW proves
# nothing and reporting it as a breach is a false alarm. What must never cross
# the tenant boundary are the OWNER and the PAYOUT ACCOUNT — the exact columns
# migration 0052 removed from anon. This asks for those by name.
#
# The query is written as a SCALAR SUBQUERY with a sentinel, and that detail is
# the whole reason this helper is trustworthy. `as_a` prefixes every statement
# with `set role` and a `set_config(...)` that echoes merchant A's own uuid, so
# the transcript is three lines when a row comes back and two when it does not.
# Reading the last line of a bare `select … where id = <B>` therefore returns
# merchant A's uuid on a successful denial — a non-empty value, different from
# the victim's, which the naive comparison below would report as a breach.
#
# This suite shipped with exactly that bug and it produced two confident red
# lines against a database that was correctly withholding the data. Wrapping
# the read in `coalesce((select …), '<none>')` makes the result exactly one row
# in both cases, so "denied" and "leaked" stay distinguishable.
#
secret_column() {
  local label="$1" col="$2"
  local real seen
  real=$(sql "select coalesce((select $col::text from public.stores where id='$SB'), '')")
  if [[ -z "$real" ]]; then unknown "$label" "victim had no $col to protect"; return; fi
  seen=$(as_a "select coalesce((select $col::text from public.stores where id='$SB'), '<none>')" | tail -1)
  if grep -qiE 'permission denied' <<<"$seen"; then ok "$label" "$real" "refused"; return; fi
  if [[ "$seen" == "$real" ]]; then bad "$label" "merchant A read $col = '$seen'"; return; fi
  if [[ "$seen" == "<none>" ]]; then ok "$label" "$real" "no row"; else bad "$label" "merchant A read '$seen'"; fi
}

secret_column "victim's owner (stores.user_id)"        "user_id"
secret_column "victim's payout acct (stripe_account_id)" "stripe_account_id"
hidden "victim's UNPUBLISHED store"  "from public.stores where user_id='$B' and is_active = false"
hidden "victim's unreleased products" "from public.products where store_id='$SD'"
hidden "victim's orders"           "from public.orders where store_id='$SB'"
hidden "victim's customer emails"  "from public.orders where store_id='$SB' and customer_email is not null"
hidden "victim's analytics"        "from public.store_visits where store_id='$SB'"
hidden "victim's credits"          "from public.credit_ledger where user_id='$B'"
hidden "victim's profile"          "from public.profiles where id='$B'"

echo
echo "── Cross-tenant writes (victim data must be byte-identical after) ─────"
unchanged "rename victim's store"      "update public.stores set store_name='hijacked' where id='$SB';"       "select store_name from public.stores where id='$SB'"
unchanged "take ownership"             "update public.stores set user_id='$A' where id='$SB';"                "select user_id::text from public.stores where id='$SB'"
unchanged "reprice victim's product"   "update public.products set price_eur=0.01 where store_id='$SB';"      "select price_eur::text from public.products where store_id='$SB' limit 1"
unchanged "inject into victim's store" "insert into public.products (store_id,title,description,price_eur) values ('$SB','injected','x',1);" "select count(*)::text from public.products where store_id='$SB'"
unchanged "delete victim's store"      "delete from public.stores where id='$SB';"                            "select count(*)::text from public.stores where id='$SB'"
unchanged "delete victim's orders"     "delete from public.orders where store_id='$SB';"                      "select count(*)::text from public.orders where store_id='$SB'"

echo
echo "── ID manipulation: the victim's id supplied directly ─────────────────"
# Supplying the primary key of a store that was never published: the row filter
# is the only thing standing between merchant A and it.
hidden "victim draft store by primary key" "from public.stores where id='$SD'"
hidden "victim order by primary key"       "from public.orders where store_id='$SB'"

echo
echo "── The public projection (0054): shop window open, record closed ──────"
#
# Isolation that breaks the storefront is not a fix, so these run in the same
# suite as the attacks. Every one of them asserts something the shop needs.
#
n=$(as_anon "select count(*) from public.storefronts where id='$SB'" | tail -1)
if [[ "$n" == "1" ]]; then ok "anon browses the live storefront" "1" "1"
else bad "anon browses the live storefront" "expected 1, got '$n' — the public shop is broken"; fi

n=$(as_anon "select count(*) from public.products where store_id='$SB'" | tail -1)
if [[ "$n" == "1" ]]; then ok "anon reads the live catalogue" "1" "1"
else bad "anon reads the live catalogue" "expected 1, got '$n' — the catalogue is broken"; fi

n=$(as_anon "select count(*) from public.storefronts where id='$SD'" | tail -1)
if [[ "$n" == "0" ]]; then ok "anon cannot see an unpublished store" "1" "0"
else bad "anon cannot see an unpublished store" "expected 0, got '$n' — drafts are public"; fi

# A signed-in stranger is still a shopper. If 0054 hid live stores from
# `authenticated`, every merchant would 404 on every shop but their own.
n=$(as_a "select count(*) from public.storefronts where id='$SB'" | tail -1)
if [[ "$n" == "1" ]]; then ok "signed-in stranger browses the live shop" "1" "1"
else bad "signed-in stranger browses the live shop" "expected 1, got '$n' — storefront broken when logged in"; fi

# anon must hold nothing on the base table — not a row, not a column.
out=$(as_anon "select count(*) from public.stores")
if grep -qiE 'permission denied' <<<"$out"; then ok "anon refused on the stores table" "privilege" "refused"
else bad "anon refused on the stores table" "anon reached stores: $(tail -1 <<<"$out")"; fi

# The projection must not carry a private column in the first place.
leak=$(sql "select coalesce(string_agg(column_name,','),'') from information_schema.columns
            where table_schema='public' and table_name='storefronts'
              and column_name in ('user_id','stripe_account_id','stripe_charges_enabled')")
if [[ -z "$leak" ]]; then ok "storefronts carries no private column" "0" "0"
else bad "storefronts carries no private column" "it exposes: $leak"; fi

echo
echo "── The owner's own data must still work ───────────────────────────────"
own=$(as_a "select count(*) from public.stores where id='$SA'" | tail -1)
if [[ "$own" == "1" ]]; then ok "merchant A reads their own store" "1" "1"
else bad "merchant A reads their own store" "expected 1, got '$own' — isolation broke legitimate access"; fi

echo
printf "%d passed · %d failed · %d inconclusive\n" "$pass" "$fail" "$inconc"
if (( fail > 0 )); then echo "TENANCY BROKEN"; exit 1; fi
if (( inconc > 0 )); then echo "INCOMPLETE — inconclusive probes prove nothing; fix the fixtures"; exit 3; fi
echo "Cross-tenant isolation held against populated fixtures."
