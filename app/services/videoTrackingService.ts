import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "~/db";
import { videoWatchEvents, lessons } from "~/db/schema";

// ─── Video Tracking Service ───
// Logs video watch events and calculates watch progress per lesson.
// Uses positional parameters (project convention).

export async function logWatchEvent(
  userId: number,
  lessonId: number,
  eventType: string,
  positionSeconds: number
) {
  const [row] = await db
    .insert(videoWatchEvents)
    .values({
      userId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning();
  return row;
}

export async function getWatchEvents(userId: number, lessonId: number) {
  return db
    .select()
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .orderBy(videoWatchEvents.createdAt);
}

export async function getLastWatchPosition(userId: number, lessonId: number) {
  const [lastEvent] = await db
    .select()
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .orderBy(desc(videoWatchEvents.createdAt))
    .limit(1);

  return lastEvent?.positionSeconds ?? 0;
}

export async function getWatchEventCount(userId: number, lessonId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    );

  return result?.count ?? 0;
}

export async function getMaxWatchPosition(userId: number, lessonId: number) {
  const [result] = await db
    .select({ maxPos: sql<number>`max(${videoWatchEvents.positionSeconds})` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    );

  return result?.maxPos ?? 0;
}

export async function calculateWatchProgress(
  userId: number,
  lessonId: number,
  videoDurationSeconds: number
) {
  if (videoDurationSeconds <= 0) return 0;

  const maxPosition = await getMaxWatchPosition(userId, lessonId);
  const progress = Math.min(
    Math.round((maxPosition / videoDurationSeconds) * 100),
    100
  );

  return progress;
}

export async function hasUserWatchedVideo(userId: number, lessonId: number) {
  const count = await getWatchEventCount(userId, lessonId);
  return count > 0;
}

export async function hasUserCompletedVideo(
  userId: number,
  lessonId: number,
  videoDurationSeconds: number,
  completionThreshold: number
) {
  const progress = await calculateWatchProgress(
    userId,
    lessonId,
    videoDurationSeconds
  );
  return progress >= completionThreshold;
}

export async function getUserWatchHistory(userId: number) {
  return db
    .select({
      lessonId: videoWatchEvents.lessonId,
      eventCount: sql<number>`count(*)`,
      lastPosition: sql<number>`max(${videoWatchEvents.positionSeconds})`,
      lastWatched: sql<string>`max(${videoWatchEvents.createdAt})`,
    })
    .from(videoWatchEvents)
    .where(eq(videoWatchEvents.userId, userId))
    .groupBy(videoWatchEvents.lessonId);
}

export async function deleteWatchEvents(userId: number, lessonId: number) {
  return db
    .delete(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .returning();
}
