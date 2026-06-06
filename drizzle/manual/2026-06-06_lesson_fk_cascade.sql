-- Applied to prod directly via psql on 2026-06-06 (db:migrate is drifted/abandoned;
-- see schema.ts as source of truth). Adds ON DELETE CASCADE to the three FKs on
-- lessons.id so deleting a lesson/module no longer trips an FK violation.
-- lesson_progress + video_watch_events have real data (cascade is correct); quizzes
-- is unused. Constraint-only change, no data touched.

BEGIN;

ALTER TABLE "lesson_progress" DROP CONSTRAINT IF EXISTS "lesson_progress_lesson_id_lessons_id_fk";
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk"
  FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE CASCADE;

ALTER TABLE "quizzes" DROP CONSTRAINT IF EXISTS "quizzes_lesson_id_lessons_id_fk";
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_lesson_id_lessons_id_fk"
  FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE CASCADE;

ALTER TABLE "video_watch_events" DROP CONSTRAINT IF EXISTS "video_watch_events_lesson_id_lessons_id_fk";
ALTER TABLE "video_watch_events" ADD CONSTRAINT "video_watch_events_lesson_id_lessons_id_fk"
  FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE CASCADE;

COMMIT;
