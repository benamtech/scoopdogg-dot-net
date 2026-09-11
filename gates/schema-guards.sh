#!/usr/bin/env bash
# Apply migrations to a throwaway Postgres 17 and prove every schema guard FIRES.
#
#   bash gates/schema-guards.sh
#
# A constraint that has never rejected anything protects nothing. Each case below
# asserts a direction: the "reject" cases must error, and the "allow" cases must not.
# Both halves matter - a check constraint of `false` would pass every reject case
# forever, so the allow cases are what pin it.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
C="sd-schema-gate-$$"
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$C" -e POSTGRES_PASSWORD=x -e POSTGRES_DB=scoopdogg postgres:17-alpine >/dev/null
# Probe the TARGET database: during initdb a bootstrap server answers for `postgres`
# while `scoopdogg` does not exist yet.
until docker exec "$C" psql -U postgres -d scoopdogg -tAc 'select 1' >/dev/null 2>&1; do sleep 2; done

for f in 001_core 002_leads 003_catalog 004_catalog_seed 005_stripe 006_settings 007_event_hash; do
  docker cp "$HERE/migrations/$f.sql" "$C:/tmp/$f.sql" >/dev/null
  if ! docker exec "$C" psql -U postgres -d scoopdogg -v ON_ERROR_STOP=1 -q -f "/tmp/$f.sql" >/dev/null 2>&1; then
    echo "MIGRATION FAILED: $f.sql"; exit 1
  fi
done
echo "migrations applied"

q() { docker exec "$C" psql -U postgres -d scoopdogg -tAc "$1" 2>&1 | tr -d '\n'; }
pass=0; fail=0
check() { local out; out=$(q "$2")
  if [ "$3" = reject ]; then
    if echo "$out" | grep -qi 'ERROR'; then echo "  PASS  $1"; pass=$((pass+1))
    else echo "  FAIL  $1 — expected rejection, got: ${out:0:80}"; fail=$((fail+1)); fi
  else
    if echo "$out" | grep -qi 'ERROR'; then echo "  FAIL  $1 — ${out:0:80}"; fail=$((fail+1))
    else echo "  PASS  $1"; pass=$((pass+1)); fi
  fi
}

CU=11111111-1111-1111-1111-111111111111
PR=22222222-2222-2222-2222-222222222222
SU=33333333-3333-3333-3333-333333333333
VI=44444444-4444-4444-4444-444444444444
q "insert into customers (id,name,phone) values ('$CU','Test','8055550001')" >/dev/null
q "insert into properties (id,customer_id,address,city) values ('$PR','$CU','1 Test St','Ventura')" >/dev/null
q "insert into subscriptions (id,customer_id,property_id,service_slug,state,price_cents,service_weekday) values ('$SU','$CU','$PR','weekly-pooper-scooper-service','active',1500,2)" >/dev/null
q "insert into visits (id,subscription_id,property_id,scheduled_for,charge_cents) values ('$VI','$SU','$PR','2026-09-15',1500)" >/dev/null
q "insert into events (subject_kind,subject_id,seq,event_type,actor_kind,hash) values ('visit','$VI',1,'visit.scheduled','system','h1')" >/dev/null

echo "schema guards:"
check "events refuses UPDATE"            "update events set event_type='tampered' where seq=1" reject
check "events refuses DELETE"            "delete from events where seq=1" reject
check "events refuses duplicate seq"     "insert into events (subject_kind,subject_id,seq,event_type,actor_kind,hash) values ('visit','$VI',1,'x','system','h2')" reject
check "no two live visits on one day"    "insert into visits (subscription_id,property_id,scheduled_for) values ('$SU','$PR','2026-09-15')" reject
check "cancelled visit frees that day"   "insert into visits (subscription_id,property_id,scheduled_for,state) values ('$SU','$PR','2026-09-15','cancelled')" allow
check "duplicate live customer phone"    "insert into customers (name,phone) values ('Dup','8055550001')" reject
check "soft-deleted phone reusable"      "update customers set deleted_at=now() where phone='8055550001'; insert into customers (name,phone) values ('New','8055550001')" allow
check "unknown lead status"              "insert into leads (id,name,phone,email,city,status,created_at) values (gen_random_uuid(),'X','1','a@b.c','Ventura','banana',now())" reject
check "unknown visit state"              "insert into visits (subscription_id,property_id,scheduled_for,state) values ('$SU','$PR','2026-09-22','teleported')" reject
check "negative dog count"               "insert into properties (customer_id,address,city,num_dogs) values ('$CU','2 Test St','Ojai',-1)" reject
check "team role constrained"            "insert into team_members (name,phone,role) values ('X','8055559999','wizard')" reject

before=$(q "select updated_at from leads order by id limit 1")
q "update leads set notes = notes where id = (select id from leads order by id limit 1)" >/dev/null
after=$(q "select updated_at from leads order by id limit 1")
if [ "$before" != "$after" ]; then echo "  PASS  updated_at moves on UPDATE"; pass=$((pass+1))
else echo "  FAIL  updated_at did not move"; fail=$((fail+1)); fi

# 24, not 25: the only lead this script tries to insert is the invalid-status case,
# which the check constraint rejects. If this ever reads 25, that constraint stopped working.
n=$(q "select count(*) from leads")
if [ "$n" = "24" ]; then echo "  PASS  24 migrated leads intact"; pass=$((pass+1))
else echo "  FAIL  expected 24 leads, found $n"; fail=$((fail+1)); fi

# The catalog is the CMS. If a seed count drifts, content was silently lost.
for pair in "services:11" "service_tiers:34" "service_areas:16" "reviews:18" "articles:6" "settings:42"; do
  t="${pair%%:*}"; want="${pair##*:}"; got=$(q "select count(*) from $t")
  if [ "$got" = "$want" ]; then echo "  PASS  $t = $want"; pass=$((pass+1))
  else echo "  FAIL  $t expected $want, found $got"; fail=$((fail+1)); fi
done

# The bug that nearly shipped: one-time cleanup prices on BUILDUP, not dogs.
b=$(q "select price_basis from services where slug='one-time-dog-poop-cleanup'")
if [ "$b" = "choice" ]; then echo "  PASS  one-time cleanup prices on a choice, not dogs"; pass=$((pass+1))
else echo "  FAIL  one-time cleanup basis is '$b' — asking the wrong question mis-quotes every customer"; fail=$((fail+1)); fi

# A "from" price must never be presented as final.
f=$(q "select count(*) from service_tiers where price_is_from")
if [ "$f" = "3" ]; then echo "  PASS  3 'from' prices flagged"; pass=$((pass+1))
else echo "  FAIL  expected 3 'from' prices, found $f"; fail=$((fail+1)); fi

# The hash chain must be COMPUTED, not left null by a caller that forgot.
h=$(q "select case when hash is not null and length(hash)=64 then 'ok' else 'missing' end from events where seq=1")
if [ "$h" = "ok" ]; then echo "  PASS  event hash computed on insert"; pass=$((pass+1))
else echo "  FAIL  event hash is '$h' — a tamper-evidence field nobody fills is worse than none"; fail=$((fail+1)); fi

# A sound chain verifies; a forged link is found. Both directions.
q "insert into events (subject_kind,subject_id,seq,event_type,actor_kind) values ('visit','$VI',2,'visit.assigned','owner')" >/dev/null
v=$(q "select coalesce(events_verify_chain('visit','$VI')::text,'sound')")
if [ "$v" = "sound" ]; then echo "  PASS  chain of 2 verifies"; pass=$((pass+1))
else echo "  FAIL  chain did not verify, first bad seq=$v"; fail=$((fail+1)); fi

# events refuses UPDATE, so forge by disabling the trigger - the only way in - and
# confirm the verifier still catches it.
q "alter table events disable trigger events_no_update; update events set payload='{\"forged\":true}'::jsonb where seq=2; alter table events enable trigger events_no_update" >/dev/null
v2=$(q "select coalesce(events_verify_chain('visit','$VI')::text,'sound')")
if [ "$v2" = "2" ]; then echo "  PASS  a forged payload is detected at seq 2"; pass=$((pass+1))
else echo "  FAIL  forgery undetected (verifier said '$v2') — the chain is decoration"; fail=$((fail+1)); fi

# Exactly one Stripe connection row, and it must not start enabled.
sc=$(q "select count(*)||'/'||bool_or(charges_enabled)::text from stripe_connection")
if [ "$sc" = "1/false" ]; then echo "  PASS  stripe_connection: one row, charges disabled until probed"; pass=$((pass+1))
else echo "  FAIL  stripe_connection is '$sc'"; fail=$((fail+1)); fi

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
