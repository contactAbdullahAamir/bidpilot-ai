/**
 * Ordered, append-only schema migrations. Never edit an applied migration;
 * add a new one. Statements are separated by ";\n".
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "foundation",
    sql: `
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  client_name text NOT NULL,
  title text NOT NULL,
  deadline timestamptz NULL,
  context text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS opportunities_organization_idx ON opportunities (organization_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS workflows_organization_idx ON workflows (organization_id, updated_at DESC)
`
  },
  {
    version: 2,
    name: "mvp_schema",
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS owner_id uuid NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS analysis jsonb NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS qualification jsonb NULL;
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes int NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  page_count int NOT NULL DEFAULT 0,
  empty_pages jsonb NOT NULL DEFAULT '[]',
  error text NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX documents_opportunity_idx ON documents (organization_id, opportunity_id);
CREATE TABLE document_pages (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  page_number int NOT NULL,
  text text NOT NULL,
  PRIMARY KEY (document_id, page_number)
);
CREATE TABLE knowledge_assets (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  version int NOT NULL,
  content text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  source_filename text NULL,
  created_by uuid NULL,
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX knowledge_assets_org_idx ON knowledge_assets (organization_id, updated_at DESC);
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  asset_version int NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (tsv);
CREATE INDEX knowledge_chunks_asset_idx ON knowledge_chunks (organization_id, asset_id, asset_version);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS current_step text NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS error text NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS mode text NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"estimatedCostUsd":0}';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS revision jsonb NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS source_workflow_id uuid NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS dispatch_attempts int NOT NULL DEFAULT 0;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS created_by uuid NULL;
CREATE TABLE workflow_steps (
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step text NOT NULL,
  position int NOT NULL,
  status text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  output jsonb NULL,
  error text NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  PRIMARY KEY (workflow_id, step)
);
CREATE TABLE workflow_events (
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  sequence int NOT NULL,
  step text NULL,
  level text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, sequence)
);
CREATE TABLE proposals (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  opportunity_id uuid NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  compliance jsonb NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  approved_checksum text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE proposal_sections (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  writer text NOT NULL,
  position int NOT NULL,
  content text NOT NULL,
  requirement_ids jsonb NOT NULL DEFAULT '[]',
  evidence_ids jsonb NOT NULL DEFAULT '[]',
  claims jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL,
  version int NOT NULL DEFAULT 1,
  edited_by_human boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  UNIQUE (proposal_id, key)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  proposal_version int NOT NULL,
  decision text NOT NULL,
  rationale text NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewer_role text NOT NULL,
  checksum text NULL,
  snapshot jsonb NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE exports (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  page_count int NOT NULL,
  template_version text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  actor_id uuid NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NULL,
  entity_label text NULL,
  data jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (organization_id, created_at DESC)
`
  }
];
