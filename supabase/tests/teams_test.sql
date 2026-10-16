-- Teams and athlete-owned programs. Run after stub.sql and migrations 0001-0009 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000d3','d@x','{"name":"Dan"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true where email in ('a@x', 'b@x', 'd@x');

set role authenticated;
\echo '--- Coach creates two programs, a team on the first, puts Amy and Ben in it, gives Dan his own copy'
insert into programs (id, name, weeks) values ('11111111-1111-1111-1111-111111111111', 'Block 1', '[]'), ('22222222-2222-2222-2222-222222222222', 'Block 2', '[]');
insert into teams (id, name, program_id, start_date) values ('33333333-3333-3333-3333-333333333333', 'Morning Crew', '11111111-1111-1111-1111-111111111111', '2026-10-05');
update profiles set team_id = '33333333-3333-3333-3333-333333333333' where email in ('a@x', 'b@x');
insert into programs (id, name, weeks, owner_id) values ('44444444-4444-4444-4444-444444444444', 'Block 1 (Dan)', '[]', '00000000-0000-0000-0000-0000000000d3');
update profiles set program_id = '44444444-4444-4444-4444-444444444444' where email = 'd@x';
\echo '--- An empty team name is refused (expect error)'
insert into teams (name) values ('  ');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy reads her team (expect Morning Crew) and its program only (expect Block 1)'
select name from teams;
select name from programs;
\echo '--- Amy cannot move herself to another team or change the team (expect team unchanged, 0 rows updated)'
update profiles set team_id = null, name = 'Amy B' where id = auth.uid();
select name, team_id is not null as still_in_team from profiles where id = auth.uid();
update teams set program_id = '22222222-2222-2222-2222-222222222222';
\echo '--- Amy cannot create a team (expect error)'
insert into teams (name) values ('Mine');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000d3';
\echo '--- Dan (no team) sees no teams (expect 0) and only his own copy (expect Block 1 (Dan))'
select count(*) from teams;
select name from programs;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Deleting the team clears team_id on members (expect 0 still in a team)'
delete from teams;
select count(*) from profiles where team_id is not null;
\echo '--- Deleting Dan removes his own program (expect 2 programs left)'
reset role;
delete from profiles where email = 'd@x';
select count(*) from programs;
