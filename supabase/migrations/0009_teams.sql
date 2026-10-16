-- Teams, and programs written for one athlete.
--
-- A team is a group of athletes on the same program from the same start date. An athlete can also
-- have their own program (profiles.program_id), which takes priority over their team's. Programs
-- with owner_id set are that athlete's own copy and stay out of the main programs list.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  program_id uuid references public.programs (id) on delete set null,
  start_date date,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists team_id uuid references public.teams (id) on delete set null;
alter table public.programs add column if not exists owner_id uuid references public.profiles (id) on delete cascade;

alter table public.teams enable row level security;
drop policy if exists "teams: coach all" on public.teams;
create policy "teams: coach all" on public.teams for all using (is_coach()) with check (is_coach());
drop policy if exists "teams: member reads own" on public.teams;
create policy "teams: member reads own" on public.teams for select
  using (is_approved() and id = (select team_id from public.profiles where id = auth.uid()));

-- Athletes read their own program and their team's.
drop policy if exists "programs: client reads assigned" on public.programs;
create policy "programs: client reads assigned" on public.programs for select
  using (is_approved() and (
    id = (select program_id from public.profiles where id = auth.uid())
    or id = (select t.program_id from public.teams t join public.profiles p on p.team_id = t.id where p.id = auth.uid())));

-- Clients may edit their name and goal, nothing that changes access or programming.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() then
    new.role := old.role; new.approved := old.approved;
    new.program_id := old.program_id; new.start_date := old.start_date; new.email := old.email;
    new.team_id := old.team_id;
  end if;
  return new;
end $$;
