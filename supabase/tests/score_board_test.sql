-- Workout-score leaderboard. Run after stub.sql and migrations 0001-0020 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000d3','d@x','{"name":"Dan"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true;
insert into programs (id, name, weeks) values ('11111111-1111-1111-1111-111111111111', 'Block', '[{"days":[{"id":"d1","exercises":[{"id":"e1","name":"Fran","kind":"circuit","score":"(FOR TIME)"},{"id":"e2","name":"Back Squat"}]}]}]');
insert into teams (id, name) values ('33333333-3333-3333-3333-333333333333', 'Crew');
update profiles set team_id = '33333333-3333-3333-3333-333333333333' where email in ('a@x', 'b@x');
insert into logs (id, client_id, program_id, week, day_id, date, done, entries) values
 ('44444444-4444-4444-4444-444444444441', '00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 0, 'd1', '2026-11-04', true, '[{"exId":"e1","sets":[],"result":"3:45"},{"exId":"e2","sets":[{"reps":"5","kg":"100"}]}]'),
 ('44444444-4444-4444-4444-444444444442', '00000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 0, 'd1', '2026-11-04', true, '[{"exId":"e1","name":"Fran","sets":[],"result":" 2:59 "}]'),
 ('44444444-4444-4444-4444-444444444443', '00000000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111', 0, 'd1', '2026-11-04', true, '[{"exId":"e1","sets":[],"result":"1:00"}]'),
 ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000b2', null, 1, 'd9', '2026-11-05', false, '[{"exId":"e1","name":"Fran","sets":[],"result":"2:00"}]');

set role authenticated;
\echo '--- Coach: Amy 3:45 and Ben 2:59 with tag (FOR TIME); not Dan (other team), not unfinished or unscored (expect 2 rows)'
select athlete, workout, score, result from team_scores('33333333-3333-3333-3333-333333333333') order by athlete;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy, a member, sees the same 2'
select count(*) from team_scores('33333333-3333-3333-3333-333333333333');
set request.jwt.uid = '00000000-0000-0000-0000-0000000000d3';
\echo '--- Dan, not a member, gets nothing (expect 0)'
select count(*) from team_scores('33333333-3333-3333-3333-333333333333');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update teams set leaderboard = false;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Leaderboard switched off: Amy gets nothing (expect 0)'
select count(*) from team_scores('33333333-3333-3333-3333-333333333333');
