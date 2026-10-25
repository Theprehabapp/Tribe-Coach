-- Team invites by email. Run after stub.sql and migrations 0001-0014 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','amy@x','{"name":"Amy"}');
insert into teams (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Morning Crew');

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach invites Amy (has an account) and Ben (not yet): Amy joins at once, Ben waits (expect amy@x | t | t, then ben@x)'
insert into team_invites (email, team_id) values (' Amy@X ', '00000000-0000-0000-0000-0000000000f1'), ('ben@x', '00000000-0000-0000-0000-0000000000f1');
select email, team_id is not null, approved from profiles where email = 'amy@x';
select email from team_invites;
\echo '--- A bad email is refused (expect error)'
insert into team_invites (email, team_id) values ('nope', '00000000-0000-0000-0000-0000000000f1');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy cannot see or add invites (expect 0, error)'
select count(*) from team_invites;
insert into team_invites (email, team_id) values ('cat@x', '00000000-0000-0000-0000-0000000000f1');

reset role;
\echo '--- Ben signs up with a capitalised email: starts in the team, approved, invite used up (expect t | t, 0)'
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','Ben@x','{"name":"Ben"}');
select team_id = '00000000-0000-0000-0000-0000000000f1', approved from profiles where id = '00000000-0000-0000-0000-0000000000b2';
select count(*) from team_invites;
\echo '--- Someone not invited still waits for approval with no team (expect f | t)'
insert into auth.users values ('00000000-0000-0000-0000-0000000000d4','dan@x','{"name":"Dan"}');
select approved, team_id is null from profiles where email = 'dan@x';
\echo '--- Deleting the team clears waiting invites (expect 0)'
insert into team_invites (email, team_id) values ('eve@x', '00000000-0000-0000-0000-0000000000f1');
delete from teams;
select count(*) from team_invites;
