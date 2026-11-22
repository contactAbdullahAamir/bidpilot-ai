import type { Metadata } from "next";
import Link from "next/link";
import { DemoButton } from "../components/demo-button";
import "./landing.css";

export const metadata: Metadata = {
  title: "BidPilot AI · RFP to evidence-backed proposal",
  description:
    "BidPilot AI reads an RFP, extracts every requirement with its source page, checks eligibility, drafts each section with citations to your approved evidence, and routes it through human review to a locked PDF."
};

const PIPELINE = [
  { n: "01", title: "Ingest", body: "Upload a PDF or DOCX RFP, or paste it. Pages are checksummed and empty scans are flagged." },
  { n: "02", title: "Analyze", body: "Every requirement, deadline and evaluation criterion is extracted with a verbatim quote and page number." },
  { n: "03", title: "Qualify", body: "Mandatory criteria are checked against approved company evidence for a Go, Conditional or No-Go call." },
  { n: "04", title: "Draft", body: "Technical and management writers draft in parallel. Each claim cites the evidence it relies on." },
  { n: "05", title: "Validate", body: "A compliance matrix maps requirements to sections. Unsupported claims are flagged and never marked as verified." },
  { n: "06", title: "Approve", body: "A reviewer signs off. The version is locked with a SHA-256 checksum and exported to PDF." }
];

const FEATURES = [
  { icon: "📄", title: "Requirements with sources", body: "Click any requirement to open the exact page and quote it came from. Ambiguous deadlines are flagged for a human to confirm." },
  { icon: "⚖️", title: "Go / No-Go in minutes", body: "Eligibility is checked against your certifications and policies. Gaps like a missing SOC 2 report are surfaced before you write." },
  { icon: "🔗", title: "Every claim cited", body: "Drafts cite approved case studies and policies inline. If nothing supports a statement, the draft asks for input instead of guessing." },
  { icon: "✅", title: "Compliance matrix", body: "See coverage per requirement, revise weak sections with feedback, and re-validate with one click." },
  { icon: "🔒", title: "Human approval, locked output", body: "Approval needs a reviewer role. Any later edit voids it. The PDF is rendered only from the approved snapshot." },
  { icon: "👥", title: "Built for teams", body: "Workspaces with five roles, email invitations, a full audit log, rate-limited sign-in and strict tenant isolation." }
];

const STACK = ["Next.js 14", "React 18", "TypeScript", "NestJS", "PostgreSQL", "Zod contracts", "Claude / Gemini / Groq / Ollama", "Docker", "GitHub Actions"];

function ProductMock() {
  const rows = [
    { code: "M-1", text: "Hold a current SOC 2 Type II report", page: "p.2", status: "Gap", tone: "danger" },
    { code: "M-2", text: "ISO/IEC 27001 certification", page: "p.2", status: "Met", tone: "ok" },
    { code: "F-1", text: "English and Spanish resident content", page: "p.3", status: "Covered", tone: "ok" },
    { code: "F-2", text: "WCAG 2.1 Level AA accessibility", page: "p.3", status: "Covered", tone: "ok" },
    { code: "S-4", text: "Notify incidents within 24 hours", page: "p.4", status: "Partial", tone: "warn" }
  ];
  return (
    <div className="lp-mock" aria-label="Product preview with sample data">
      <div className="lp-mock-bar">
        <span /><span /><span />
        <em>City Services Portal Modernization · CivicWorks (sample)</em>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-cards">
          <div className="lp-mock-card">
            <small>Bid recommendation</small>
            <strong className="lp-tone-warn">Conditional</strong>
            <p>1 mandatory gap: SOC 2 Type II</p>
          </div>
          <div className="lp-mock-card">
            <small>Requirements</small>
            <strong>23</strong>
            <p>extracted with page citations</p>
          </div>
          <div className="lp-mock-card">
            <small>Draft sections</small>
            <strong>8</strong>
            <p>each claim linked to evidence</p>
          </div>
        </div>
        <table className="lp-mock-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="lp-mono">{r.code}</td>
                <td>{r.text}</td>
                <td className="lp-mono lp-dim">{r.page}</td>
                <td><span className={`lp-pill lp-pill-${r.tone}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lp-mock-draft">
          <small>Proposal Studio · Security approach</small>
          <p>
            Northstar has held ISO/IEC 27001 certification since 2019 <span className="lp-cite">E2</span> and encrypts resident data with AES-256 at rest <span className="lp-cite">E2</span>.{" "}
            <mark>[Needs input: SOC 2 Type II timeline]</mark>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/" className="brand"><span className="brand-mark">B</span><span>BidPilot <em>AI</em></span></Link>
        <nav>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#engineering">Engineering</a>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-link">Sign in</Link>
          <Link href="/signup" className="btn btn-secondary btn-md">Create workspace</Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">AI proposal operations for bid teams</p>
          <h1>Turn complex RFPs into <span>compliant, cited proposals.</span></h1>
          <p className="lp-lead">
            BidPilot reads the RFP, extracts every requirement with its source page, checks whether you qualify, drafts each section from your approved evidence, and routes it through human review to a locked PDF.
          </p>
          <div className="lp-hero-cta">
            <DemoButton />
            <a href="#how" className="lp-link lp-link-light">See how it works ↓</a>
          </div>
          <p className="lp-note">No sign-up. You get a private sandbox with a sample RFP, and the AI analysis starts automatically.</p>
        </div>
        <ProductMock />
      </section>

      <section className="lp-strip">
        <div><strong>Page-level</strong><span>citations for every requirement</span></div>
        <div><strong>6-step</strong><span>resumable AI pipeline</span></div>
        <div><strong>0</strong><span>claims marked verified without evidence</span></div>
        <div><strong>SHA-256</strong><span>locked approval snapshots</span></div>
      </section>

      <section className="lp-section" id="how">
        <p className="lp-eyebrow">How it works</p>
        <h2>From RFP to approved proposal in six auditable steps</h2>
        <ol className="lp-pipeline">
          {PIPELINE.map((s) => (
            <li key={s.n}>
              <span className="lp-step">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="features">
        <p className="lp-eyebrow">Features</p>
        <h2>AI that does the reading. Humans who make the call.</h2>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-feature">
              <span className="lp-icon" aria-hidden>{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-eng" id="engineering">
        <div>
          <p className="lp-eyebrow">Engineering</p>
          <h2>Production architecture, not a prompt wrapper</h2>
          <ul className="lp-checks">
            <li><strong>Three services</strong>: a Next.js app, a NestJS API that owns every database write, and a stateless AI orchestrator.</li>
            <li><strong>Model-agnostic</strong>: Claude with structured outputs, any OpenAI-compatible model (Gemini, Groq, OpenRouter, Ollama), or a deterministic offline engine.</li>
            <li><strong>Grounded by design</strong>: model output is schema-validated. Quotes are checked against the source pages, and citations must resolve to approved evidence.</li>
            <li><strong>Resumable workflows</strong>: every step is checkpointed, so runs survive restarts and failed steps retry.</li>
            <li><strong>Multi-tenant and secure</strong>: tenancy is enforced from the session on every query. Sign-in is rate-limited, every action is audited, and reset and invite links are single-use.</li>
            <li><strong>Tested</strong>: unit and integration tests run on real Postgres (PGlite) in CI.</li>
          </ul>
        </div>
        <div className="lp-arch" aria-label="Architecture diagram">
          <div className="lp-arch-node">Next.js web app<small>Proposal Studio · review · knowledge</small></div>
          <div className="lp-arch-arrow">↓ REST + session cookie</div>
          <div className="lp-arch-node lp-arch-core">NestJS API<small>auth · tenancy · RBAC · audit · PDF</small></div>
          <div className="lp-arch-split">
            <div className="lp-arch-node">PostgreSQL<small>documents · evidence FTS · workflows</small></div>
            <div className="lp-arch-node">AI orchestrator<small>analysis → qualification → drafting → validation</small></div>
          </div>
          <div className="lp-arch-arrow">↓ structured outputs</div>
          <div className="lp-arch-node lp-arch-ai">Claude · Gemini · Groq · Ollama</div>
          <div className="lp-stack">{STACK.map((s) => <span key={s}>{s}</span>)}</div>
        </div>
      </section>

      <section className="lp-final">
        <h2>See it work on a real-looking RFP</h2>
        <p>A fictional city-portal RFP and a vendor that is missing one required certification. Watch BidPilot catch the gap.</p>
        <DemoButton label="Launch the live demo" />
      </section>

      <footer className="lp-footer">
        <span className="brand"><span className="brand-mark small">B</span><span>BidPilot <em>AI</em></span></span>
        <span>Demo data is fully synthetic. CivicWorks Department and Northstar Digital Solutions are fictional.</span>
      </footer>
    </div>
  );
}
