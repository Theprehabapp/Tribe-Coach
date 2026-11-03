-- Athletes' numbers brought over from TrainHeroic, held by email until the athlete has an account.
--
-- Each row is a 1RM (kind 'max', in kg) or a PR (kind 'pr', a gymnastics or benchmark score as text).
-- Rows for an email that already has an account are applied at once; the rest wait here and are
-- applied when an account with that email is made. A number already in the app that is newer than
-- the imported one is kept.

create table if not exists public.imported_numbers (
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  kind text not null check (kind in ('max', 'pr')),
  name text not null check (length(trim(name)) between 1 and 80),
  category text check (category is null or category in ('gymnastics', 'benchmark')),
  kg numeric(6, 2) check (kg is null or (kg > 0 and kg < 1000)),
  value text check (value is null or length(trim(value)) between 1 and 20),
  on_date date not null default current_date,
  check ((kind = 'max' and kg is not null) or (kind = 'pr' and value is not null and category is not null))
);
create unique index if not exists imported_numbers_key on public.imported_numbers (email, kind, lower(trim(name)));
alter table public.imported_numbers enable row level security;
drop policy if exists "imported_numbers: coach all" on public.imported_numbers;
create policy "imported_numbers: coach all" on public.imported_numbers for all using (is_coach()) with check (is_coach());

-- Moves one person's waiting numbers into maxes / prs / pr_history, then clears them.
create or replace function public.apply_imported_numbers(person uuid, mail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into maxes (client_id, exercise, kg, tested_on)
    select person, trim(n.name), n.kg, n.on_date from imported_numbers n where n.email = lower(trim(mail)) and n.kind = 'max'
  on conflict (client_id, lower(trim(exercise))) do update
    set exercise = excluded.exercise, kg = excluded.kg, tested_on = excluded.tested_on, updated_at = now()
    where maxes.tested_on < excluded.tested_on;

  insert into prs (client_id, name, category, value, scored_on)
    select person, trim(n.name), n.category, trim(n.value), n.on_date from imported_numbers n where n.email = lower(trim(mail)) and n.kind = 'pr'
  on conflict (client_id, lower(trim(name))) do update
    set name = excluded.name, category = excluded.category, value = excluded.value, scored_on = excluded.scored_on, updated_at = now()
    where prs.scored_on < excluded.scored_on;

  insert into pr_history (client_id, name, category, value, scored_on)
    select person, trim(n.name), n.category, trim(n.value), n.on_date from imported_numbers n where n.email = lower(trim(mail)) and n.kind = 'pr'
  on conflict do nothing;

  delete from imported_numbers where email = lower(trim(mail));
end $$;

-- Applies everything waiting for emails that already have an athlete account. Returns how many athletes got numbers.
create or replace function public.apply_all_imported_numbers() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; c integer := 0;
begin
  if auth.uid() is not null and not is_coach() then raise exception 'coach only'; end if;
  for r in select p.id, lower(p.email) as email from profiles p
           where p.role = 'client' and exists (select 1 from imported_numbers n where n.email = lower(p.email)) loop
    perform apply_imported_numbers(r.id, r.email);
    c := c + 1;
  end loop;
  return c;
end $$;

-- A new athlete account picks up its waiting numbers.
create or replace function public.claim_imported_numbers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'client' and new.email is not null then perform apply_imported_numbers(new.id, new.email); end if;
  return null;
end $$;
drop trigger if exists claim_imported_numbers on public.profiles;
create trigger claim_imported_numbers after insert on public.profiles
  for each row execute function public.claim_imported_numbers();

revoke execute on function public.apply_imported_numbers(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_imported_numbers() from public, anon, authenticated;
revoke execute on function public.apply_all_imported_numbers() from public, anon;
