import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { MIGRATIONS } from "./migrations";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

type LiteDb = {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/**
 * Database access for the API.
 *
 * Uses PostgreSQL when DATABASE_URL is set; otherwise an embedded PGlite
 * (PostgreSQL compiled to WASM) stored under PGLITE_DIR so a fresh checkout
 * runs without Docker. Both run the same SQL and migrations.
 */
@Injectable()
export class DatabaseService implements Queryable, OnModuleDestroy {
  private readonly logger = new Logger("Database");
  private pool?: Pool;
  private lite?: LiteDb;
  private ready?: Promise<void>;
  kind: "postgres" | "pglite" = "pglite";

  constructor(private readonly options: { url?: string; liteDir?: string } = {}) {}

  init(): Promise<void> {
    this.ready ??= this.connect();
    return this.ready;
  }

  private async connect(): Promise<void> {
    const url = this.options.url ?? process.env.DATABASE_URL;
    if (url && url.startsWith("postgres")) {
      this.kind = "postgres";
      this.pool = new Pool({ connectionString: url });
    } else {
      this.kind = "pglite";
      const dir = this.options.liteDir ?? process.env.PGLITE_DIR ?? path.resolve(process.cwd(), ".data", "pglite");
      const { PGlite } = await import("@electric-sql/pglite");
      if (dir === "memory://") {
        this.lite = (await PGlite.create()) as unknown as LiteDb;
      } else {
        mkdirSync(dir, { recursive: true });
        this.lite = (await PGlite.create(dir)) as unknown as LiteDb;
      }
      this.logger.log(`Using embedded PGlite at ${dir}`);
    }
    await this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.rawExec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const applied = new Set(
      (await this.rawQuery<{ version: number }>("SELECT version FROM schema_migrations")).map((row) => Number(row.version))
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.logger.log(`Applying migration ${migration.version}: ${migration.name}`);
      await this.transaction(async (tx) => {
        for (const statement of migration.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
          await tx.query(statement);
        }
        await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
      });
    }
  }

  private async rawExec(sql: string): Promise<void> {
    if (this.pool) await this.pool.query(sql);
    else await this.lite!.exec(sql);
  }

  private async rawQuery<T>(text: string, values: unknown[] = []): Promise<T[]> {
    if (this.pool) return (await this.pool.query(text, values)).rows as T[];
    return (await this.lite!.query<T>(text, values)).rows;
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    await this.init();
    return this.rawQuery<T>(text, values.map(serialize));
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client: PoolClient = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <R>(text: string, values: unknown[] = []) => (await client.query(text, values.map(serialize))).rows as R[]
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return this.lite!.transaction((tx) =>
      fn({ query: async <R>(text: string, values: unknown[] = []) => (await tx.query<R>(text, values.map(serialize))).rows })
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    await this.lite?.close();
  }
}

/** Objects/arrays are stored as jsonb; serialize them explicitly for both drivers. */
function serialize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || value instanceof Date || Buffer.isBuffer(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isoRequired(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
