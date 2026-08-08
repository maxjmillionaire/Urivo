#!/usr/bin/env bash
#
# Adversarial database pass — what a signed-in user can actually do.
#
# Runs as the `authenticated` role with a chosen user id in the JWT claim, which
# is exactly the position a logged-in visitor holds against PostgREST with the
# public anon key. Everything here was reachable from a browser console at some
# point: setting your own `plan` to Pro, publishing past your live-store cap,
# reading another merchant's catalogue.
#
# RLS alone does not answer these — it decides which ROWS a user may touch and
# has nothing to say about which COLUMNS. Migration 0045 is what closes them,
# and this script is how you prove it on a database rather than assume it.
#
# Usage:
#   scripts/adversarial-db.sh                     # local: postgres on /tmp:5433, db "urivo"
#   PGURL="postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres" \
#     scripts/adversarial-db.sh                   # a real Supabase project (direct connection)
#
# Read-only in effect: every write it attempts is one that must be refused, and
# the handful that must succeed are set back to what they were.

set -uo pipefail

if [[ -n "${PGURL:-}" ]]; then PSQL=(psql "$PGURL" -tAc); else PSQL=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-urivo}" -tAc); fi

A="${URIVO_TEST_USER_A:-}"
B="${URIVO_TEST_USER_B:-}"

# Without an explicit pair, borrow two real profiles. Nothing is ever mutated
# destructively: A's own name is restored, and every other write must fail.
if [[ -z "$A" ]]; then
  read -r A B < <("${PSQL[@]}" "select string_agg(id::text,' ') from (select id from public.profiles order by created_at limit 2) x" 2>/dev/null)
fi
if [[ -z "${A:-}" || -z "${B:-}" ]]; then
  echo "Need two profiles in the database (or set URIVO_TEST_USER_A / _B)." >&2
  exit 2
fi

pass=0; fail=0
as_a() { "${PSQL[@]}" "set role authenticated; select set_config('request.jwt.claim.sub','$A',true); $1" 2>&1; }

deny() {
  local out; out=$(as_a "$2")
  if grep -qiE "permission denied|violates row-level security|^UPDATE 0|^DELETE 0|^INSERT 0 0|^0$" <<<"$out"; then
    printf "  DENIED    %s\n" "$1"; pass=$((pass+1))
  else
    printf "  ALLOWED!  %s  → %s\n" "$1" "$(tail -1 <<<"$out")"; fail=$((fail+1))
  fi
}
allow() {
  local out; out=$(as_a "$2")
  if grep -qiE "permission denied|violates" <<<"$out"; then
    printf "  BROKEN!   %s  → %s\n" "$1" "$(tail -1 <<<"$out")"; fail=$((fail+1))
  else
    printf "  ALLOWED   %s\n" "$1"; pass=$((pass+1))
  fi
}

echo "── Privilege escalation ──────────────────────────────────"
deny "self-upgrade to Pro"              "update public.profiles set plan='pro' where id='$A';"
deny "activate own subscription"        "update public.profiles set subscription_status='active' where id='$A';"
deny "comp self indefinitely"           "update public.profiles set comped_until='2099-01-01' where id='$A';"
deny "claim the founding price"         "update public.profiles set price_type='founding' where id='$A';"
deny "attach a Stripe subscription id"  "update public.profiles set stripe_subscription_id='sub_fake' where id='$A';"
deny "publish past live-store capacity" "update public.stores set is_active=true where user_id='$A';"
deny "mint a store (born live, free)"   "insert into public.stores (user_id,store_name,subdomain) values ('$A','x','x-adv-probe');"
deny "grant self credits"               "insert into public.credit_ledger (user_id,delta,reason,source) values ('$A',99999,'probe','system');"

echo "── Cross-tenant access ───────────────────────────────────"
deny "read another merchant's stores"   "select count(*) from public.stores where user_id='$B';"
deny "read another merchant's profile"  "select count(*) from public.profiles where id='$B';"
deny "read another merchant's credits"  "select count(*) from public.credit_ledger where user_id='$B';"
deny "read another merchant's orders"   "select count(*) from public.orders where store_id in (select id from public.stores where user_id='$B');"
deny "rename another merchant's store"  "update public.stores set store_name='hijack' where user_id='$B';"
deny "delete another merchant's store"  "delete from public.stores where user_id='$B';"
deny "reprice their products"           "update public.products set price_eur=0.01 where store_id in (select id from public.stores where user_id='$B');"
deny "take ownership of their store"    "update public.stores set user_id='$A' where user_id='$B';"

echo "── Privileged functions from a normal session ────────────"
for fn in "grant_comped_access('probe@example.invalid','pro',365,5000,'probe')" \
          "revoke_comped_access('probe@example.invalid')" \
          "expire_comped_access()" \
          "entitlement_columns_locked()" \
          "publish_store('$A'::uuid, null)"; do
  out=$(as_a "select public.$fn;")
  if grep -qi "permission denied" <<<"$out"; then
    printf "  DENIED    %s\n" "${fn%%(*}"; pass=$((pass+1))
  else
    printf "  ALLOWED!  %s  → %s\n" "${fn%%(*}" "$(tail -1 <<<"$out")"; fail=$((fail+1))
  fi
done

echo "── The legitimate paths must still work ──────────────────"
before=$("${PSQL[@]}" "select coalesce(full_name,'') from public.profiles where id='$A';")
allow "edit own display name"  "update public.profiles set full_name='adversarial probe' where id='$A';"
allow "set email preference"   "update public.profiles set marketing_opt_in=marketing_opt_in where id='$A';"
allow "rename own store"       "update public.stores set store_name=store_name where user_id='$A';"
allow "restyle own store"      "update public.stores set theme_config=theme_config where user_id='$A';"
"${PSQL[@]}" "update public.profiles set full_name=nullif('$before','') where id='$A';" >/dev/null

echo ""
echo "  $pass enforced · $fail failure(s)"
[[ $fail -eq 0 ]] || exit 1
