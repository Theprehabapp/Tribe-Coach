-- Team leaderboard for workout scores (a Fran time, AMRAP rounds, calories), like TrainHeroic's scored blocks.
--
-- Returns every finished, scored block of a team's athletes, with the block's name and scoring tag from the
-- program, so the app can rank them per workout and day. Same access as team_board(): the coach, or an approved
-- member of that team with the leaderboard switched on. Athletes still can't read each other's logs.
create or replace function public.team_scores(team uuid)
returns table (client_id uuid, athlete text, workout text, score text, result text, day date)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select is_coach() or (is_approved() and exists (
      select 1 from profiles me join teams t on t.id = me.team_id where me.id = auth.uid() and t.id = team and t.leaderboard)) as ok
  ), ents as (
    select l.client_id, l.date, en, (
      select ex from programs pr, jsonb_array_elements(pr.weeks -> l.week -> 'days') d, jsonb_array_elements(d -> 'exercises') ex
      where pr.id = l.program_id and d->>'id' = l.day_id and ex->>'id' = en->>'exId' limit 1) as block
    from logs l
    join profiles p on p.id = l.client_id and p.team_id = team and p.approved
    cross join jsonb_array_elements(l.entries) en
    where l.done and (select ok from allowed) and trim(coalesce(en->>'result', '')) <> ''
  )
  select e.client_id, coalesce(nullif(trim(p.name), ''), 'Athlete'),
    trim(coalesce(nullif(e.block->>'name', ''), e.en->>'name', '')), coalesce(e.block->>'score', ''), trim(e.en->>'result'), e.date
  from ents e join profiles p on p.id = e.client_id
  where trim(coalesce(nullif(e.block->>'name', ''), e.en->>'name', '')) <> '';
$$;
revoke execute on function public.team_scores(uuid) from public, anon;
grant execute on function public.team_scores(uuid) to authenticated;
