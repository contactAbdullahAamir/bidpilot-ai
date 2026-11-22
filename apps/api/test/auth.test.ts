import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AuthContext } from "../src/auth/auth";
import { AuthService } from "../src/auth/auth";
import { InvitationsService } from "../src/auth/invitations";
import { AuditService } from "../src/core/common";
import { DatabaseService } from "../src/core/database.service";
import { MailService } from "../src/core/mail";
import { RateLimiter } from "../src/core/security";

const db = new DatabaseService({ liteDir: "memory://" });
const audit = new AuditService(db);
const mail = new MailService();
const auth = new AuthService(db, audit, mail);
const invitations = new InvitationsService(db, audit, mail, auth);

/** Pull the secret out of the most recent email's link. */
function lastLinkToken(path: string): string {
  const message = mail.outbox.at(-1)!;
  const match = message.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  assert.ok(match, `expected a ${path} link in: ${message.subject}`);
  return match[1];
}

async function ownerContext(email: string): Promise<AuthContext> {
  const { userId, organizationId } = await auth.signup({ name: "Olivia Owner", email, password: "correct-horse-1", organizationName: "Acme" });
  return { userId, userName: "Olivia Owner", email, organizationId, role: "owner" };
}

before(async () => {
  process.env.APP_URL = "http://app.test";
  await db.init();
});
after(async () => {
  await db.onModuleDestroy();
});

test("signup sends a verification email; the link verifies once", async () => {
  const owner = await ownerContext("verify@x.test");
  const session = await auth.createSession(owner.userId);
  assert.equal((await auth.resolve(session))!.user.emailVerified, false);

  const token = lastLinkToken("/verify-email");
  assert.ok(mail.outbox.at(-1)!.text.includes("http://app.test/verify-email?token="));
  await auth.verifyEmail(token);
  assert.equal((await auth.resolve(session))!.user.emailVerified, true);
  await assert.rejects(auth.verifyEmail(token), /invalid or has expired/);
});

test("password reset: no account enumeration, single use, signs out other sessions", async () => {
  const before = mail.outbox.length;
  await auth.requestPasswordReset("nobody@x.test");
  assert.equal(mail.outbox.length, before, "unknown emails get no message but the same response");

  const owner = await ownerContext("reset@x.test");
  const oldSession = await auth.createSession(owner.userId);
  await auth.requestPasswordReset("reset@x.test");
  const first = lastLinkToken("/reset-password");
  await auth.requestPasswordReset("reset@x.test");
  const second = lastLinkToken("/reset-password");
  await assert.rejects(auth.resetPassword(first, "new-password-1"), /invalid or has expired/, "older links stop working");

  const { token } = await auth.resetPassword(second, "new-password-1");
  assert.equal(await auth.resolve(oldSession), null, "old sessions are revoked");
  assert.ok(await auth.resolve(token));
  await assert.rejects(auth.login("reset@x.test", "correct-horse-1"));
  assert.ok(await auth.login("reset@x.test", "new-password-1"));
  await assert.rejects(auth.resetPassword(second, "another-pass-1"), /invalid or has expired/);
});

test("change password requires the current one and keeps only this session", async () => {
  const owner = await ownerContext("change@x.test");
  const here = await auth.createSession(owner.userId);
  const elsewhere = await auth.createSession(owner.userId);
  await assert.rejects(auth.changePassword(owner.userId, here, "wrong", "brand-new-pass"), /current password is incorrect/);
  await auth.changePassword(owner.userId, here, "correct-horse-1", "brand-new-pass");
  assert.ok(await auth.resolve(here));
  assert.equal(await auth.resolve(elsewhere), null);
});

test("invitations: new user joins with the invited role, link is single use", async () => {
  const owner = await ownerContext("inviter@x.test");
  await invitations.invite(owner, { email: "newbie@x.test", role: "reviewer" });
  const token = lastLinkToken("/invite");
  const preview = await invitations.preview(token);
  assert.deepEqual({ ...preview }, { email: "newbie@x.test", role: "reviewer", organizationName: "Acme", invitedBy: "Olivia Owner", accountExists: false });
  assert.equal((await invitations.list(owner)).length, 1);

  await assert.rejects(invitations.accept({ token, password: "long-enough-1" }), /Enter your name/);
  const { token: session, organizationId } = await invitations.accept({ token, name: "Nina New", password: "long-enough-1" });
  assert.equal(organizationId, owner.organizationId);
  const resolved = (await auth.resolve(session))!;
  assert.equal(resolved.user.emailVerified, true);
  assert.deepEqual(resolved.memberships.map((m) => m.role), ["reviewer"]);
  assert.equal((await invitations.list(owner)).length, 0);
  await assert.rejects(invitations.accept({ token, name: "Again", password: "long-enough-1" }), /invalid, expired/);
  await assert.rejects(invitations.invite(owner, { email: "newbie@x.test", role: "admin" }), /already a member/);
});

test("invitations: existing account must prove its password; re-invite and revoke kill old links", async () => {
  const owner = await ownerContext("org2@x.test");
  await ownerContext("existing@x.test");
  await invitations.invite(owner, { email: "existing@x.test", role: "contributor" });
  const stale = lastLinkToken("/invite");
  await invitations.invite(owner, { email: "existing@x.test", role: "admin" });
  const token = lastLinkToken("/invite");
  await assert.rejects(invitations.preview(stale), /invalid, expired/);
  assert.equal((await invitations.preview(token)).accountExists, true);
  await assert.rejects(invitations.accept({ token, password: "wrong" }), /existing account/);
  const { token: session } = await invitations.accept({ token, password: "correct-horse-1" });
  assert.equal((await auth.resolve(session))!.memberships.length, 2);

  await invitations.invite(owner, { email: "revoked@x.test", role: "reviewer" });
  const revokedToken = lastLinkToken("/invite");
  const [pending] = await invitations.list(owner);
  await invitations.revoke(owner, pending.id);
  await assert.rejects(invitations.preview(revokedToken), /invalid, expired/);
});

test("member management protects owners and the last owner", async () => {
  const owner = await ownerContext("boss@x.test");
  await invitations.invite(owner, { email: "admin@x.test", role: "admin" });
  const { token } = await invitations.accept({ token: lastLinkToken("/invite"), name: "Ada Admin", password: "long-enough-1" });
  const adminUser = (await auth.resolve(token))!.user;
  const admin: AuthContext = { userId: adminUser.id, userName: "Ada Admin", email: "admin@x.test", organizationId: owner.organizationId, role: "admin" };

  await assert.rejects(invitations.invite(admin, { email: "o2@x.test", role: "owner" }), /Only owners/);
  await assert.rejects(invitations.changeRole(admin, owner.userId, "reviewer"), /Only owners/);
  await assert.rejects(invitations.remove(admin, owner.userId), /Only owners/);
  await assert.rejects(invitations.changeRole(owner, owner.userId, "admin"), /your own role/);
  await assert.rejects(invitations.remove(owner, owner.userId), /at least one owner/);

  await invitations.changeRole(owner, admin.userId, "reviewer");
  await invitations.remove(owner, admin.userId);
  assert.equal((await auth.resolve(token))!.memberships.length, 0, "removed members lose access");
});

test("rate limiter blocks after the limit and resets after the window", () => {
  const limiter = new RateLimiter();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(limiter.hit("k", 3, 60_000, now).allowed, true);
  const blocked = limiter.hit("k", 3, 60_000, now + 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 59);
  assert.equal(limiter.hit("other", 3, 60_000, now).allowed, true);
  assert.equal(limiter.hit("k", 3, 60_000, now + 60_001).allowed, true);
});
