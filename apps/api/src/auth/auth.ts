import {
  BadRequestException,
  CanActivate,
  ConflictException,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  can,
  type Membership,
  type OrganizationRole,
  type Permission,
  type Session,
  type Signup
} from "@bidpilot/contracts";
import type { Request } from "express";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AuditService, sha256 } from "../core/common";
import { DatabaseService, Queryable } from "../core/database.service";
import { actionEmail, appUrl, MailService } from "../core/mail";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "bp_session";
/** Accounts created by the one-click demo use this non-routable email domain. */
export const DEMO_EMAIL_DOMAIN = "demo.bidpilot.invalid";
const SESSION_DAYS = 14;

export interface AuthContext {
  userId: string;
  userName: string;
  email: string;
  organizationId: string;
  role: OrganizationRole;
}

export interface AuthedRequest extends Request {
  auth: AuthContext;
}

export const PUBLIC_KEY = "bidpilot:public";
export const PERMISSION_KEY = "bidpilot:permission";
/** Route is reachable without a user session (it may use its own guard). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Route requires the caller's organization role to grant this permission. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().auth);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function readSessionToken(request: Request): string | null {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookie = request.header("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export type TokenPurpose = "verify_email" | "reset_password";
const TOKEN_TTL: Record<TokenPurpose, string> = { verify_email: "3 days", reset_password: "1 hour" };

/** Random URL-safe secret; only its SHA-256 is stored. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService, private readonly mail: MailService) {}

  async signup(input: Signup): Promise<{ token: string; userId: string; organizationId: string }> {
    const existing = await this.db.query("SELECT id FROM users WHERE email = $1", [input.email]);
    if (existing.length) throw new ConflictException("An account with this email already exists. Try signing in.");
    const userId = randomUUID();
    const organizationId = `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const passwordHash = await hashPassword(input.password);
    await this.db.transaction(async (tx) => {
      await tx.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)", [userId, input.email, input.name, passwordHash]);
      await tx.query("INSERT INTO organizations (id, name) VALUES ($1,$2)", [organizationId, input.organizationName]);
      await tx.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')", [organizationId, userId]);
      await this.audit.log({ organizationId, actorId: userId, action: "organization.created", entityType: "organization", entityId: organizationId, entityLabel: input.organizationName }, tx);
    });
    await this.sendVerificationEmail(userId);
    return { token: await this.createSession(userId), userId, organizationId };
  }

  private async issueToken(userId: string, purpose: TokenPurpose, tx: Queryable = this.db): Promise<string> {
    // Only the newest link of each kind works.
    await tx.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [userId, purpose]);
    const secret = newSecret();
    await tx.query(`INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + interval '${TOKEN_TTL[purpose]}')`, [sha256(secret), userId, purpose]);
    return secret;
  }

  /** Marks a token used and returns its user, or null if it is unknown, used or expired. */
  private async consumeToken(secret: string, purpose: TokenPurpose, tx: Queryable = this.db): Promise<string | null> {
    const rows = await tx.query<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(secret), purpose]
    );
    return rows[0]?.user_id ?? null;
  }

  async sendVerificationEmail(userId: string): Promise<void> {
    const rows = await this.db.query<{ email: string; name: string; email_verified_at: Date | null }>("SELECT email, name, email_verified_at FROM users WHERE id = $1", [userId]);
    const user = rows[0];
    if (!user || user.email_verified_at) return;
    const secret = await this.issueToken(userId, "verify_email");
    await this.mail.send(
      actionEmail({
        to: user.email,
        subject: "Confirm your email for BidPilot AI",
        intro: `Hi ${user.name}, please confirm that this is your email address so we can send you deadline alerts and account notices.`,
        action: "Confirm email",
        url: appUrl(`/verify-email?token=${secret}`),
        outro: "This link expires in 3 days. If you didn't create a BidPilot account, you can ignore this email."
      })
    );
  }

  async verifyEmail(secret: string): Promise<void> {
    const userId = await this.consumeToken(secret, "verify_email");
    if (!userId) throw new BadRequestException("This confirmation link is invalid or has expired. Sign in and request a new one.");
    await this.db.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
  }

  /** Always succeeds, so the response never reveals whether an account exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const rows = await this.db.query<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user) return;
    const secret = await this.issueToken(user.id, "reset_password");
    await this.mail.send(
      actionEmail({
        to: email,
        subject: "Reset your BidPilot AI password",
        intro: `Hi ${user.name}, we received a request to reset your password.`,
        action: "Choose a new password",
        url: appUrl(`/reset-password?token=${secret}`),
        outro: "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email; your password won't change."
      })
    );
  }

  /** Sets a new password, signs out every device, and returns a fresh session. */
  async resetPassword(secret: string, password: string): Promise<{ token: string }> {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const userId = await this.consumeToken(secret, "reset_password", tx);
      if (!userId) throw new BadRequestException("This reset link is invalid or has expired. Request a new one.");
      // Receiving the email proves the address, so it also counts as verification.
      await tx.query("UPDATE users SET password_hash = $2, password_changed_at = now(), email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId, passwordHash]);
      await tx.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      return { token: await this.createSession(userId, tx) };
    });
  }

  /** Changes the password and signs out every other session. */
  async changePassword(userId: string, currentToken: string, currentPassword: string, newPassword: string): Promise<void> {
    const rows = await this.db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) throw new BadRequestException("Your current password is incorrect.");
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [userId, await hashPassword(newPassword)]);
      await tx.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [userId, sha256(currentToken)]);
    });
  }

  async login(email: string, password: string): Promise<{ token: string }> {
    const rows = await this.db.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1", [email]);
    const user = rows[0];
    // Always run a hash comparison to keep timing uniform for unknown emails.
    const ok = await verifyPassword(password, user?.password_hash ?? "scrypt$00$00");
    if (!user || !ok) throw new UnauthorizedException("Email or password is incorrect.");
    return { token: await this.createSession(user.id) };
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  }

  async createSession(userId: string, tx: Queryable = this.db): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await tx.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [sha256(token), userId]
    );
    return token;
  }

  async resolve(token: string): Promise<{ user: Session["user"]; memberships: Membership[] } | null> {
    const users = await this.db.query<{ id: string; name: string; email: string; email_verified_at: Date | null }>(
      `SELECT u.id, u.name, u.email, u.email_verified_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    const row = users[0];
    if (!row) return null;
    const user = { id: row.id, name: row.name, email: row.email, emailVerified: Boolean(row.email_verified_at) };
    const memberships = await this.db.query<{ organization_id: string; name: string; role: OrganizationRole }>(
      `SELECT m.organization_id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 ORDER BY m.created_at`,
      [user.id]
    );
    return {
      user,
      memberships: memberships.map((m) => ({ organizationId: m.organization_id, organizationName: m.name, role: m.role }))
    };
  }
}

/**
 * Global guard: every route requires a valid session and an organization
 * membership unless marked @Public(). The organization comes from the
 * caller's memberships (optionally selected via x-organization-id), never
 * from request bodies or model output.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionToken(request);
    const resolved = token ? await this.auth.resolve(token) : null;
    if (!resolved) throw new UnauthorizedException("Please sign in to continue.");

    const requested = request.header("x-organization-id");
    const membership = requested
      ? resolved.memberships.find((m) => m.organizationId === requested)
      : resolved.memberships[0];
    if (!membership) throw new ForbiddenException("You are not a member of this organization.");

    request.auth = {
      userId: resolved.user.id,
      userName: resolved.user.name,
      email: resolved.user.email,
      organizationId: membership.organizationId,
      role: membership.role
    };

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    if (permission && !can(membership.role, permission)) {
      throw new ForbiddenException(`Your role (${membership.role.replace("_", " ")}) cannot perform this action.`);
    }
    return true;
  }
}

/** Service-to-service guard for orchestrator callbacks. */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = internalToken();
    const actual = request.header("x-internal-token") ?? "";
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("Invalid service token");
    return true;
  }
}

export function internalToken(): string {
  return process.env.INTERNAL_SERVICE_TOKEN ?? "bidpilot-dev-internal-token";
}
