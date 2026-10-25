-- Athletes added to a team by email before they sign up.
--
-- The coach lists emails on a team. An email that already has an account joins the team at once;
-- the rest wait in team_invites, and the account made with that email starts in the team, approved,
-- because the coach has already vouched for it.

create table if not exists public.team_invites (
  email text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  team_id uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.team_invites enable row level security;
drop policy if exists "team_invites: coach all" on public.team_invites;
create policy "team_invites: coach all" on public.team_invites for all using (is_coach()) with check (is_coach());

-- An invite for someone who already has an account moves them straight into the team instead of waiting.
create or replace function public.place_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  update profiles set team_id = new.team_id, approved = true where lower(email) = new.email and role = 'client';
  if found then return null; end if;
  return new;
end $$;
drop trigger if exists place_invite on public.team_invites;
create trigger place_invite before insert or update on public.team_invites
  for each row execute function public.place_invite();

-- A new account whose email was invited starts in that team, approved, and the invite is used up.
create or replace function public.claim_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if new.role <> 'client' then return new; end if;
  delete from team_invites where email = lower(trim(new.email)) returning team_id into t;
  if t is not null then new.team_id := t; new.approved := true; end if;
  return new;
end $$;
drop trigger if exists claim_invite on public.profiles;
create trigger claim_invite before insert on public.profiles
  for each row execute function public.claim_invite();

revoke execute on function public.place_invite() from public, anon, authenticated;
revoke execute on function public.claim_invite() from public, anon, authenticated;
