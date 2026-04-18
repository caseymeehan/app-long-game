-- Enable Row-Level Security on all public tables.
--
-- Applied manually via the Supabase dashboard SQL editor on or around
-- 2026-04-07. This project does not use Supabase CLI migration tracking
-- (the schema_migrations table doesn't exist in the remote DB) — Drizzle
-- handles schema via drizzle-kit push. This file exists as a committed
-- record of the manual change, so the repo accurately reflects prod.
-- Re-running is safe: every statement below is idempotent.
--
-- With RLS enabled and NO permissive policies, the anon and authenticated
-- roles (used by Supabase PostgREST / anon key) are blocked from all
-- SELECT, INSERT, UPDATE, and DELETE operations on these tables.
--
-- The application's Drizzle ORM connection uses the postgres superuser role
-- via DATABASE_URL, which bypasses RLS entirely. The SECURITY DEFINER
-- trigger handle_new_user() also bypasses RLS as it runs as the function
-- owner. Therefore this migration has zero impact on application behavior.
--
-- If PostgREST access is needed in the future for specific tables, add
-- granular policies at that time rather than removing RLS.

-- ─── Deployed tables ───
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_options enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.purchases enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.coupons enable row level security;
alter table public.video_watch_events enable row level security;

-- ─── Partner / affiliate tables ───
alter table public.partners enable row level security;
alter table public.partner_resource_categories enable row level security;
alter table public.partner_resources enable row level security;
alter table public.partner_page_settings enable row level security;
