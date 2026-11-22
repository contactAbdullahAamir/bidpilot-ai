# BidPilot AI: MVP build plan

This plan turns the blueprint (`BidPilot_AI_Coding_Agent_Blueprint.pdf`) into a working MVP.
It records what was built, where the build intentionally departs from the blueprint, and what comes next.

## Guiding decisions (ADR summary)

| # | Decision | Why | Blueprint delta |
|---|----------|-----|-----------------|
| 1 | Keep the AI orchestrator in **TypeScript** (NestJS) with an explicit, persisted step graph instead of Python/LangGraph. | The repo already had a working TS orchestrator boundary. One language keeps the MVP shippable by one developer. Steps are persisted per workflow, so runs survive restarts and pause for human review. | The blueprint asks for Python + LangGraph. The step contract (`WorkflowStep`, internal API) is language-neutral, so a LangGraph worker can replace the TS runner later without API changes. |
| 2 | **The API owns all business writes.** The orchestrator never touches the database. It reads context and writes step results through `/internal/*` endpoints protected by a service token. | This matches the blueprint rule that NestJS owns transactions. It also keeps the orchestrator stateless and restartable. | None |
| 3 | **Postgres, or embedded PGlite when `DATABASE_URL` is unset.** | A fresh developer can run the whole stack with `npm install && npm run dev` and no Docker. Production uses real Postgres (docker-compose provides pgvector). | None. PGlite is real Postgres compiled to WASM, so the same SQL and migrations run on both. |
| 4 | **Model provider adapter** with two implementations: Claude (`claude-opus-5-5`, structured outputs, adaptive thinking, server-side refusal fallback) and a deterministic **heuristic provider** used when no Anthropic credentials are configured. | The product works end to end on any machine and in CI, with no fabricated "AI" claims. The UI clearly labels heuristic mode. | None |
| 5 | **Retrieval = Postgres full-text search (tsvector + ts_rank)**, tenant- and approval-filtered. | No embedding provider is configured yet. FTS is deterministic and auditable. | Vector and hybrid retrieval (RRF) are deferred to the next phase. The retrieval interface already returns evidence packages. |
| 6 | **Local filesystem object storage** behind a storage adapter. The API receives uploads (25 MB limit) and stores a SHA-256 checksum. | MinIO needs registry auth in some environments. | Signed direct-to-S3 uploads come later behind the same adapter. |
| 7 | **Polling (2 s) with per-workflow event sequence numbers**, not WebSockets. | Simple, proxy-friendly, and replayable by `afterSequence`. | Swap to SSE or WebSocket later without contract changes. |
| 8 | **Session auth** (scrypt passwords, opaque session tokens in an httpOnly cookie, hashed at rest) with organization memberships and role guards. | Replaces the development header boundary. | Email invitations, verification and password reset added in phase 9; SSO comes later. |

## Phases and status

1. **Foundation**: auth, organizations, roles, migrations, tenant-scoped repositories, audit log. ✅
2. **Document intelligence**: PDF/DOCX/TXT upload or paste, page-level text, checksum, parse status and errors. ✅ (OCR for scanned PDFs is deferred; such pages are flagged as having no text layer.)
3. **Knowledge + retrieval**: assets with a draft → approved → archived lifecycle, versioning, structure-aware chunking, FTS evidence search, and a search tester. ✅
4. **Orchestration**: persisted steps (analysis → qualification → retrieval → planning → writing → validation), resume after restart, reconciler, retries, cancel. ✅
5. **Proposal generation**: planner, technical and management writers running in parallel, versioned sections, citations, claims. ✅
6. **Validation + approval**: compliance matrix, claim verification, targeted revision runs, reviewer decisions, immutable approved snapshot with checksum, audit. ✅
7. **Frontend**: auth screens, dashboard and onboarding, opportunity workspace, requirement source viewer, Proposal Studio, compliance, review, knowledge base, live workflow monitor. ✅
8. **Hardening**: PDF export from the approved snapshot only, unit and integration tests, docs. ✅ (Evaluation datasets, fault injection, and deployment come next.)
9. **Accounts & security**: email verification, password reset (single-use, 1 h, signs out all devices), change password, email invitations (7 days, single use) with role changes and member removal guarded so a workspace always keeps an owner, per-IP and per-email rate limits on auth routes, security headers on web and API, transactional email via Resend with a dev console fallback. ✅

## Next phase (not built yet)

- Python/LangGraph worker behind the same internal step API, if the team wants LangGraph.
- Embeddings with pgvector, hybrid RRF retrieval, and retrieval evaluation (Recall@K, MRR).
- Client research agent using an approved web-search provider (Claude `web_search` with allowed domains).
- OCR fallback for scanned pages, malware scanning, and signed direct uploads to S3.
- PostgreSQL RLS as defense in depth, SSO (Google / Microsoft), Redis-backed rate limits for multi-instance deployments.
- WebSocket or SSE push, BullMQ outbox for ingestion and export jobs.
- An evaluation corpus and reproducible eval reports.
