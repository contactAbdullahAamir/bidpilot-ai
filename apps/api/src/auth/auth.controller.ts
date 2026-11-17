import { Body, ConflictException, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { addMemberSchema, loginSchema, signupSchema, type Session } from "@bidpilot/contracts";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { AuditService } from "../core/common";
import { DatabaseService } from "../core/database.service";
import { OrchestratorClient } from "../workflows/orchestrator.client";
import {
  Auth,
  AuthContext,
  AuthService,
  hashPassword,
  Public,
  readSessionToken,
  RequirePermission,
  SESSION_COOKIE
} from "./auth";

function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 24 * 60 * 60 * 1000
  });
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly orchestrator: OrchestratorClient
  ) {}

  @Public()
  @Post("signup")
  async signup(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { token } = await this.auth.signup(signupSchema.parse(body));
    setSessionCookie(response, token);
    return { ok: true };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = loginSchema.parse(body);
    const { token } = await this.auth.login(input.email, input.password);
    setSessionCookie(response, token);
    return { ok: true };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(readSessionToken(request));
    response.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  async me(@Auth() auth: AuthContext, @Req() request: Request): Promise<Session> {
    const resolved = await this.auth.resolve(readSessionToken(request)!);
    return {
      user: resolved!.user,
      memberships: resolved!.memberships,
      activeOrganizationId: auth.organizationId,
      aiMode: await this.orchestrator.mode()
    };
  }
}

@Controller("organization")
export class OrganizationController {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  @Get("members")
  async members(@Auth() auth: AuthContext) {
    const rows = await this.db.query<{ id: string; name: string; email: string; role: string; created_at: Date }>(
      `SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 ORDER BY m.created_at`,
      [auth.organizationId]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, joinedAt: new Date(r.created_at).toISOString() }));
  }

  @Post("members")
  @RequirePermission("manageMembers")
  async addMember(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = addMemberSchema.parse(body);
    if (input.role === "owner" && auth.role !== "owner") throw new ConflictException("Only owners can add owners.");
    const existing = await this.db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [input.email]);
    const userId = existing[0]?.id ?? randomUUID();
    await this.db.transaction(async (tx) => {
      if (!existing[0]) {
        await tx.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)", [userId, input.email, input.name, await hashPassword(input.password)]);
      }
      const member = await tx.query("SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2", [auth.organizationId, userId]);
      if (member.length) throw new ConflictException("That person is already a member.");
      await tx.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,$3)", [auth.organizationId, userId, input.role]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "member.added", entityType: "user", entityId: userId, entityLabel: `${input.name} (${input.role})` }, tx);
    });
    return { ok: true };
  }
}
