-- Phone notification check. Run after stub.sql and migrations 0001-0005 on a scratch Postgres
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
grant usage on schema net, vault to authenticated;
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy cannot set the keys (expect error)'
select set_push_keys('PUB', 'PRIV');
\echo '--- No keys yet: Amy saves her phone, messages coach, nothing is pushed (expect 0)'
select save_push_sub('https://web.push.apple.com/amy', 'P-A', 'A-A');
insert into messages (body) values ('hi');
reset role; select count(*) as pushed from net.sent where url like '%/api/push'; set role authenticated;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach sets keys: saved phones are cleared (expect 0 subs), public key readable'
select set_push_keys('PUB1', 'PRIV1');
reset role; select count(*) as subs from push_subs; set role authenticated;
select save_push_sub('https://fcm.googleapis.com/coach', 'P-C', 'A-C');
\echo '--- Coach replaces keys: Vault updated, not duplicated (expect 1, PRIV2)'
select set_push_keys('PUB2', 'PRIV2');
reset role; select count(*), min(secret) from vault.secrets where name = 'push_private_key'; set role authenticated;
select save_push_sub('https://fcm.googleapis.com/coach', 'P-C', 'A-C');

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
select save_push_sub('https://web.push.apple.com/amy', 'P-A', 'A-A');
\echo '--- Amy only sees her own phone (expect 1)'
select count(*) from push_subs;
\echo '--- Amy cannot call push_to directly (expect error)'
select push_to('00000000-0000-0000-0000-0000000000b2', 'x', 'y', '/');
\echo '--- Amy messages coach: one push to the coach phone, titled Amy, link to her chat'
insert into messages (body) values ('Is my depth ok?');
reset role;
select body->'subscription'->>'endpoint' as endpoint, body->'payload'->>'title' as title, body->'payload'->>'body' as text, body->'payload'->>'url' as link, body->'vapid'->>'privateKey' as priv, url from net.sent where url like '%/api/push';
delete from net.sent; set role authenticated;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach replies: one push to Amy only, not Ben'
insert into messages (client_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'Yes, looks good');
reset role;
select body->'subscription'->>'endpoint' as endpoint, body->'payload'->>'title' as title, body->'payload'->>'url' as link from net.sent where url like '%/api/push';
\echo '--- A phone signed in as Ben moves to Ben (expect Ben owns it)'
set role authenticated; set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
select save_push_sub('https://web.push.apple.com/amy', 'P-A', 'A-A');
reset role; select user_id = '00000000-0000-0000-0000-0000000000b2' as moved from push_subs where endpoint like '%/amy';
\echo '--- Ben removes it (expect 0)'
set role authenticated; select delete_push_sub('https://web.push.apple.com/amy');
reset role; select count(*) from push_subs where endpoint like '%/amy';
