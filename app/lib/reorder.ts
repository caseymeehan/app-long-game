import { eq, and, sql, gt, lt, gte, lte } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "~/db";

/**
 * Generic position-based reordering for any table with a position column
 * and a parent foreign key (e.g. lessons in a module, modules in a course).
 */
export async function moveItemToPosition<T extends PgTable>(opts: {
  table: T;
  idColumn: PgColumn;
  positionColumn: PgColumn;
  parentColumn: PgColumn;
  itemId: number;
  parentId: number;
  oldPosition: number;
  newPosition: number;
}) {
  const { table, idColumn, positionColumn, parentColumn, itemId, parentId, oldPosition, newPosition } = opts;

  if (oldPosition === newPosition) return;

  if (newPosition > oldPosition) {
    // Moving down: shift items between old+1 and new up by 1
    await db.update(table)
      .set({ [positionColumn.name]: sql`${positionColumn} - 1` })
      .where(
        and(
          eq(parentColumn, parentId),
          gt(positionColumn, oldPosition),
          lte(positionColumn, newPosition)
        )
      );
  } else {
    // Moving up: shift items between new and old-1 down by 1
    await db.update(table)
      .set({ [positionColumn.name]: sql`${positionColumn} + 1` })
      .where(
        and(
          eq(parentColumn, parentId),
          gte(positionColumn, newPosition),
          lt(positionColumn, oldPosition)
        )
      );
  }

  await db.update(table)
    .set({ [positionColumn.name]: newPosition })
    .where(eq(idColumn, itemId));
}
