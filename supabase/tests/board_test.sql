-- Leaderboards and session comments. Run after stub.sql and migrations 0001-0010 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000d3','d@x','{"name":"Dan"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true;
insert into programs (id, name, weeks) values ('11111111-1111-1111-1111-111111111111', 'Block', '[{"days":[{"id":"d1","exercises":[{"id":"e1","name":"Back Squat"}]}]}]');
insert into teams (id, name) values ('33333333-3333-3333-3333-333333333333', 'Crew');
update profiles set team_id = '33333333-3333-3333-3333-333333333333' where email in ('a@x', 'b@x');
-- Amy: an old entry with no stored name (name comes from the program), Ben: named entries incl. junk and a 15-rep set
insert into logs (id, client_id, program_id, week, day_id, date, done, entries) values
 ('44444444-4444-4444-4444-444444444441', '00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 0, 'd1', '2026-10-01', true, '[{"exId":"e1","sets":[{"reps":"5","kg":"100"},{"reps":"3","kg":"110"}]}]'),
 ('44444444-4444-4444-4444-444444444442', '00000000-0000-0000-0000-0000000000b2', null, 0, 'x', '2026-10-02', true, '[{"exId":"z","name":"back squat","sets":[{"reps":"1","kg":"125,5"},{"reps":"15","kg":"200"},{"reps":"","kg":"300"}]}]'),
 ('44444444-4444-4444-4444-444444444443', '00000000-0000-0000-0000-0000000000d3', null, 0, 'x', '2026-10-02', true, '[{"exId":"z","name":"Back Squat","sets":[{"reps":"1","kg":"300"}]}]'),
 ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000a1', null, 1, 'y', '2026-10-03', false, '[{"exId":"z","name":"Back Squat","sets":[{"reps":"1","kg":"400"}]}]');

set role authenticated;
\echo '--- Coach sees Amy 121 (110x3) and Ben 125.5 (1 rep), not Dan (other team) or unfinished logs (expect 2 rows)'
select athlete, exercise, e1rm, kg, reps from team_board('33333333-3333-3333-3333-333333333333') order by e1rm desc;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy, a member, sees the same 2 rows'
select count(*) from team_board('33333333-3333-3333-3333-333333333333');
\echo '--- Amy still cannot read Ben''s logs directly (expect 1, her own)'
select count(*) from logs where done;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000d3';
\echo '--- Dan, not a member, gets nothing (expect 0)'
select count(*) from team_board('33333333-3333-3333-3333-333333333333');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update teams set leaderboard = false;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Leaderboard switched off: Amy gets nothing (expect 0)'
select count(*) from team_board('33333333-3333-3333-3333-333333333333');
\echo '--- Amy comments on her own session (kept) and tries to point at Ben''s (dropped): expect t, f'
insert into messages (client_id, body, log_id) values ('00000000-0000-0000-0000-0000000000a1', 'Felt heavy', '44444444-4444-4444-4444-444444444441') returning log_id is not null;
insert into messages (client_id, body, log_id) values ('00000000-0000-0000-0000-0000000000a1', 'Sneaky', '44444444-4444-4444-4444-444444444442') returning log_id is not null;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach comments on Amy''s session (expect t)'
insert into messages (client_id, body, log_id) values ('00000000-0000-0000-0000-0000000000a1', 'Good depth', '44444444-4444-4444-4444-444444444441') returning log_id is not null;
