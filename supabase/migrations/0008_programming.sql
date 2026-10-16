-- Programming: an exercise library with demo videos, and each athlete's 1RMs so percentage targets
-- show as kilograms. Supersets need no database change (a "block" letter on each exercise in the
-- program's weeks JSON).

-- ---------- exercise library ----------
-- demo_url: a link (YouTube, Instagram). demo_path: an uploaded demo in the videos bucket, stored
-- as <coach id>/demo-<name>--<id>.mp4.
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  demo_url text not null default '' check (demo_url = '' or demo_url ~* '^https://'),
  demo_path text,
  cues text not null default '' check (length(cues) <= 1000),
  created_at timestamptz not null default now()
);
create unique index if not exists exercises_name on public.exercises (lower(trim(name)));

alter table public.exercises enable row level security;
drop policy if exists "exercises: coach all" on public.exercises;
create policy "exercises: coach all" on public.exercises for all using (is_coach()) with check (is_coach());
drop policy if exists "exercises: approved read" on public.exercises;
create policy "exercises: approved read" on public.exercises for select using (is_approved());

-- Athletes can play the coach's demo videos (only files named demo-...).
drop policy if exists "videos bucket: approved read demos" on storage.objects;
create policy "videos bucket: approved read demos" on storage.objects for select
  using (bucket_id = 'videos' and public.is_approved() and name ~ '^[^/]+/demo-'
         and (storage.foldername(name))[1] in (select id::text from public.profiles where role = 'coach'));

-- ---------- 1RMs ----------
create table if not exists public.maxes (
  client_id uuid not null references public.profiles (id) on delete cascade,
  exercise text not null check (length(trim(exercise)) between 1 and 80),
  kg numeric(6, 2) not null check (kg > 0 and kg < 1000),
  tested_on date not null default current_date,
  updated_at timestamptz not null default now()
);
create unique index if not exists maxes_key on public.maxes (client_id, lower(trim(exercise)));

alter table public.maxes enable row level security;
drop policy if exists "maxes: coach reads" on public.maxes;
create policy "maxes: coach reads" on public.maxes for select using (is_coach());
drop policy if exists "maxes: client reads own" on public.maxes;
create policy "maxes: client reads own" on public.maxes for select using (client_id = auth.uid());

-- Sets (or with kg null, removes) one 1RM. The coach can set anyone's; an athlete only their own.
create or replace function public.set_max(person uuid, ex text, max_kg numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_coach() or (person = auth.uid() and is_approved())) then raise exception 'not allowed'; end if;
  if max_kg is null then
    delete from maxes where client_id = person and lower(trim(exercise)) = lower(trim(ex));
  else
    insert into maxes (client_id, exercise, kg) values (person, trim(ex), max_kg)
    on conflict (client_id, lower(trim(exercise))) do update set kg = excluded.kg, tested_on = current_date, updated_at = now();
  end if;
end $$;
grant execute on function public.set_max(uuid, text, numeric) to authenticated;
