-- Daily check-ins. Run after stub.sql and migrations 0001-0012 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true where email = 'a@x';

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy checks in, then changes her energy: one row (expect 1 | 2)'
insert into checkins (client_id, day, sleep, soreness, energy) values ('00000000-0000-0000-0000-0000000000a1', current_date, 4, 3, 5);
insert into checkins (client_id, day, energy) values ('00000000-0000-0000-0000-0000000000a1', current_date, 2)
  on conflict (client_id, day) do update set energy = excluded.energy;
select count(*), max(energy) from checkins;
\echo '--- Out of range scores and far-off days are refused (expect 2 errors)'
insert into checkins (client_id, day, sleep) values ('00000000-0000-0000-0000-0000000000a1', current_date - 1, 6);
insert into checkins (client_id, day, sleep) values ('00000000-0000-0000-0000-0000000000a1', current_date - 9, 3);
\echo '--- Amy cannot check in for Ben (expect error)'
insert into checkins (client_id, day, sleep) values ('00000000-0000-0000-0000-0000000000b2', current_date, 3);

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben (not approved) sees nothing and cannot check in (expect 0, error)'
select count(*) from checkins;
insert into checkins (client_id, day, sleep) values ('00000000-0000-0000-0000-0000000000b2', current_date, 3);

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach reads Amy''s check-in (expect 1) but cannot write one (expect error)'
select count(*) from checkins;
insert into checkins (client_id, day, sleep) values ('00000000-0000-0000-0000-0000000000a1', current_date + 1, 3);
