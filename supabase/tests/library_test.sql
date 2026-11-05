-- Library (session templates, circuits, prescriptions) and the TrainHeroic exercise fields. Run after stub.sql and migrations 0001-0019.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','amy@x','{"name":"Amy"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true where email = 'amy@x';

set role authenticated;
\echo '--- Coach saves an exercise with tags, swaps, parameters (expect Back Squat | {Squat,Lower} | 2 | Weight (kg))'
insert into exercises (name, tags, swaps, param1, param2, ref_max) values ('Back Squat', '{Squat,Lower}', '{"Front Squat","Box Squat"}', 'Reps', 'Weight (kg)', '');
select name, tags, cardinality(swaps), param2 from exercises;
\echo '--- Four swaps and 10,001 characters of points are refused (expect 2 errors)'
insert into exercises (name, swaps) values ('X', '{a,b,c,d}');
insert into exercises (name, cues) values ('Y', repeat('a', 10001));
\echo '--- Long points of performance now fit (expect 5000)'
insert into exercises (name, cues) values ('Z', repeat('a', 5000)) returning length(cues);
\echo '--- Coach saves one of each library item (expect 3)'
insert into library_items (kind, title, tags, data) values ('session', 'W1D1', '{}', '{"name":"W1D1","exercises":[]}'),
  ('circuit', 'Fran', '{Conditioning}', '{"instructions":"21-15-9","results":"Time"}'), ('prescription', '5 x 3 @ 80%', '{Strength}', '{"param1":"Reps","param2":"Weight (%)","rows":[]}');
select count(*) from library_items;
\echo '--- Bad kind and blank title are refused (expect 2 errors)'
insert into library_items (kind, title) values ('folder', 'x');
insert into library_items (kind, title) values ('circuit', '  ');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Athlete sees no library items and cannot add one (expect 0, then 1 error)'
select count(*) from library_items;
insert into library_items (kind, title) values ('circuit', 'Mine');
\echo '--- Athlete still reads exercises for demos (expect 3)'
select count(*) from exercises;
