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

-- ---------- streams ----------
insert into programs (id, name, weeks) values ('00000000-0000-0000-0000-0000000000e1', 'Road to Torian', '[{"days":[]}]'), ('00000000-0000-0000-0000-0000000000e2', 'Muscle Building', '[{"days":[{"id":"d1"}]},{"days":[]}]');
insert into teams (id, name, program_id, start_date, stream) values
  ('00000000-0000-0000-0000-0000000000f1', 'CrossFit Tribe', '00000000-0000-0000-0000-0000000000e1', '2026-09-21', 'crossfit'),
  ('00000000-0000-0000-0000-0000000000f2', 'Body Transformation', '00000000-0000-0000-0000-0000000000e2', '2026-08-03', 'transformation');
\echo '--- Only one team per stream (expect error)'
insert into teams (name, stream) values ('Second CrossFit', 'crossfit');
insert into auth.users values ('00000000-0000-0000-0000-0000000000c3','cat@x','{"name":"Cat"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000d4','dan@x','{"name":"Dan"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000e5','eve@x','{"name":"Eve"}');

\echo '--- Cat pays for CrossFit (rolling): joins the team, no own program (expect t | t | t)'
select billing_sync('00000000-0000-0000-0000-0000000000c3', '', 'crossfit-programming', 'active', 'cus_c', 'sub_c', null, 'crossfit', 'rolling');
select approved, team_id = '00000000-0000-0000-0000-0000000000f1', program_id is null from profiles where email = 'cat@x';

\echo '--- Dan pays for Body Transformation (week1): team + own copy from this Monday, sent twice = still one copy (expect t | t | Muscle Building (Dan) | 2 | t, then 1)'
select billing_sync('00000000-0000-0000-0000-0000000000d4', '', 'transformation-coaching', 'active', 'cus_d', 'sub_d', null, 'transformation', 'week1');
select billing_sync('00000000-0000-0000-0000-0000000000d4', '', 'transformation-coaching', 'active', 'cus_d', 'sub_d', null, 'transformation', 'week1');
select p.approved, p.team_id = '00000000-0000-0000-0000-0000000000f2', g.name, jsonb_array_length(g.weeks), extract(isodow from p.start_date) = 1
  from profiles p join programs g on g.id = p.program_id where p.email = 'dan@x';
select count(*) from programs where owner_id = '00000000-0000-0000-0000-0000000000d4';

\echo '--- Eve already has a team from the coach: paying approves her but does not move her (expect t | t)'
update profiles set team_id = '00000000-0000-0000-0000-0000000000f1' where email = 'eve@x';
select billing_sync('00000000-0000-0000-0000-0000000000e5', '', 'transformation-programming', 'active', 'cus_e', 'sub_e', null, 'transformation', 'week1');
select approved, team_id = '00000000-0000-0000-0000-0000000000f1' from profiles where email = 'eve@x';

\echo '--- A stream with no team linked: approved, no team (expect t | t)'
insert into auth.users values ('00000000-0000-0000-0000-0000000000a6','fay@x','{"name":"Fay"}');
select billing_sync('00000000-0000-0000-0000-0000000000a6', '', 'affiliate-individual', 'active', 'cus_f', 'sub_f', null, 'affiliate', 'rolling');
select approved, team_id is null from profiles where email = 'fay@x';
