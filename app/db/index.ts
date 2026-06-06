import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, {
  max: process.env.NODE_ENV === "development" ? 3 : 10,
});

export const db = drizzle(client, { schema });

// The top-level client and a transaction handle expose the same query builder,
// so services can accept either and transparently join a caller's transaction.
export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Transaction;
