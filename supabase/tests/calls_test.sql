-- Check-in calls. Run after stub.sql, the pg_net/Vault stubs in feedback_alert_test.sql, and migrations 0001-0016.
\set ON_ERROR_STOP 0
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}') on conflict do nothing;
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}') on conflict do nothing;
insert into auth.users values ('00000000-0000-0000-0000-0000000000b1','b@x','{"name":"Ben"}') on conflict do nothing;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;
grant all on all tables in schema public to authenticated;
delete from net.sent;
set role authenticated;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy books Thu 26 Nov 10:00 Sydney: ok, month 2026-11'
insert into calls (client_id, starts_at) values (auth.uid(), '2026-11-26 10:00 Australia/Sydney') returning month;
\echo '--- Amy books a second November call: ERROR (one a month)'
insert into calls (client_id, starts_at) values (auth.uid(), '2026-11-27 10:00 Australia/Sydney');
\echo '--- Amy books mid-month / Saturday / 10:15 / 17:00 / for Ben: 5 ERRORS'
insert into calls (client_id, starts_at) values (auth.uid(), '2026-12-10 10:00 Australia/Sydney');
insert into calls (client_id, starts_at) values (auth.uid(), '2026-12-26 10:00 Australia/Sydney');
insert into calls (client_id, starts_at) values (auth.uid(), '2026-12-28 10:15 Australia/Sydney');
insert into calls (client_id, starts_at) values (auth.uid(), '2026-12-28 17:00 Australia/Sydney');
insert into calls (client_id, starts_at) values ('00000000-0000-0000-0000-0000000000b1', '2026-12-28 10:00 Australia/Sydney');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b1';
\echo '--- Ben takes Amy''s slot: ERROR (taken)'
insert into calls (client_id, starts_at) values (auth.uid(), '2026-11-26 10:00 Australia/Sydney');
\echo '--- Ben sees no rows of Amy''s but sees the time as taken (expect 0, then 1)'
select count(*) from calls;
select count(*) from taken_calls('2026-11');

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach blocks 26 Nov 10:30 and sees both rows (expect 2)'
insert into calls (starts_at) values ('2026-11-26 10:30 Australia/Sydney');
select count(*) from calls;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy cancels hers (expect DELETE 1), Ben could not delete it'
delete from calls where client_id = auth.uid();
reset role;
\echo '--- Emails: invite then cancellation, each to Amy and the coach, with an .ics (expect 2 rows)'
select body->>'subject' subject, body->'to' as to, body->'attachments'->0->>'filename' file,
  convert_from(decode(body->'attachments'->0->>'content', 'base64'), 'UTF8') like '%DTSTART:20261125T230000Z%' as right_time from net.sent;
