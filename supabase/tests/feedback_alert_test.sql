-- Feedback-ready alert. Run after stub.sql and migrations 0001-0007 on a scratch Postgres
-- ("create extension pg_net" in 0003 errors on plain Postgres; that's expected). Stubs pg_net and Vault.
\set ON_ERROR_STOP 0
create schema if not exists net;
create table if not exists net.sent (url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.sent values (url, headers, body); select 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets (name, secret) values (n, s) returning id $$;
create or replace function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
select vault.create_secret('re_test', 'resend_api_key');
grant usage on schema net, vault to authenticated;
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;
insert into videos (id, client_id, exercise, slot) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Back Squat', '2026-10-16');
-- Amy has turned phone notifications on.
select set_push_keys('PUB', 'PRIV');
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1'; select save_push_sub('https://web.push.apple.com/amy', 'P-A', 'A-A');
delete from net.sent;

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach sends feedback with two breakdowns: one email to Amy, one push (expect 2 rows)'
update videos set status = 'reviewed', verdict = 'tweak', feedback = 'Brace before you break.', reviewed_at = now(),
  clips = '[{"path":"a/1.mp4","label":"Bar path"},{"path":"a/2.mp4","label":"Bracing"}]';
reset role;
select case when url like '%resend%' then 'email' else 'push' end as kind,
  coalesce(body->'to'->>0, body->'payload'->>'body') as to_or_body, body->>'subject' as subject from net.sent order by 1;
select body->>'text' as email_text from net.sent where url like '%resend%';
set role authenticated;
\echo '--- Coach edits the feedback afterwards: nothing new is sent (expect 2)'
update videos set feedback = 'Brace harder.';
reset role; select count(*) from net.sent;
