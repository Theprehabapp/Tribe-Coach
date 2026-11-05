-- The Library, filed the way TrainHeroic files it: flat lists per type, labelled with tags or categories.
--
-- Exercises gain TrainHeroic's fields: default parameters (the two set-table columns), up to 3 suggested
-- swaps, tags, a reference max (whose 1RM a % load uses), track as, and who created it. Points of
-- performance stay in cues, now up to 10,000 characters like TrainHeroic's.
-- Session templates, circuits and prescriptions live in library_items, one row each:
--   session:      data = a session exactly as the program builder stores a day (name, coachNote, exercises)
--   circuit:      data = { instructions, results, videos[] }
--   prescription: data = { param1, param2, rows[{reps, val}] }; tags hold its categories

alter table public.exercises
  add column if not exists param1 text not null default 'Reps',
  add column if not exists param2 text not null default 'Weight (kg)',
  add column if not exists tags text[] not null default '{}',
  add column if not exists swaps text[] not null default '{}',
  add column if not exists ref_max text not null default '',
  add column if not exists track_as text not null default '',
  add column if not exists created_by text not null default '';
alter table public.exercises drop constraint if exists exercises_cues_check;
alter table public.exercises add constraint exercises_cues_check check (length(cues) <= 10000);
alter table public.exercises drop constraint if exists exercises_swaps_check;
alter table public.exercises add constraint exercises_swaps_check check (cardinality(swaps) <= 3);

create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('session', 'circuit', 'prescription')),
  title text not null check (length(trim(title)) between 1 and 120),
  tags text[] not null default '{}',
  data jsonb not null default '{}',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_items_kind on public.library_items (kind, lower(title));
alter table public.library_items enable row level security;
drop policy if exists "library_items: coach all" on public.library_items;
create policy "library_items: coach all" on public.library_items for all using (is_coach()) with check (is_coach());
