-- Check-in calls move to the first days of the month (settings.calls.window = how many days, 7 by default).
-- Same rules as 0016 otherwise. Athletes book any time before.

create or replace function public.check_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c jsonb; tz text; loc timestamp;
begin
  select calls into c from settings where id = 1;
  tz := coalesce(c->>'tz', 'Australia/Sydney');
  loc := new.starts_at at time zone tz;
  new.month := to_char(loc, 'YYYY-MM');
  if is_coach() then return new; end if;
  if coalesce((c->>'on')::boolean, true) is not true
    or new.starts_at <= now()
    or extract(second from loc) <> 0 or extract(minute from loc)::int % 30 <> 0
    or not (c->'days') @> to_jsonb(extract(dow from loc)::int)
    or loc::time < (c->>'start')::time or loc::time + interval '30 minutes' > (c->>'end')::time
    or extract(day from loc) > coalesce((c->>'window')::int, 7)
  then
    raise exception 'That time is not open for check-in calls.';
  end if;
  return new;
end $$;
