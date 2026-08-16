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

sql()   { "${PSQL[@]}" "$1" 2>&1; }
as_a()  { "${PSQL[@]}" "set role authenticated; select set_config('request.jwt.claim.sub','$A',true); $1" 2>&1; }

pass=0; fail=0; inconc=0
ok()     { printf "  \033[32mPASS\033[0m          %-46s (owner saw %s, merchant A saw %s)\n" "$1" "$2" "$3"; pass=$((pass+1)); }
bad()    { printf "  \033[31mFAIL\033[0m          %-46s %s\n" "$1" "$2"; fail=$((fail+1)); }
unknown(){ printf "  \033[33mINCONCLUSIVE\033[0m  %-46s %s\n" "$1" "$2"; inconc=$((inconc+1)); }

# ── Fixtures ──────────────────────────────────────────────────────────────
# Two merchants, both with real rows. A is the attacker, B is the victim.
A_MAIL="adv-a@urivo.test"; B_MAIL="adv-b@urivo.test"
A=""; B=""; SA=""; SB=""

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
    insert into public.stores (user_id, store_name, subdomain, is_active)
      values (b, 'Victim Store', 'adv-victim-b', true)
      on conflict (subdomain) do nothing;
    insert into public.stores (user_id, store_name, subdomain, is_active)
      values (a, 'Attacker Store', 'adv-attacker-a', true)
      on conflict (subdomain) do nothing;
  end \$\$;"

  A=$(sql "select id from public.profiles where email='$A_MAIL'")
  B=$(sql "select id from public.profiles where email='$B_MAIL'")
  SB=$(sql "select id from public.stores where subdomain='adv-victim-b'")
  SA=$(sql "select id from public.stores where subdomain='adv-attacker-a'")

  # B's owned rows across every store-scoped surface.
  sql "
  insert into public.products (store_id, title, description, price_eur)
    select '$SB','Victim widget','secret catalogue',99.00
    where not exists (select 1 from public.products where store_id='$SB');
  insert into public.orders (store_id, customer_email, customer_name, amount_total, status)
    select '$SB','buyer@example.com','A Real Buyer',4200,'paid'
    where not exists (select 1 from public.orders where store_id='$SB');
  insert into public.store_visits (store_id, is_bot)
    select '$SB', false
    where not exists (select 1 from public.store_visits where store_id='$SB');
  insert into public.credit_ledger (user_id, delta, reason, source)
    select '$B', 25, 'seed', 'system'
    where not exists (select 1 from public.credit_ledger where user_id='$B');
  " >/dev/null
}

cleanup() {
  sql "
  delete from public.stores   where subdomain in ('adv-victim-b','adv-attacker-a');
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
[[ -z "$A" || -z "$B" || -z "$SB" ]] && { echo "Seeding failed — is this an owner connection?" >&2; exit 2; }
echo "  attacker A = $A   victim B = $B   victim store = $SB"
echo

echo "── Cross-tenant reads (each requires victim rows to exist) ────────────"
hidden "victim's store"            "from public.stores where user_id='$B'"
hidden "victim's products"         "from public.products where store_id='$SB'"
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
hidden "victim store by primary key"   "from public.stores where id='$SB'"
hidden "victim order by primary key"   "from public.orders where store_id='$SB'"

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
