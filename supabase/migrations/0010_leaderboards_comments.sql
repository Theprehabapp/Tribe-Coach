-- Team leaderboards, and comments on a logged session.
--
-- Leaderboard: each team member's best set per lift, ranked by estimated 1RM (Epley, sets of 1 to 12
-- reps), visible to the coach and, when the team has it switched on, to the team's own athletes.
-- Athletes still can't read each other's logs; they only get this summary, through team_board().
--
-- Comments: a chat message can point at a logged session (messages.log_id), so the coach can comment
-- on a session and the athlete replies in the same chat, with the usual push and email alerts.

alter table public.teams add column if not exists leaderboard boolean not null default true;
alter table public.messages add column if not exists log_id uuid references public.logs (id) on delete set null;

-- Same as 0004, plus: a session reference must be one of this athlete's logs.
create or replace function public.guard_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid(); new.created_at := now(); new.read_at := null;
  if not is_coach() then new.client_id := auth.uid(); new.clip_path := null; end if;
  if new.clip_path is not null and split_part(new.clip_path, '/', 1) <> new.client_id::text then
    raise exception 'clip must be in the athlete''s folder';
  end if;
  if new.video_id is not null and not exists (select 1 from videos where id = new.video_id and client_id = new.client_id) then
    new.video_id := null;
  end if;
  if new.log_id is not null and not exists (select 1 from logs where id = new.log_id and client_id = new.client_id) then
    new.log_id := null;
  end if;
  return new;
end $$;

-- Best set per athlete per lift for one team. Empty unless the caller is the coach, or an approved
-- member of that team with the leaderboard switched on. Names come from the log entry, or the program
-- for entries logged before names were stored.
create or replace function public.team_board(team uuid)
returns table (client_id uuid, athlete text, exercise text, e1rm numeric, kg numeric, reps int, day date)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select is_coach() or (is_approved() and exists (
      select 1 from profiles me join teams t on t.id = me.team_id where me.id = auth.uid() and t.id = team and t.leaderboard)) as ok
  ), sets as (
    select l.client_id, l.date,
      trim(coalesce(nullif(en->>'name', ''), (
        select ex->>'name' from programs pr, jsonb_array_elements(pr.weeks -> l.week -> 'days') d, jsonb_array_elements(d -> 'exercises') ex
        where pr.id = l.program_id and d->>'id' = l.day_id and ex->>'id' = en->>'exId' limit 1), '')) as name,
      case when s->>'kg' ~ '^\s*\d+([.,]\d+)?\s*$' then replace(trim(s->>'kg'), ',', '.')::numeric end as kg,
      case when s->>'reps' ~ '^\s*\d+\s*$' then trim(s->>'reps')::int end as reps
    from logs l
    join profiles p on p.id = l.client_id and p.team_id = team and p.approved
    cross join jsonb_array_elements(l.entries) en
    cross join jsonb_array_elements(coalesce(en->'sets', '[]'::jsonb)) s
    where l.done and (select ok from allowed)
  ), scored as (
    select *, case when reps = 1 then kg else round(kg * (1 + reps / 30.0), 1) end as est
    from sets where name <> '' and kg > 0 and reps between 1 and 12
  )
  select distinct on (sc.client_id, lower(sc.name))
    sc.client_id, coalesce(nullif(trim(p.name), ''), 'Athlete'), sc.name, sc.est, sc.kg, sc.reps, sc.date
  from scored sc join profiles p on p.id = sc.client_id
  order by sc.client_id, lower(sc.name), sc.est desc, sc.date;
$$;
grant execute on function public.team_board(uuid) to authenticated;
