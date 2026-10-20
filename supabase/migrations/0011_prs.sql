-- PR board: each athlete's best unbroken gymnastics sets and benchmark workout scores. Barbell PRs stay
-- in maxes (0008) so percentage targets keep working off them.
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

-- Sets (or with val null, removes) one PR. The coach can set anyone's; an athlete only their own.
create or replace function public.set_pr(person uuid, pr_name text, cat text, val text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_coach() or (person = auth.uid() and is_approved())) then raise exception 'not allowed'; end if;
  if nullif(trim(val), '') is null then
    delete from prs where client_id = person and lower(trim(name)) = lower(trim(pr_name));
  else
    insert into prs (client_id, name, category, value) values (person, trim(pr_name), cat, trim(val))
    on conflict (client_id, lower(trim(name))) do update
      set value = excluded.value, category = excluded.category, scored_on = current_date, updated_at = now();
  end if;
end $$;
grant execute on function public.set_pr(uuid, text, text, text) to authenticated;
