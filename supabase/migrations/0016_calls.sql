-- Monthly check-in calls. The coach sets the hours (settings.calls); athletes book one 30-minute
-- slot a month in the last days of the month. Each booking and cancellation emails a calendar invite
-- to the athlete and the coach (same Resend setup as the other alerts).

alter table public.settings add column if not exists calls jsonb not null
  default '{"on": true, "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00", "tz": "Australia/Sydney", "window": 7}';

-- A row is a booked slot, or a slot the coach blocked (no athlete).
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.profiles (id) on delete cascade,
  starts_at timestamptz not null unique,
  month text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists calls_one_a_month on public.calls (client_id, month) where client_id is not null;

alter table public.calls enable row level security;
drop policy if exists "calls: own or coach reads" on public.calls;
create policy "calls: own or coach reads" on public.calls for select using (client_id = auth.uid() or is_coach());
drop policy if exists "calls: athlete books own" on public.calls;
create policy "calls: athlete books own" on public.calls for insert
  with check (is_coach() or (client_id = auth.uid() and exists (select 1 from profiles where id = auth.uid() and approved)));
drop policy if exists "calls: cancel own or coach" on public.calls;
create policy "calls: cancel own or coach" on public.calls for delete
  using (is_coach() or (client_id = auth.uid() and starts_at > now() + interval '12 hours'));

-- Every taken time (booked or blocked) in a month, without saying who: athletes fade these out.
create or replace function public.taken_calls(for_month text) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select starts_at from calls where month = for_month and auth.uid() is not null;
$$;
grant execute on function public.taken_calls(text) to authenticated;

-- Works out the month, and holds athletes to the coach's hours. The coach can book or block any time.
create or replace function public.check_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c jsonb; tz text; loc timestamp; last_day date;
begin
  select calls into c from settings where id = 1;
  tz := coalesce(c->>'tz', 'Australia/Sydney');
  loc := new.starts_at at time zone tz;
  new.month := to_char(loc, 'YYYY-MM');
  if is_coach() then return new; end if;
  last_day := (date_trunc('month', loc) + interval '1 month - 1 day')::date;
  if coalesce((c->>'on')::boolean, true) is not true
    or new.starts_at <= now()
    or extract(second from loc) <> 0 or extract(minute from loc)::int % 30 <> 0
    or not (c->'days') @> to_jsonb(extract(dow from loc)::int)
    or loc::time < (c->>'start')::time or loc::time + interval '30 minutes' > (c->>'end')::time
    or loc::date <= last_day - coalesce((c->>'window')::int, 7)
  then
    raise exception 'That time is not open for check-in calls.';
  end if;
  return new;
end $$;

drop trigger if exists check_call on public.calls;
create trigger check_call before insert on public.calls for each row execute function public.check_call();

-- A calendar invite (or cancellation) for one call, emailed to the athlete and the coach.
-- An .ics attachment shows up in Gmail, Outlook and Apple Mail as an invite with Add to calendar.
create or replace function public.email_call(r calls, cancel boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  s settings; key text; coach text; athlete text; who text; ics text; stamp text; fmt text := 'YYYYMMDD"T"HH24MISS"Z"'; whenx text;
begin
  if r.client_id is null then return; end if;
  select * into s from settings where id = 1;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  select email into coach from profiles where role = 'coach' order by created_at limit 1;
  select email, coalesce(nullif(name, ''), email) into athlete, who from profiles where id = r.client_id;
  if key is null or coach is null or athlete is null then return; end if;
  stamp := to_char(now() at time zone 'UTC', fmt);
  whenx := to_char(r.starts_at at time zone coalesce(s.calls->>'tz', 'Australia/Sydney'), 'FMDay FMDD Mon, FMHH12:MI am');
  ics := concat_ws(E'\r\n', 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tribe Coach//Calls//EN',
    'METHOD:' || case when cancel then 'CANCEL' else 'REQUEST' end, 'BEGIN:VEVENT',
    'UID:' || r.id || '@tribe-coach', 'SEQUENCE:' || case when cancel then 1 else 0 end, 'DTSTAMP:' || stamp,
    'DTSTART:' || to_char(r.starts_at at time zone 'UTC', fmt),
    'DTEND:' || to_char((r.starts_at + interval '30 minutes') at time zone 'UTC', fmt),
    'SUMMARY:Tribe check-in call: ' || who,
    'ORGANIZER;CN=Tribe Coach:mailto:' || coach,
    'ATTENDEE;CN=' || who || ';ROLE=REQ-PARTICIPANT:mailto:' || athlete,
    'STATUS:' || case when cancel then 'CANCELLED' else 'CONFIRMED' end, 'END:VEVENT', 'END:VCALENDAR');
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', s.alert_from,
      'to', jsonb_build_array(athlete, coach),
      'subject', case when cancel then 'Cancelled: ' else '' end || 'Tribe check-in call, ' || whenx || ' (' || who || ')',
      'text', case when cancel then 'This check-in call has been cancelled. Book another time in the app: '
                   else 'Your 30-minute check-in call is booked for ' || whenx || ' (' || coalesce(s.calls->>'tz', 'Australia/Sydney') || E' time).\n\nOpen the attached invite to add it to your calendar. To change it, cancel in the app and pick another time: ' end
        || rtrim(s.app_url, '/'),
      'attachments', jsonb_build_array(jsonb_build_object(
        'filename', case when cancel then 'cancel.ics' else 'invite.ics' end,
        'content', replace(encode(convert_to(ics, 'UTF8'), 'base64'), E'\n', ''),
        'content_type', 'text/calendar; method=' || case when cancel then 'CANCEL' else 'REQUEST' end))
    )
  );
exception when others then
  raise warning 'call email not sent: %', sqlerrm;
end $$;

create or replace function public.alert_call() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform email_call(new, false); return new; end if;
  if old.starts_at > now() then perform email_call(old, true); end if;
  return old;
end $$;

drop trigger if exists alert_call on public.calls;
create trigger alert_call after insert or delete on public.calls for each row execute function public.alert_call();
