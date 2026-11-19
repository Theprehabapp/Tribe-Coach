-- Paid plans from the public /join page (Stripe). One row per athlete: which plan, and whether it's paid up.
-- Only the Cloudflare worker writes here, through billing_sync() with the service role key, after Stripe
-- confirms a payment. Athletes read their own row (for Manage billing); the coach reads everyone's.
-- A paid plan (active or trialing) approves the account, so new athletes from /join don't wait for the coach.
-- A cancelled or failed payment is recorded but does NOT remove access: the coach decides that in Clients.
-- Streams: each team can take website sign-ups for one stream (teams.stream). On their first payment a new athlete
-- joins that team. For a "week1" stream (Body Transformation) they also get their own copy of the team's program,
-- starting at week 1 this Monday (Sydney time); for a "rolling" stream they train the live week with the team.

alter table public.teams add column if not exists stream text;
create unique index if not exists teams_stream_key on public.teams (stream) where stream is not null;

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null default '',
  plan text not null default '',
  status text not null default '',          -- Stripe's word: active, trialing, past_due, canceled, unpaid, ...
  stripe_customer text,
  stripe_subscription text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions: own or coach reads" on public.subscriptions;
create policy "subscriptions: own or coach reads" on public.subscriptions for select using (user_id = auth.uid() or is_coach());

-- Clients may edit their name and goal, nothing that changes access or programming.
-- New: billing_sync() may approve an account (it marks its own transaction with tribe.billing).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() and coalesce(current_setting('tribe.billing', true), '') <> 'on' then
    new.role := old.role; new.approved := old.approved;
    new.program_id := old.program_id; new.start_date := old.start_date; new.email := old.email;
    new.team_id := old.team_id;
  end if;
  return new;
end $$;

drop function if exists public.billing_sync(uuid, text, text, text, text, text, timestamptz);
create or replace function public.billing_sync(p_user uuid, p_email text, p_plan text, p_status text,
  p_customer text, p_subscription text, p_period_end timestamptz, p_stream text default '', p_join text default 'rolling') returns void
language plpgsql security definer set search_path = public as $$
declare prof profiles; t teams; new_prog uuid;
begin
  if not exists (select 1 from profiles where id = p_user) then return; end if;  -- account deleted since
  insert into subscriptions as s (user_id, email, plan, status, stripe_customer, stripe_subscription, current_period_end, updated_at)
  values (p_user, coalesce(p_email, ''), coalesce(p_plan, ''), coalesce(p_status, ''), p_customer, p_subscription, p_period_end, now())
  on conflict (user_id) do update set
    email = coalesce(nullif(excluded.email, ''), s.email),
    plan = coalesce(nullif(excluded.plan, ''), s.plan),
    status = excluded.status,
    stripe_customer = coalesce(excluded.stripe_customer, s.stripe_customer),
    stripe_subscription = excluded.stripe_subscription,
    current_period_end = excluded.current_period_end,
    updated_at = now()
  -- An old subscription's late "cancelled" must not overwrite a newer one the athlete has since started.
  where s.stripe_subscription is null or s.stripe_subscription = excluded.stripe_subscription
     or excluded.status in ('active', 'trialing') or s.status not in ('active', 'trialing');
  if p_status in ('active', 'trialing') then
    perform set_config('tribe.billing', 'on', true);
    update profiles set approved = true where id = p_user and role = 'client' and not approved;
    -- First payment only: someone with no team and no program of their own goes into their stream's team.
    -- The row lock stops two webhooks arriving together from making two copies.
    select * into prof from profiles where id = p_user for update;
    select * into t from teams where stream = nullif(p_stream, '');
    if prof.role = 'client' and prof.team_id is null and prof.program_id is null and t.id is not null then
      if p_join = 'week1' and t.program_id is not null then
        insert into programs (name, note, weeks, owner_id)
          select name || ' (' || coalesce(nullif(prof.name, ''), prof.email, 'athlete') || ')', note, weeks, p_user from programs where id = t.program_id
          returning id into new_prog;
        update profiles set team_id = t.id, program_id = new_prog,
          start_date = date_trunc('week', now() at time zone 'Australia/Sydney')::date where id = p_user;
      else
        update profiles set team_id = t.id where id = p_user;
      end if;
    end if;
    perform set_config('tribe.billing', '', true);
  end if;
end $$;
revoke all on function public.billing_sync(uuid, text, text, text, text, text, timestamptz, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.billing_sync(uuid, text, text, text, text, text, timestamptz, text, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.billing_sync(uuid, text, text, text, text, text, timestamptz, text, text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.billing_sync(uuid, text, text, text, text, text, timestamptz, text, text) to service_role; end if;
end $$;
