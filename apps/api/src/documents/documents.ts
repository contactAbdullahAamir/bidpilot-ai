import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  documentKindSchema,
  pasteDocumentSchema,
  type DocumentKind,
  type DocumentPage,
  type DocumentRecord
} from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import { Auth, AuthContext, RequirePermission } from "../auth/auth";
import { AuditService, StorageService } from "../core/common";
import { DatabaseService, isoRequired, json } from "../core/database.service";
import { parseDocument, splitIntoPages, UnsupportedDocumentError } from "./parser";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type DocumentRow = {
  id: string;
  opportunity_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: DocumentKind;
  status: DocumentRecord["status"];
  page_count: number;
  empty_pages: unknown;
  error: string | null;
  created_at: Date;
};

export function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    kind: row.kind,
    status: row.status,
    pageCount: Number(row.page_count),
    emptyPages: json<number[]>(row.empty_pages, []),
    error: row.error,
    createdAt: isoRequired(row.created_at)
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string, opportunityId: string): Promise<DocumentRecord[]> {
    const rows = await this.db.query<DocumentRow>(
      "SELECT * FROM documents WHERE organization_id = $1 AND opportunity_id = $2 ORDER BY created_at",
      [organizationId, opportunityId]
    );
    return rows.map(mapDocument);
  }

  private async assertOpportunity(organizationId: string, opportunityId: string): Promise<string> {
    const rows = await this.db.query<{ title: string }>("SELECT title FROM opportunities WHERE id = $1 AND organization_id = $2", [opportunityId, organizationId]);
    if (!rows[0]) throw new NotFoundException("Opportunity not found");
    return rows[0].title;
  }

  async upload(auth: AuthContext, opportunityId: string, file: { originalname: string; buffer: Buffer; size: number }, kind: DocumentKind): Promise<DocumentRecord> {
    await this.assertOpportunity(auth.organizationId, opportunityId);
    if (!file?.buffer?.length) throw new BadRequestException("The uploaded file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException("Files must be 25 MB or smaller.");
    const filename = sanitizeFilename(file.originalname);
    let parsed;
    try {
      parsed = await parseDocument(file.buffer);
    } catch (error) {
      if (error instanceof UnsupportedDocumentError) throw new BadRequestException(error.message);
      // Keep a failed record so the user can see what happened.
      const stored = await this.storage.put(auth.organizationId, file.buffer, ".bin");
      return this.insert(auth, opportunityId, filename, "application/octet-stream", file.buffer.length, stored, kind, [], [], "We couldn't read this file. It may be encrypted or corrupted.");
    }
    const stored = await this.storage.put(auth.organizationId, file.buffer, parsed.extension);
    return this.insert(auth, opportunityId, filename, parsed.mimeType, file.buffer.length, stored, kind, parsed.pages, parsed.emptyPages, null);
  }

  async paste(auth: AuthContext, opportunityId: string, input: { title: string; text: string; kind: DocumentKind }): Promise<DocumentRecord> {
    await this.assertOpportunity(auth.organizationId, opportunityId);
    const bytes = Buffer.from(input.text, "utf8");
    const stored = await this.storage.put(auth.organizationId, bytes, ".txt");
    const pages = splitIntoPages(input.text);
    const filename = sanitizeFilename(input.title.endsWith(".txt") ? input.title : `${input.title}.txt`);
    return this.insert(auth, opportunityId, filename, "text/plain", bytes.length, stored, input.kind, pages, [], null);
  }

  private async insert(
    auth: AuthContext,
    opportunityId: string,
    filename: string,
    mimeType: string,
    size: number,
    stored: { key: string; sha256: string },
    kind: DocumentKind,
    pages: string[],
    emptyPages: number[],
    error: string | null
  ): Promise<DocumentRecord> {
    const id = randomUUID();
    const status = error ? "failed" : pages.length === 0 || emptyPages.length === pages.length ? "failed" : "parsed";
    const finalError = error ?? (status === "failed" ? "No text layer found. Scanned PDFs need OCR, which isn't supported yet." : null);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO documents (id, organization_id, opportunity_id, filename, mime_type, size_bytes, sha256, storage_key, kind, status, page_count, empty_pages, error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
        [id, auth.organizationId, opportunityId, filename, mimeType, size, stored.sha256, stored.key, kind, status, pages.length, emptyPages, finalError]
      );
      for (const [index, text] of pages.entries()) {
        await tx.query("INSERT INTO document_pages (document_id, organization_id, page_number, text) VALUES ($1,$2,$3,$4)", [id, auth.organizationId, index + 1, text]);
      }
      await tx.query("UPDATE opportunities SET updated_at = now() WHERE id = $1", [opportunityId]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "document.uploaded", entityType: "document", entityId: id, entityLabel: filename, data: { pages: pages.length, status } }, tx);
    });
    const rows = await this.db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [id]);
    return mapDocument(rows[0]);
  }

  async page(organizationId: string, documentId: string, pageNumber: number): Promise<DocumentPage> {
    const rows = await this.db.query<{ text: string; filename: string }>(
      `SELECT p.text, d.filename FROM document_pages p JOIN documents d ON d.id = p.document_id
       WHERE p.document_id = $1 AND p.organization_id = $2 AND p.page_number = $3`,
      [documentId, organizationId, pageNumber]
    );
    if (!rows[0]) throw new NotFoundException("Page not found");
    return { documentId, filename: rows[0].filename, pageNumber, text: rows[0].text };
  }

  async pagesForOpportunity(organizationId: string, opportunityId: string): Promise<DocumentPage[]> {
    const rows = await this.db.query<{ document_id: string; filename: string; page_number: number; text: string }>(
      `SELECT p.document_id, d.filename, p.page_number, p.text FROM document_pages p
       JOIN documents d ON d.id = p.document_id
       WHERE d.organization_id = $1 AND d.opportunity_id = $2 AND d.status = 'parsed'
       ORDER BY d.kind DESC, d.created_at, p.page_number`,
      [organizationId, opportunityId]
    );
    return rows.map((r) => ({ documentId: r.document_id, filename: r.filename, pageNumber: Number(r.page_number), text: r.text }));
  }

  async remove(auth: AuthContext, documentId: string): Promise<void> {
    const rows = await this.db.query<{ storage_key: string; filename: string }>(
      "DELETE FROM documents WHERE id = $1 AND organization_id = $2 RETURNING storage_key, filename",
      [documentId, auth.organizationId]
    );
    if (!rows[0]) throw new NotFoundException("Document not found");
    await this.storage.remove(rows[0].storage_key);
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "document.deleted", entityType: "document", entityId: documentId, entityLabel: rows[0].filename });
  }
}

function sanitizeFilename(name: string): string {
  const base = (name || "document").split(/[\\/]/).pop()!.replace(/[^\w.\- ()]/g, "_").trim();
  return base.slice(0, 160) || "document";
}

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("opportunities/:id/documents")
  list(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.documents.list(auth.organizationId, id);
  }

  @Post("opportunities/:id/documents")
  @RequirePermission("editProposal")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @Auth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { kind?: string }
  ) {
    if (!file) throw new BadRequestException("Attach a file in the 'file' field.");
    return this.documents.upload(auth, id, file, documentKindSchema.catch("rfp").parse(body?.kind));
  }

  @Post("opportunities/:id/documents/text")
  @RequirePermission("editProposal")
  paste(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.documents.paste(auth, id, pasteDocumentSchema.parse(body));
  }

  @Get("documents/:id/pages/:page")
  page(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Param("page", ParseIntPipe) page: number) {
    return this.documents.page(auth.organizationId, id, page);
  }

  @Delete("documents/:id")
  @RequirePermission("editProposal")
  async remove(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.documents.remove(auth, id);
  }
}
