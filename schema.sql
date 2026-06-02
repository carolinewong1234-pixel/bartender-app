-- ============================================================
-- Bartender Planner — Database Setup
-- Run this ONCE in your Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- Custom ingredients
create table if not exists bartender_mydb (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_mydb enable row level security;
create policy "Users own their data" on bartender_mydb
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_mydb_user_idx on bartender_mydb(user_id);

-- Recipe library
create table if not exists bartender_recipes (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_recipes enable row level security;
create policy "Users own their data" on bartender_recipes
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_recipes_user_idx on bartender_recipes(user_id);

-- Event library
create table if not exists bartender_events (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_events enable row level security;
create policy "Users own their data" on bartender_events
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_events_user_idx on bartender_events(user_id);

-- Inventory / stock
create table if not exists bartender_stock (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_stock enable row level security;
create policy "Users own their data" on bartender_stock
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_stock_user_idx on bartender_stock(user_id);

-- Receipts
create table if not exists bartender_receipts (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_receipts enable row level security;
create policy "Users own their data" on bartender_receipts
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_receipts_user_idx on bartender_receipts(user_id);

-- Price history
create table if not exists bartender_pricehistory (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_pricehistory enable row level security;
create policy "Users own their data" on bartender_pricehistory
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_pricehistory_user_idx on bartender_pricehistory(user_id);

-- Event categories
create table if not exists bartender_categories (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bartender_categories enable row level security;
create policy "Users own their data" on bartender_categories
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
create unique index if not exists bartender_categories_user_idx on bartender_categories(user_id);

-- Done! All 7 tables created with Row Level Security.
-- Each user can only see and edit their own data.
select 'Database setup complete ✓' as status;
