import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger
} from "@nestjs/common";
import type { Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { DatabaseService, Queryable } from "./database.service";

/** Maps validation errors to 400 and hides internals for unexpected errors. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Http");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ZodError) {
      response.status(400).json({
        statusCode: 400,
        message: exception.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
        issues: exception.issues
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    response.status(500).json({ statusCode: 500, message: "Something went wrong on our side. Please try again." });
  }
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async log(
    entry: {
      organizationId: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      entityLabel?: string | null;
      data?: unknown;
    },
    tx: Queryable = this.db
  ): Promise<void> {
    await tx.query(
      `INSERT INTO audit_log (id, organization_id, actor_id, action, entity_type, entity_id, entity_label, data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        randomUUID(),
        entry.organizationId,
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.entityLabel ?? null,
        entry.data ?? null
      ]
    );
  }
}

/**
 * Private object storage adapter (local filesystem). Keys are generated
 * server-side and namespaced by organization; client filenames are never
 * used as paths.
 */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data", "storage"));

  async put(organizationId: string, bytes: Buffer, extension: string): Promise<{ key: string; sha256: string }> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const safeOrg = organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const key = `${safeOrg}/${randomUUID()}${extension.replace(/[^a-z0-9.]/gi, "")}`;
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return { key, sha256 };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new Error("Invalid storage key");
    return target;
  }
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON serialization (sorted keys) for checksums. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
