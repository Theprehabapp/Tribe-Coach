-- PR board. Run after stub.sql and migrations 0001-0011 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true where email = 'a@x';

set role authenticated;
\echo '--- Coach sets Amy''s Fran twice: one row, latest time (expect 1 | 2:41)'
select set_pr('00000000-0000-0000-0000-0000000000a1', 'Fran', 'benchmark', '2:58');
select set_pr('00000000-0000-0000-0000-0000000000a1', ' fran', 'benchmark', '2:41 ');
select count(*), max(value) from prs;
\echo '--- An unknown category is refused (expect error)'
select set_pr('00000000-0000-0000-0000-0000000000a1', 'Bench', 'strength', '100');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy sets her own Ring Muscle Ups (ok) but not Ben''s (expect error)'
select set_pr('00000000-0000-0000-0000-0000000000a1', 'Ring Muscle Ups', 'gymnastics', '12');
select set_pr('00000000-0000-0000-0000-0000000000b2', 'Ring Muscle Ups', 'gymnastics', '99');
\echo '--- Amy reads her own PRs (expect 2) and cannot write the table directly (expect error)'
select count(*) from prs;
insert into prs (client_id, name, category, value) values ('00000000-0000-0000-0000-0000000000a1', 'Grace', 'benchmark', '0:30');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben (not approved) sees none and cannot set his own (expect 0, error)'
select count(*) from prs;
select set_pr('00000000-0000-0000-0000-0000000000b2', 'Grace', 'benchmark', '1:50');

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach clears Amy''s Fran with an empty value (expect Ring Muscle Ups only)'
select set_pr('00000000-0000-0000-0000-0000000000a1', 'FRAN', 'benchmark', '');
select name, value from prs;
