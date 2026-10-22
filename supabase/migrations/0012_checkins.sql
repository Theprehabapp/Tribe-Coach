-- Daily check-in: before training an athlete rates sleep, soreness and energy from 1 to 5 (5 is best:
-- slept well, not sore, full of energy). The coach sees who's flagging.
create table if not exists public.checkins (
  client_id uuid not null references public.profiles (id) on delete cascade,
  -- The athlete's own calendar day, sent by their phone (it can differ from the server's UTC date).
  day date not null,
  sleep smallint check (sleep between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  energy smallint check (energy between 1 and 5),
  note text not null default '' check (length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (client_id, day)
);

alter table public.checkins enable row level security;
drop policy if exists "checkins: coach reads" on public.checkins;
create policy "checkins: coach reads" on public.checkins for select using (is_coach());
drop policy if exists "checkins: client owns" on public.checkins;
create policy "checkins: client owns" on public.checkins for all
  using (client_id = auth.uid() and is_approved())
  with check (client_id = auth.uid() and is_approved() and day between current_date - 1 and current_date + 1);
