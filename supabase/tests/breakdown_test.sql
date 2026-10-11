-- Breakdown permissions check. Run after stub.sql, 0001 and 0002 on a scratch Postgres. The "expect error" line should error.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;
set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy sends a video trying to attach a breakdown herself (review_path should be null)'
insert into videos (client_id, exercise, slot, review_path) values (auth.uid(), 'Squat', '2026-10-13', 'x') returning review_path;
\echo '--- Amy cannot write to Ben folder (expect error)'
insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-0000000000b2/review-x.mp4');
\echo '--- Amy cannot update video to add review_path (expect 0 rows)'
update videos set review_path = 'y' returning id;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach uploads breakdown into Amy folder (expect ok) and attaches it'
insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-0000000000a1/review-1.mp4') returning name;
update videos set review_path = '00000000-0000-0000-0000-0000000000a1/review-1.mp4' returning review_path;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy can read her breakdown file (expect 1)'
select count(*) from storage.objects where name like '%review-1.mp4';
set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben cannot read it (expect 0)'
select count(*) from storage.objects where name like '%review-1.mp4';
