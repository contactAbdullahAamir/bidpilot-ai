import { Injectable, Logger } from "@nestjs/common";

export type OutgoingMail = { to: string; subject: string; text: string; html: string };

/**
 * Transactional email. Sends through Resend (https://resend.com, free tier)
 * when RESEND_API_KEY is set; otherwise prints the message to the API log so
 * every flow (verification, reset, invitations) still works in development.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger("Mail");
  /** Last messages sent, newest last (used by tests and the dev log). */
  readonly outbox: OutgoingMail[] = [];

  get mode(): "resend" | "console" {
    return process.env.RESEND_API_KEY ? "resend" : "console";
  }

  async send(mail: OutgoingMail): Promise<void> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();

    if (this.mode === "console") {
      this.logger.log(`\n──── email (dev: set RESEND_API_KEY to deliver) ────\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n────────────────────────────────────────────────`);
      return;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? "BidPilot <onboarding@resend.dev>", to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10_000)
    }).catch((error: Error) => {
      this.logger.error(`Email to ${mail.to} failed: ${error.message}`);
      return null;
    });
    if (response && !response.ok) this.logger.error(`Email to ${mail.to} rejected (${response.status}): ${await response.text()}`);
  }
}

/** Public URL of the web app, used to build links in emails. */
export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Simple, client-safe email layout: one paragraph block and one button. */
export function actionEmail(input: { to: string; subject: string; intro: string; action: string; url: string; outro: string }): OutgoingMail {
  const text = `${input.intro}\n\n${input.action}: ${input.url}\n\n${input.outro}\n\n— BidPilot AI`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<p style="font-weight:700;font-size:18px;margin:0 0 20px">BidPilot <span style="color:#4f46e5">AI</span></p>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(input.intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(input.action)}</a></p>
<p style="font-size:13px;line-height:1.6;color:#667085;margin:0">${escapeHtml(input.outro)}<br><br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.url)}</span></p>
</td></tr></table></body></html>`;
  return { to: input.to, subject: input.subject, text, html };
}
