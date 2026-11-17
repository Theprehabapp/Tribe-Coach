-- Paid plans. Run after stub.sql and migrations 0001-0021 on a scratch Postgres.
\set ON_ERROR_STOP 0
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','amy@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','ben@x','{"name":"Ben"}');

\echo '--- New sign-up waits for approval (expect f)'
select approved from profiles where email = 'amy@x';

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy cannot call billing_sync or write her own row, and cannot approve herself (expect error, error, f)'
select billing_sync('00000000-0000-0000-0000-0000000000a1', 'amy@x', 'coaching', 'active', 'cus_1', 'sub_1', now());
insert into subscriptions (user_id, status) values ('00000000-0000-0000-0000-0000000000a1', 'active');
update profiles set approved = true where id = '00000000-0000-0000-0000-0000000000a1';
select approved from profiles where email = 'amy@x';
reset role;

\echo '--- Stripe says Amy paid: row recorded, account approved (expect coaching | active | cus_1, t)'
select billing_sync('00000000-0000-0000-0000-0000000000a1', 'amy@x', 'coaching', 'active', 'cus_1', 'sub_1', now() + interval '7 days');
select plan, status, stripe_customer from subscriptions where user_id = '00000000-0000-0000-0000-0000000000a1';
select approved from profiles where email = 'amy@x';

\echo '--- The billing flag does not leak: Amy still cannot approve Ben afterwards in her own session (expect f)'
set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
update profiles set approved = true where id = '00000000-0000-0000-0000-0000000000b2';
reset role;
select approved from profiles where email = 'ben@x';

\echo '--- Amy reads her own row only; coach reads all (expect 1, then 1 after Ben pays: coach sees 2)'
set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
select count(*) from subscriptions;
reset role;
select billing_sync('00000000-0000-0000-0000-0000000000b2', 'ben@x', 'programming', 'trialing', 'cus_2', 'sub_2', null);
set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
select count(*) from subscriptions;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
select count(*) from subscriptions;
reset role;

\echo '--- Amy cancels: status recorded, plan kept, still approved (expect coaching | canceled, t)'
select billing_sync('00000000-0000-0000-0000-0000000000a1', '', '', 'canceled', 'cus_1', 'sub_1', now());
select plan, status from subscriptions where user_id = '00000000-0000-0000-0000-0000000000a1';
select approved from profiles where email = 'amy@x';

\echo '--- Amy restarts on a new subscription, then the old one sends a late cancel: stays active on sub_3 (expect active | sub_3)'
select billing_sync('00000000-0000-0000-0000-0000000000a1', '', 'programming', 'active', 'cus_1', 'sub_3', now());
select billing_sync('00000000-0000-0000-0000-0000000000a1', '', '', 'canceled', 'cus_1', 'sub_1', now());
select status, stripe_subscription from subscriptions where user_id = '00000000-0000-0000-0000-0000000000a1';

\echo '--- A paid event never turns the coach into anything else, and an unknown user is ignored (expect coach | t, 2)'
select billing_sync('00000000-0000-0000-0000-00000000000c', '', 'coaching', 'active', 'cus_9', 'sub_9', null);
select role, approved from profiles where email = 'coach@x';
select billing_sync('00000000-0000-0000-0000-0000000000ff', '', 'coaching', 'active', 'cus_8', 'sub_8', null);
select count(*) from subscriptions where user_id <> '00000000-0000-0000-0000-00000000000c';

\echo '--- Coach can still approve and revoke as before (expect f)'
set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = false where id = '00000000-0000-0000-0000-0000000000b2';
reset role;
select approved from profiles where email = 'ben@x';
