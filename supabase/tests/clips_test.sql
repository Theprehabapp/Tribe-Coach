-- Labelled breakdown clips. Run after stub.sql and migrations 0001-0006 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy uploads with clips filled in: they are dropped (expect [])'
insert into videos (exercise, slot, clips) values ('Squat', '2026-10-15', '[{"path":"x","label":"y"}]') returning clips;
\echo '--- Amy cannot add clips afterwards (expect 0 rows)'
update videos set clips = '[{"path":"x","label":"y"}]' returning id;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach adds two labelled clips (expect 2, Bar path)'
update videos set clips = '[{"path":"a/1.mp4","label":"Bar path"},{"path":"a/2.mp4","label":"Bracing"}]' returning jsonb_array_length(clips), clips->0->>'label';
\echo '--- Coach row from the coach-all policy still readable by Amy (expect 2)'
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
select jsonb_array_length(clips) from videos;
