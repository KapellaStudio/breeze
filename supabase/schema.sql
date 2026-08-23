-- ═══════════════════════════════════════════════════════════════════════════
--  BREEZE — Supabase schema
--  Run once in the Supabase SQL editor, or via `supabase db push`.
--
--  Design rule: Breeze is a privacy browser. The schema must not undermine
--  the product's own claims. So there is NO per-user browsing data here, no
--  device fingerprint, no IP column, and no analytics table. Downloads are
--  counted in aggregate only. If a row could embarrass us in a privacy audit,
--  it does not belong in this file.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── releases ───────────────────────────────────────────────────────────────
-- One row per shipped build. The site reads this to render download buttons,
-- so shipping a new version is an INSERT, not a redeploy.
create table if not exists public.releases (
  id            bigint generated always as identity primary key,
  version       text        not null,                 -- '1.0'
  codename      text        not null,                 -- 'McCloskey'
  channel       text        not null default 'stable' -- stable | beta
                  check (channel in ('stable','beta')),
  platform      text        not null                  -- macos-arm | macos-x64 | windows-x64 | linux-x64
                  check (platform in ('macos-arm','macos-x64','windows-x64','linux-x64')),
  file_url      text        not null,
  file_size     bigint,
  sha256        text        not null,                 -- published so users can verify
  release_notes text,
  is_published  boolean     not null default false,
  released_at   timestamptz not null default now()
);
create unique index if not exists releases_unique_build
  on public.releases (version, channel, platform);
create index if not exists releases_published_idx
  on public.releases (is_published, channel, released_at desc);

-- ── download_counts ────────────────────────────────────────────────────────
-- Aggregate only. One row per platform per day. No user identifier of any
-- kind, by design — we cannot leak what we never collect.
create table if not exists public.download_counts (
  day       date not null,
  platform  text not null,
  version   text not null,
  count     bigint not null default 0,
  primary key (day, platform, version)
);

create or replace function public.record_download(p_platform text, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.download_counts (day, platform, version, count)
  values (current_date, p_platform, p_version, 1)
  on conflict (day, platform, version)
  do update set count = public.download_counts.count + 1;
end;
$$;

-- ── waitlist ───────────────────────────────────────────────────────────────
-- Email only, for launch notification. Nothing else. Deliberately no name,
-- no company, no source tracking.
create table if not exists public.waitlist (
  id            bigint generated always as identity primary key,
  email         text        not null unique,
  platform_hint text        check (platform_hint in ('macos','windows','linux','mobile',null)),
  confirmed     boolean     not null default false,
  created_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  RLS on for every table. The anon key can read published releases and
--  nothing else. All writes go through the narrow Breeze Ops server seam.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.releases        enable row level security;
alter table public.download_counts enable row level security;
alter table public.waitlist        enable row level security;

drop policy if exists "published releases are public" on public.releases;
create policy "published releases are public"
  on public.releases for select
  to anon, authenticated
  using (is_published = true);

-- No anon policies on download_counts or waitlist.
revoke all on public.download_counts from anon, authenticated;
revoke all on public.waitlist        from anon, authenticated;
revoke execute on function public.record_download(text, text) from public, anon, authenticated;
grant  execute on function public.record_download(text, text) to service_role;

-- Public installer artifacts. No broad SELECT policy on storage.objects is
-- needed: known public URLs remain readable without making the bucket listable.
insert into storage.buckets (id, name, public)
values ('releases', 'releases', true)
on conflict (id) do update set public = excluded.public;
