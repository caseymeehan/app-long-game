import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "~/db/schema";

/**
 * Creates a connection to a test Postgres database.
 * Requires TEST_DATABASE_URL environment variable.
 *
 * Each call returns a new Drizzle instance connected to the test database.
 * Tests should clean up their data after each run.
 */
export function createTestDb() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL must be set to run tests against Postgres"
    );
  }
  const client = postgres(connectionString);
  const testDb = drizzle(client, { schema });
  return testDb;
}

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export async function seedBaseData(
  testDb: ReturnType<typeof createTestDb>
) {
  const [user] = await testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning();

  const [instructor] = await testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning();

  const [category] = await testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning();

  const [course] = await testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning();

  return { user, instructor, category, course };
}
