-- Scoop Dogg — make the event hash chain real.
--
-- 001 gave `events` a `prev_hash` and a `hash` column and nothing to fill them, which is
-- worse than having neither: a tamper-evidence field that nobody computes reads as
-- protection and provides none.
--
-- The chain is computed in the database, on insert, so it cannot be skipped by a caller
-- that forgot - including a future agent writing a verb.

begin;

create or replace function events_chain() returns trigger
language plpgsql as $$
declare last_hash text;
begin
  select e.hash into last_hash
    from events e
   where e.subject_kind = new.subject_kind and e.subject_id = new.subject_id
   order by e.seq desc limit 1;

  new.prev_hash := last_hash;
  -- Canonical over the fields that MATTER, in a fixed order. Adding a field to this
  -- digest changes every hash after it, so the set is deliberately small and stable.
  new.hash := encode(digest(
      coalesce(last_hash, '')          || '|' ||
      new.subject_kind                 || '|' ||
      new.subject_id::text             || '|' ||
      new.seq::text                    || '|' ||
      new.event_type                   || '|' ||
      coalesce(new.from_state, '')     || '|' ||
      coalesce(new.to_state, '')       || '|' ||
      new.actor_kind                   || '|' ||
      coalesce(new.actor_id::text, '') || '|' ||
      new.payload::text
    , 'sha256'), 'hex');
  return new;
end;
$$;

create trigger events_chain_before before insert on events
  for each row execute function events_chain();

-- Verify a subject's chain end to end. Returns the first seq that does not verify,
-- or null when the chain is sound. Read-only.
create or replace function events_verify_chain(p_kind text, p_id uuid)
returns integer
language plpgsql stable as $$
declare r record; expected text; prev text := null;
begin
  for r in select * from events where subject_kind = p_kind and subject_id = p_id order by seq loop
    expected := encode(digest(
        coalesce(prev, '')             || '|' || r.subject_kind || '|' || r.subject_id::text || '|' ||
        r.seq::text                    || '|' || r.event_type   || '|' ||
        coalesce(r.from_state, '')     || '|' || coalesce(r.to_state, '') || '|' ||
        r.actor_kind                   || '|' || coalesce(r.actor_id::text, '') || '|' ||
        r.payload::text
      , 'sha256'), 'hex');
    if r.hash is distinct from expected or r.prev_hash is distinct from prev then
      return r.seq;
    end if;
    prev := r.hash;
  end loop;
  return null;
end;
$$;

comment on function events_verify_chain is
  'Returns the first seq whose hash does not verify, or null when the chain is sound. '
  'A chain nobody checks is decoration, so gates/schema-guards.sh calls this.';

commit;
