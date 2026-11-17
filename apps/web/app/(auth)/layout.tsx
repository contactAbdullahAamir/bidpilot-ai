import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-panel">
        <div className="brand"><span className="brand-mark">B</span><span>BidPilot <em>AI</em></span></div>
        <div className="auth-pitch">
          <p className="eyebrow">Evidence-backed proposal orchestration</p>
          <h1>Turn complex RFPs into <span>confident proposals.</span></h1>
          <ul className="auth-points">
            <li><strong>Every requirement, cited.</strong> Extracted with the source page so nothing gets missed.</li>
            <li><strong>Every claim, backed.</strong> Drafts cite your approved case studies and policies, and gaps are flagged.</li>
            <li><strong>Humans approve.</strong> Reviewers sign off on a locked version before the PDF goes out.</li>
          </ul>
        </div>
        <p className="auth-foot">Built for agencies, consultancies and public-sector bid teams.</p>
      </section>
      <main className="auth-main">{children}</main>
    </div>
  );
}
