-- Numbers imported from TrainHeroic, held by email. Run after stub.sql and migrations 0001-0018 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
grant execute on function apply_all_imported_numbers() to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','amy@x','{"name":"Amy"}');
reset role;
insert into maxes (client_id, exercise, kg, tested_on) values ('00000000-0000-0000-0000-0000000000a1', 'Back Squat', 120, '2026-11-01'), ('00000000-0000-0000-0000-0000000000a1', 'deadlift', 140, '2026-01-01');

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach loads numbers for Amy (has an account) and Ben (not yet)'
insert into imported_numbers (email, kind, name, category, kg, value, on_date) values
  ('amy@x', 'max', 'Back Squat', null, 110, null, '2026-09-01'),
  ('amy@x', 'max', 'Deadlift', null, 150, null, '2026-09-01'),
  ('amy@x', 'max', 'Power Clean', null, 80, null, '2026-08-01'),
  ('amy@x', 'pr', 'Fran', 'benchmark', null, '3:12', '2026-07-01'),
  ('ben@x', 'max', 'Front Squat', null, 100, null, '2026-09-02'),
  ('ben@x', 'pr', 'Strict Pull Ups', 'gymnastics', null, '15', '2026-09-02');
\echo '--- Bad rows are refused (expect 3 errors)'
insert into imported_numbers (email, kind, name, kg) values ('amy@x', 'max', 'X', null);
insert into imported_numbers (email, kind, name, category, value) values ('amy@x', 'pr', 'Y', 'lift', '5');
insert into imported_numbers (email, kind, name, kg) values ('Amy@x', 'max', 'Z', 50);
\echo '--- Apply: 1 athlete (expect 1)'
select apply_all_imported_numbers();
\echo '--- Amy: newer app squat kept (120), older deadlift replaced (150), clean added (expect Back Squat 120, Deadlift 150, Power Clean 80)'
select exercise, kg from maxes where client_id = '00000000-0000-0000-0000-0000000000a1' order by exercise;
\echo '--- Amy Fran in prs and history (expect 3:12 | 1)'
select value, (select count(*) from pr_history where name = 'Fran') from prs where name = 'Fran';
\echo '--- Only Ben left waiting (expect ben@x 2)'
select email, count(*) from imported_numbers group by email;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy cannot see or run the import (expect 0, error)'
select count(*) from imported_numbers;
select apply_all_imported_numbers();

reset role;
\echo '--- Ben signs up with a capitalised email: numbers land, waiting rows cleared (expect Front Squat 100, 15, 0)'
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','Ben@X','{"name":"Ben"}');
select exercise, kg from maxes where client_id = '00000000-0000-0000-0000-0000000000b2';
select value from prs where client_id = '00000000-0000-0000-0000-0000000000b2';
select count(*) from imported_numbers;
set request.jwt.uid = '';
\echo '--- Running the apply again is harmless (expect 0)'
select apply_all_imported_numbers();
