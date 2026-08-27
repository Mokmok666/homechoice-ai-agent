create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, property_id)
);

create index if not exists properties_user_id_idx on public.properties(user_id);

create table if not exists public.buyer_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.decision_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  history_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, history_id)
);

create index if not exists decision_history_user_id_created_at_idx
  on public.decision_history(user_id, created_at desc);

alter table public.properties enable row level security;
alter table public.buyer_preferences enable row level security;
alter table public.decision_history enable row level security;

drop policy if exists "properties_select_own" on public.properties;
drop policy if exists "properties_insert_own" on public.properties;
drop policy if exists "properties_update_own" on public.properties;
drop policy if exists "properties_delete_own" on public.properties;
create policy "properties_select_own" on public.properties for select
  using (auth.uid() = user_id);
create policy "properties_insert_own" on public.properties for insert
  with check (auth.uid() = user_id);
create policy "properties_update_own" on public.properties for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "properties_delete_own" on public.properties for delete
  using (auth.uid() = user_id);

drop policy if exists "buyer_preferences_select_own" on public.buyer_preferences;
drop policy if exists "buyer_preferences_insert_own" on public.buyer_preferences;
drop policy if exists "buyer_preferences_update_own" on public.buyer_preferences;
drop policy if exists "buyer_preferences_delete_own" on public.buyer_preferences;
create policy "buyer_preferences_select_own" on public.buyer_preferences for select
  using (auth.uid() = user_id);
create policy "buyer_preferences_insert_own" on public.buyer_preferences for insert
  with check (auth.uid() = user_id);
create policy "buyer_preferences_update_own" on public.buyer_preferences for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "buyer_preferences_delete_own" on public.buyer_preferences for delete
  using (auth.uid() = user_id);

drop policy if exists "decision_history_select_own" on public.decision_history;
drop policy if exists "decision_history_insert_own" on public.decision_history;
drop policy if exists "decision_history_update_own" on public.decision_history;
drop policy if exists "decision_history_delete_own" on public.decision_history;
create policy "decision_history_select_own" on public.decision_history for select
  using (auth.uid() = user_id);
create policy "decision_history_insert_own" on public.decision_history for insert
  with check (auth.uid() = user_id);
create policy "decision_history_update_own" on public.decision_history for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "decision_history_delete_own" on public.decision_history for delete
  using (auth.uid() = user_id);

-- Anonymous Supabase users receive the authenticated Postgres role after sign-in.
-- Table privileges allow requests to reach RLS; RLS still enforces per-user isolation.

grant usage on schema public to authenticated;

grant select, insert, update, delete
on table public.properties
to authenticated;

grant select, insert, update, delete
on table public.buyer_preferences
to authenticated;

grant select, insert, update, delete
on table public.decision_history
to authenticated;
