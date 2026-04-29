import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, {
  max: process.env.NODE_ENV === "development" ? 3 : 10,
});

export const db = drizzle(client, { schema });
