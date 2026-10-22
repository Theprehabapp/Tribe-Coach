-- PR board: each athlete's best unbroken gymnastics sets and benchmark workout scores, and a history of
-- every PR and 1RM. Barbell PRs stay in maxes (0008) so percentage targets keep working off them.
create table if not exists public.prs (
  client_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  category text not null check (category in ('gymnastics', 'benchmark')),
  -- As entered: reps ("25"), a time ("2:45"), metres ("40") or a score ("21+5", "380").
  value text not null check (length(trim(value)) between 1 and 20),
  scored_on date not null default current_date,
  updated_at timestamptz not null default now()
);
create unique index if not exists prs_key on public.prs (client_id, lower(trim(name)));

alter table public.prs enable row level security;
drop policy if exists "prs: coach reads" on public.prs;
create policy "prs: coach reads" on public.prs for select using (is_coach());
drop policy if exists "prs: client reads own" on public.prs;
create policy "prs: client reads own" on public.prs for select using (client_id = auth.uid());

-- One row per PR per day it changed. category 'lift' is a 1RM from maxes, value in kg.
create table if not exists public.pr_history (
  client_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  category text not null check (category in ('lift', 'gymnastics', 'benchmark')),
  value text not null,
  scored_on date not null default current_date
);
create unique index if not exists pr_history_key on public.pr_history (client_id, lower(trim(name)), scored_on);

alter table public.pr_history enable row level security;
drop policy if exists "pr_history: coach reads" on public.pr_history;
create policy "pr_history: coach reads" on public.pr_history for select using (is_coach());
drop policy if exists "pr_history: client reads own" on public.pr_history;
create policy "pr_history: client reads own" on public.pr_history for select using (client_id = auth.uid());

-- Today's history row follows the PR: set it, or (cleared, e.g. a typo) drop it. Earlier days stay.
create or replace function public.note_pr(person uuid, pr_name text, cat text, val text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if val is null then
    delete from pr_history where client_id = person and lower(trim(name)) = lower(trim(pr_name)) and scored_on = current_date;
  else
    insert into pr_history (client_id, name, category, value) values (person, trim(pr_name), cat, val)
    on conflict (client_id, lower(trim(name)), scored_on) do update set value = excluded.value, category = excluded.category;
  end if;
end $$;
revoke execute on function public.note_pr(uuid, text, text, text) from public, anon, authenticated;

-- Sets (or with val null, removes) one PR. The coach can set anyone's; an athlete only their own.
create or replace function public.set_pr(person uuid, pr_name text, cat text, val text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_coach() or (person = auth.uid() and is_approved())) then raise exception 'not allowed'; end if;
  if nullif(trim(val), '') is null then
    delete from prs where client_id = person and lower(trim(name)) = lower(trim(pr_name));
    perform note_pr(person, pr_name, cat, null);
  else
    insert into prs (client_id, name, category, value) values (person, trim(pr_name), cat, trim(val))
    on conflict (client_id, lower(trim(name))) do update
      set value = excluded.value, category = excluded.category, scored_on = current_date, updated_at = now();
    perform note_pr(person, pr_name, cat, trim(val));
  end if;
end $$;
grant execute on function public.set_pr(uuid, text, text, text) to authenticated;

-- 1RMs now keep their history too (same as 0008 plus the note_pr calls).
create or replace function public.set_max(person uuid, ex text, max_kg numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_coach() or (person = auth.uid() and is_approved())) then raise exception 'not allowed'; end if;
  if max_kg is null then
    delete from maxes where client_id = person and lower(trim(exercise)) = lower(trim(ex));
    perform note_pr(person, ex, 'lift', null);
  else
    insert into maxes (client_id, exercise, kg) values (person, trim(ex), max_kg)
    on conflict (client_id, lower(trim(exercise))) do update set kg = excluded.kg, tested_on = current_date, updated_at = now();
    perform note_pr(person, ex, 'lift', trim_scale(max_kg)::text);
  end if;
end $$;
grant execute on function public.set_max(uuid, text, numeric) to authenticated;

-- Start the history from the 1RMs already entered.
insert into public.pr_history (client_id, name, category, value, scored_on)
  select client_id, exercise, 'lift', trim_scale(kg)::text, tested_on from public.maxes
  on conflict do nothing;
