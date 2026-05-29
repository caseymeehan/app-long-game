-- Coaching application submissions from the public /one-on-one form on the
-- marketing site (join.long-game.ai).
--
-- Like the rest of this project, the table itself is created by drizzle-kit
-- push from app/db/schema.ts (coachingApplications). This file is the
-- committed record of the table + its Row-Level Security, per the repo
-- convention that every public table enables RLS in its creation migration.
-- Re-running is safe: every statement is idempotent.
--
-- With RLS enabled and NO permissive policies, the anon and authenticated
-- roles (Supabase PostgREST / anon key) are blocked from all access. The
-- application's Drizzle connection uses the postgres role via DATABASE_URL,
-- which bypasses RLS, so the api/coaching-application route can still insert.

create table if not exists public.coaching_applications (
  id serial primary key,
  describes_you text,
  biggest_challenge text,
  engine_change text,
  help_areas text,
  focus_question text,
  interest_level text,
  budget text,
  name text not null,
  email text not null,
  created_at text not null
);

alter table public.coaching_applications enable row level security;
