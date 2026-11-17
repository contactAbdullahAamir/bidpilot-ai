import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AuthContext } from "../src/auth/auth";
import { hashPassword, verifyPassword } from "../src/auth/auth";
import { AuditService, canonicalJson } from "../src/core/common";
import { DatabaseService } from "../src/core/database.service";
import { detectType, splitIntoPages } from "../src/documents/parser";
import { chunkText, KnowledgeService, toTsQuery } from "../src/knowledge/knowledge";
import { renderProposalPdf } from "../src/proposals/pdf";

const db = new DatabaseService({ liteDir: "memory://" });
const audit = new AuditService(db);
const knowledge = new KnowledgeService(db, audit);

const orgA: AuthContext = { userId: "00000000-0000-0000-0000-00000000000a", userName: "A", email: "a@x.test", organizationId: "org_a", role: "owner" };
const orgB: AuthContext = { ...orgA, userId: "00000000-0000-0000-0000-00000000000b", organizationId: "org_b" };

before(async () => {
  await db.init();
});
after(async () => {
  await db.onModuleDestroy();
});

test("file type detection uses content, not names", () => {
  assert.equal(detectType(Buffer.from("%PDF-1.7 rest")), "pdf");
  assert.equal(detectType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])), "docx");
  assert.equal(detectType(Buffer.from("plain text RFP")), "text");
  assert.throws(() => detectType(Buffer.from([0x00, 0x01, 0x02])));
});

test("pasted text keeps form-feed page boundaries", () => {
  assert.deepEqual(splitIntoPages("page one\fpage two\f\fpage three"), ["page one", "page two", "page three"]);
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(30)).join("\n\n");
  assert.ok(splitIntoPages(long).length > 1);
});

test("chunking keeps heading context and bounded size", () => {
  const chunks = chunkText("Security\n\nWe encrypt data at rest with AES-256.\n\nIncident response\n\nWe notify customers within 24 hours.");
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /^Security: We encrypt/);
  assert.match(chunks[1], /^Incident response: /);
});

test("tsquery builder strips stopwords and operators", () => {
  assert.equal(toTsQuery("The vendor must hold a SOC 2 & report!"), "vendor | hold | soc | report");
  assert.equal(toTsQuery("the and of"), null);
});

test("passwords are salted scrypt hashes", async () => {
  const hash = await hashPassword("correct horse");
  assert.notEqual(hash, await hashPassword("correct horse"));
  assert.ok(await verifyPassword("correct horse", hash));
  assert.ok(!(await verifyPassword("wrong", hash)));
});

test("evidence search is tenant-scoped and approval-filtered", async () => {
  const approved = await knowledge.create(orgA, { title: "Security policy", kind: "policy", content: "Northstar holds ISO 27001 certification and encrypts data with AES-256.", tags: [] });
  await knowledge.setStatus(orgA, approved.id, "approved");
  await knowledge.create(orgA, { title: "Draft pricing", kind: "other", content: "Draft only: ISO 27001 pricing discount guidance for proposals.", tags: [] });
  const other = await knowledge.create(orgB, { title: "Other tenant", kind: "policy", content: "Tenant B also holds ISO 27001 certification and AES-256 encryption.", tags: [] });
  await knowledge.setStatus(orgB, other.id, "approved");

  const results = await knowledge.search("org_a", "ISO 27001 certification", 10);
  assert.equal(results.length, 1, "only the approved asset of org A is returned");
  assert.equal(results[0].assetId, approved.id);
  assert.ok((await knowledge.search("org_c", "ISO 27001", 10)).length === 0, "unknown tenants see nothing");
});

test("editing approved knowledge creates a new draft version", async () => {
  const asset = await knowledge.create(orgA, { title: "Team", kind: "team", content: "We have 140 staff across engineering and design teams.", tags: [] });
  await knowledge.setStatus(orgA, asset.id, "approved");
  const revised = await knowledge.update(orgA, asset.id, { content: "We have 150 staff across engineering, design and delivery." });
  assert.equal(revised.version, 2);
  assert.equal(revised.status, "draft");
  assert.equal((await knowledge.search("org_a", "150 staff engineering", 5)).filter((e) => e.assetId === asset.id).length, 0);
});

test("canonical JSON is key-order independent", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test("PDF export renders a valid multi-page document with WinAnsi-safe text", async () => {
  const { bytes, pageCount } = await renderProposalPdf(
    {
      proposalVersion: 3,
      organizationName: "Northstar",
      opportunity: { title: "Portal - “Modernization”", clientName: "CivicWorks", deadline: null },
      sections: [{ title: "Summary", content: "## Approach\n\nWe deliver **fast**. [E1]\n\n- One\n- Two" }],
      evidence: [{ id: "c1", assetId: "a1", assetTitle: "Case study", assetKind: "case_study", assetVersion: 1, excerpt: "Delivered in 5 months.", score: 1 }],
      approvedBy: "Ada",
      approvedAt: new Date().toISOString()
    },
    "abc123"
  );
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pageCount >= 3);
});
