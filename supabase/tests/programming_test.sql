-- Exercise library and 1RMs. Run after stub.sql and migrations 0001-0008 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true where email = 'a@x';

set role authenticated;
\echo '--- Coach adds exercises; a duplicate name in other capitals is refused (expect 1 row, then error)'
insert into exercises (name, demo_url, cues) values ('Back Squat', 'https://youtu.be/x', 'Brace') returning name;
insert into exercises (name) values ('  back squat ');
\echo '--- A non-https link is refused (expect error)'
insert into exercises (name, demo_url) values ('Deadlift', 'javascript:alert(1)');
\echo '--- Coach sets Amy''s 1RM twice: one row, latest kg (expect 1 | 125.00)'
select set_max('00000000-0000-0000-0000-0000000000a1', 'Back Squat', 120);
select set_max('00000000-0000-0000-0000-0000000000a1', 'back squat ', 125);
select count(*), max(kg) from maxes;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy reads the library (expect 1) and her own 1RM (expect 1)'
select count(*) from exercises;
select count(*) from maxes;
\echo '--- Amy cannot add to the library (expect error)'
insert into exercises (name) values ('Front Squat');
\echo '--- Amy sets her own Deadlift (ok) but not Ben''s (expect error)'
select set_max('00000000-0000-0000-0000-0000000000a1', 'Deadlift', 160);
select set_max('00000000-0000-0000-0000-0000000000b2', 'Deadlift', 999);
\echo '--- Amy cannot write the table directly (expect error)'
insert into maxes (client_id, exercise, kg) values ('00000000-0000-0000-0000-0000000000a1', 'Bench', 500);

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben (not approved) sees no library and no 1RMs, and cannot set his own (expect 0, 0, error)'
select count(*) from exercises;
select count(*) from maxes;
select set_max('00000000-0000-0000-0000-0000000000b2', 'Deadlift', 100);

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach removes Amy''s Deadlift (expect Back Squat only)'
select set_max('00000000-0000-0000-0000-0000000000a1', 'deadlift', null);
select exercise, kg from maxes;
