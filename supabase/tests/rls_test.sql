-- RLS check. Run against a scratch Postgres: psql -f stub.sql, then the migration, then this file. Errors on the "should fail" lines are expected.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
select name, role, approved from profiles order by created_at;

set role authenticated;
-- unapproved client
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy before approval: sees own profile only, cannot upload'
select count(*) as profiles_visible from profiles;
insert into videos (client_id, exercise, slot) values (auth.uid(), 'Squat', '2026-10-13');
insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-0000000000a1/x.mp4');
\echo '--- Amy tries to approve herself'
update profiles set approved = true, role='coach' where id = auth.uid();
select approved, role from profiles where id = auth.uid();

-- coach
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- coach sees everyone, approves Amy, creates and assigns program'
select count(*) from profiles;
update profiles set approved = true where name = 'Amy';
insert into programs (id, name) values ('11111111-1111-1111-1111-111111111111','Block');
insert into programs (id, name) values ('22222222-2222-2222-2222-222222222222','Other');
update profiles set program_id='11111111-1111-1111-1111-111111111111', start_date='2026-09-28' where name='Amy';

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy approved: sees only assigned program, uploads, logs'
select name from programs;
insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-0000000000a1/x.mp4');
insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-0000000000b2/sneaky.mp4');
insert into videos (client_id, exercise, slot, status, feedback) values (auth.uid(), 'Squat', '2026-10-13', 'reviewed', 'self-approved');
select exercise, status, feedback from videos;
update videos set status='reviewed';
select status from videos;
insert into logs (client_id, program_id, week, day_id, date) values (auth.uid(), '11111111-1111-1111-1111-111111111111', 1, 'd1', '2026-10-05');
insert into logs (client_id, program_id, week, day_id, date) values ('00000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 1, 'd1', '2026-10-05');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben (unapproved) sees no videos, logs or programs, cannot read Amy file'
select (select count(*) from videos) v, (select count(*) from logs) l, (select count(*) from programs) p, (select count(*) from storage.objects) o;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- coach reviews, sees logs and files'
update videos set status='reviewed', verdict='good', feedback='Nice' returning status, verdict;
select (select count(*) from logs) l, (select count(*) from storage.objects) o;
