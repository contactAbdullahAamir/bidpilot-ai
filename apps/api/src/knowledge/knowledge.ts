import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createKnowledgeSchema,
  knowledgeKindSchema,
  updateKnowledgeSchema,
  type CreateKnowledge,
  type Evidence,
  type KnowledgeAsset,
  type KnowledgeKind,
  type KnowledgeStatus,
  type UpdateKnowledge
} from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import { Auth, AuthContext, RequirePermission } from "../auth/auth";
import { AuditService } from "../core/common";
import { DatabaseService, iso, isoRequired, json, Queryable } from "../core/database.service";
import { parseDocument, UnsupportedDocumentError } from "../documents/parser";

const STOPWORDS = new Set(
  "a an and are as at be been being but by can could do does for from had has have how if in into is it its may must no not of on or our shall should such than that the their them then there these they this those to under up was we were what when where which while who will with within would you your all any each other per via including include provide provided ensure able also".split(
    " "
  )
);

/** Structure-aware chunking: split at headings and paragraphs, keep heading context. */
export function chunkText(text: string, target = 900, max = 1400): string[] {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let heading = "";
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const block of blocks) {
    const isHeading = /^#{1,6}\s/.test(block) || (block.length < 80 && !/[.!?:]$/.test(block) && !block.includes("\n"));
    if (isHeading) {
      flush();
      heading = block.replace(/^#+\s*/, "");
      continue;
    }
    const prefix = heading && !current ? `${heading}: ` : "";
    if (current && current.length + block.length > target) flush();
    if (block.length > max) {
      for (const sentenceGroup of splitLong(block, target)) {
        flush();
        current = (heading ? `${heading}: ` : "") + sentenceGroup;
      }
      continue;
    }
    current += (current ? "\n\n" : prefix) + block;
  }
  flush();
  return chunks;
}

function splitLong(block: string, target: number): string[] {
  const sentences = block.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [block];
  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > target) {
      groups.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) groups.push(current.trim());
  return groups;
}

/** Build an OR tsquery from free text; returns null when no usable terms remain. */
export function toTsQuery(text: string, maxTerms = 14): string | null {
  const terms = Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((term) => term.length > 2 && !STOPWORDS.has(term) && !/^\d+$/.test(term))
    )
  ).slice(0, maxTerms);
  return terms.length ? terms.join(" | ") : null;
}

type AssetRow = {
  id: string;
  title: string;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  version: number;
  content: string;
  tags: unknown;
  source_filename: string | null;
  approved_at: Date | null;
  approved_by_name: string | null;
  chunk_count: number;
  created_at: Date;
  updated_at: Date;
};

function mapAsset(row: AssetRow): KnowledgeAsset {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    version: Number(row.version),
    content: row.content,
    tags: json<string[]>(row.tags, []),
    chunkCount: Number(row.chunk_count ?? 0),
    sourceFilename: row.source_filename,
    approvedAt: iso(row.approved_at),
    approvedByName: row.approved_by_name,
    createdAt: isoRequired(row.created_at),
    updatedAt: isoRequired(row.updated_at)
  };
}

const ASSET_SELECT = `
  SELECT a.*, u.name AS approved_by_name,
    (SELECT count(*)::int FROM knowledge_chunks c WHERE c.asset_id = a.id AND c.asset_version = a.version) AS chunk_count
  FROM knowledge_assets a LEFT JOIN users u ON u.id = a.approved_by`;

@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  async list(organizationId: string): Promise<KnowledgeAsset[]> {
    const rows = await this.db.query<AssetRow>(`${ASSET_SELECT} WHERE a.organization_id = $1 ORDER BY a.status = 'archived', a.updated_at DESC`, [organizationId]);
    return rows.map(mapAsset);
  }

  async get(organizationId: string, id: string): Promise<KnowledgeAsset> {
    const rows = await this.db.query<AssetRow>(`${ASSET_SELECT} WHERE a.organization_id = $1 AND a.id = $2`, [organizationId, id]);
    if (!rows[0]) throw new NotFoundException("Knowledge asset not found");
    return mapAsset(rows[0]);
  }

  async create(auth: AuthContext, input: CreateKnowledge, sourceFilename: string | null = null, tx?: Queryable): Promise<KnowledgeAsset> {
    const id = randomUUID();
    const run = async (q: Queryable) => {
      await q.query(
        `INSERT INTO knowledge_assets (id, organization_id, title, kind, status, version, content, tags, source_filename, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'draft',1,$5,$6,$7,$8,now(),now())`,
        [id, auth.organizationId, input.title, input.kind, input.content, input.tags ?? [], sourceFilename, auth.userId]
      );
      await this.writeChunks(q, auth.organizationId, id, 1, input.content);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "knowledge.created", entityType: "knowledge_asset", entityId: id, entityLabel: input.title }, q);
    };
    if (tx) await run(tx);
    else await this.db.transaction(run);
    return tx ? ({ id } as KnowledgeAsset) : this.get(auth.organizationId, id);
  }

  async createFromFile(auth: AuthContext, file: { originalname: string; buffer: Buffer }, kind: KnowledgeKind, title?: string): Promise<KnowledgeAsset> {
    let parsed;
    try {
      parsed = await parseDocument(file.buffer);
    } catch (error) {
      throw new BadRequestException(error instanceof UnsupportedDocumentError ? error.message : "We couldn't read this file.");
    }
    const content = parsed.pages.join("\n\n").trim();
    if (content.length < 20) throw new BadRequestException("The file has no readable text.");
    const fallbackTitle = file.originalname.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 200) || "Untitled asset";
    return this.create(auth, createKnowledgeSchema.parse({ title: title?.trim() || fallbackTitle, kind, content, tags: [] }), file.originalname.slice(0, 200));
  }

  async update(auth: AuthContext, id: string, input: UpdateKnowledge): Promise<KnowledgeAsset> {
    const current = await this.get(auth.organizationId, id);
    const contentChanged = input.content !== undefined && input.content !== current.content;
    const version = contentChanged ? current.version + 1 : current.version;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE knowledge_assets SET title = $3, kind = $4, content = $5, tags = $6, version = $7,
           status = CASE WHEN $8::boolean THEN 'draft' ELSE status END,
           approved_by = CASE WHEN $8::boolean THEN NULL ELSE approved_by END,
           approved_at = CASE WHEN $8::boolean THEN NULL ELSE approved_at END,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [id, auth.organizationId, input.title ?? current.title, input.kind ?? current.kind, input.content ?? current.content, input.tags ?? current.tags, version, contentChanged]
      );
      // Old version chunks are kept so earlier evidence links stay resolvable.
      if (contentChanged) await this.writeChunks(tx, auth.organizationId, id, version, input.content!);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: contentChanged ? "knowledge.revised" : "knowledge.updated", entityType: "knowledge_asset", entityId: id, entityLabel: input.title ?? current.title, data: { version } }, tx);
    });
    return this.get(auth.organizationId, id);
  }

  async setStatus(auth: AuthContext, id: string, status: KnowledgeStatus): Promise<KnowledgeAsset> {
    const current = await this.get(auth.organizationId, id);
    if (status === "approved" && current.status === "approved") throw new ConflictException("Already approved.");
    await this.db.query(
      `UPDATE knowledge_assets SET status = $3,
         approved_by = CASE WHEN $3 = 'approved' THEN $4::uuid ELSE approved_by END,
         approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE approved_at END,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [id, auth.organizationId, status, auth.userId]
    );
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: `knowledge.${status}`, entityType: "knowledge_asset", entityId: id, entityLabel: current.title, data: { version: current.version } });
    return this.get(auth.organizationId, id);
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const rows = await this.db.query<{ title: string }>("DELETE FROM knowledge_assets WHERE id = $1 AND organization_id = $2 RETURNING title", [id, auth.organizationId]);
    if (!rows[0]) throw new NotFoundException("Knowledge asset not found");
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "knowledge.deleted", entityType: "knowledge_asset", entityId: id, entityLabel: rows[0].title });
  }

  private async writeChunks(tx: Queryable, organizationId: string, assetId: string, version: number, content: string): Promise<void> {
    for (const [index, chunk] of chunkText(content).entries()) {
      await tx.query(
        "INSERT INTO knowledge_chunks (id, organization_id, asset_id, asset_version, chunk_index, content) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), organizationId, assetId, version, index, chunk]
      );
    }
  }

  /**
   * Tenant- and approval-filtered evidence search. Only the current version
   * of approved assets is searchable; the organization id always comes from
   * the server-side context, never from the query text.
   */
  async search(organizationId: string, text: string, limit = 5, options: { includeDrafts?: boolean } = {}): Promise<Evidence[]> {
    const tsquery = toTsQuery(text);
    if (!tsquery) return [];
    const rows = await this.db.query<{
      id: string;
      asset_id: string;
      title: string;
      kind: KnowledgeKind;
      asset_version: number;
      content: string;
      score: number;
    }>(
      `SELECT c.id, c.asset_id, a.title, a.kind, c.asset_version, c.content,
              ts_rank_cd(c.tsv, to_tsquery('english', $2), 32) AS score
       FROM knowledge_chunks c
       JOIN knowledge_assets a ON a.id = c.asset_id AND a.organization_id = c.organization_id
       WHERE c.organization_id = $1
         AND c.asset_version = a.version
         AND (a.status = 'approved' OR ($4::boolean AND a.status = 'draft'))
         AND c.tsv @@ to_tsquery('english', $2)
       ORDER BY score DESC, c.chunk_index
       LIMIT $3`,
      [organizationId, tsquery, limit, options.includeDrafts ?? false]
    );
    return rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      assetTitle: row.title,
      assetKind: row.kind,
      assetVersion: Number(row.asset_version),
      excerpt: row.content,
      score: Math.round(Number(row.score) * 1000) / 1000
    }));
  }
}

@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.knowledge.list(auth.organizationId);
  }

  @Get("search")
  search(@Auth() auth: AuthContext, @Query("q") q = "") {
    return this.knowledge.search(auth.organizationId, String(q).slice(0, 500), 8);
  }

  @Get(":id")
  get(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.knowledge.get(auth.organizationId, id);
  }

  @Post()
  @RequirePermission("manageKnowledge")
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.knowledge.create(auth, createKnowledgeSchema.parse(body));
  }

  @Post("upload")
  @RequirePermission("manageKnowledge")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(@Auth() auth: AuthContext, @UploadedFile() file: Express.Multer.File, @Body() body: { kind?: string; title?: string }) {
    if (!file) throw new BadRequestException("Attach a file in the 'file' field.");
    return this.knowledge.createFromFile(auth, file, knowledgeKindSchema.catch("other").parse(body?.kind), body?.title);
  }

  @Patch(":id")
  @RequirePermission("manageKnowledge")
  update(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.knowledge.update(auth, id, updateKnowledgeSchema.parse(body));
  }

  @Post(":id/approve")
  @RequirePermission("approveKnowledge")
  approve(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.knowledge.setStatus(auth, id, "approved");
  }

  @Post(":id/archive")
  @RequirePermission("manageKnowledge")
  archive(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.knowledge.setStatus(auth, id, "archived");
  }

  @Post(":id/restore")
  @RequirePermission("manageKnowledge")
  restore(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.knowledge.setStatus(auth, id, "draft");
  }

  @Delete(":id")
  @RequirePermission("manageKnowledge")
  async remove(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.knowledge.remove(auth, id);
  }
}
