import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from "@nestjs/common";
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  inviteMemberSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateMemberSchema,
  verifyEmailSchema,
  type Session
} from "@bidpilot/contracts";
import type { Request, Response } from "express";
import { DatabaseService } from "../core/database.service";
import { RateLimit } from "../core/security";
import { OrchestratorClient } from "../workflows/orchestrator.client";
import { Auth, AuthContext, AuthService, DEMO_EMAIL_DOMAIN, Public, readSessionToken, RequirePermission, SESSION_COOKIE } from "./auth";
import { InvitationsService } from "./invitations";

const MINUTE = 60_000;

export function setSessionCookie(response: Response, token: string): void {
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
    private readonly invitations: InvitationsService,
    private readonly orchestrator: OrchestratorClient
  ) {}

  @Public()
  @Post("signup")
  @RateLimit({ name: "signup", limit: 5, windowMs: 60 * MINUTE })
  async signup(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { token } = await this.auth.signup(signupSchema.parse(body));
    setSessionCookie(response, token);
    return { ok: true };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @RateLimit({ name: "login", limit: 10, windowMs: 15 * MINUTE, perEmail: true })
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

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  @RateLimit({ name: "forgot", limit: 5, windowMs: 15 * MINUTE, perEmail: true })
  async forgotPassword(@Body() body: unknown) {
    await this.auth.requestPasswordReset(forgotPasswordSchema.parse(body).email);
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  @RateLimit({ name: "reset", limit: 10, windowMs: 15 * MINUTE })
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = resetPasswordSchema.parse(body);
    const { token } = await this.auth.resetPassword(input.token, input.password);
    setSessionCookie(response, token);
    return { ok: true };
  }

  @Public()
  @Post("verify-email")
  @HttpCode(200)
  @RateLimit({ name: "verify", limit: 20, windowMs: 15 * MINUTE })
  async verifyEmail(@Body() body: unknown) {
    await this.auth.verifyEmail(verifyEmailSchema.parse(body).token);
    return { ok: true };
  }

  @Post("resend-verification")
  @HttpCode(200)
  @RateLimit({ name: "resend-verification", limit: 3, windowMs: 15 * MINUTE })
  async resendVerification(@Auth() auth: AuthContext) {
    await this.auth.sendVerificationEmail(auth.userId);
    return { ok: true };
  }

  @Post("change-password")
  @HttpCode(200)
  @RateLimit({ name: "change-password", limit: 5, windowMs: 15 * MINUTE })
  async changePassword(@Auth() auth: AuthContext, @Req() request: Request, @Body() body: unknown) {
    const input = changePasswordSchema.parse(body);
    await this.auth.changePassword(auth.userId, readSessionToken(request)!, input.currentPassword, input.newPassword);
    return { ok: true };
  }

  @Public()
  @Get("invitations/:token")
  @RateLimit({ name: "invite-preview", limit: 30, windowMs: 15 * MINUTE })
  previewInvitation(@Param("token") token: string) {
    return this.invitations.preview(token);
  }

  @Public()
  @Post("invitations/accept")
  @HttpCode(200)
  @RateLimit({ name: "invite-accept", limit: 10, windowMs: 15 * MINUTE })
  async acceptInvitation(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { token, organizationId } = await this.invitations.accept(acceptInvitationSchema.parse(body));
    setSessionCookie(response, token);
    return { ok: true, organizationId };
  }

  @Get("me")
  async me(@Auth() auth: AuthContext, @Req() request: Request): Promise<Session> {
    const resolved = await this.auth.resolve(readSessionToken(request)!);
    const engine = await this.orchestrator.engine();
    return {
      user: resolved!.user,
      memberships: resolved!.memberships,
      activeOrganizationId: auth.organizationId,
      aiMode: engine.mode,
      aiModel: engine.model,
      demo: resolved!.user.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)
    };
  }
}

@Controller("organization")
export class OrganizationController {
  constructor(private readonly db: DatabaseService, private readonly invitations: InvitationsService) {}

  @Get("members")
  async members(@Auth() auth: AuthContext) {
    const rows = await this.db.query<{ id: string; name: string; email: string; role: string; created_at: Date }>(
      `SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 ORDER BY m.created_at`,
      [auth.organizationId]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, joinedAt: new Date(r.created_at).toISOString() }));
  }

  @Patch("members/:userId")
  @RequirePermission("manageMembers")
  async updateMember(@Auth() auth: AuthContext, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: unknown) {
    await this.invitations.changeRole(auth, userId, updateMemberSchema.parse(body).role);
    return { ok: true };
  }

  @Delete("members/:userId")
  @RequirePermission("manageMembers")
  async removeMember(@Auth() auth: AuthContext, @Param("userId", ParseUUIDPipe) userId: string) {
    await this.invitations.remove(auth, userId);
    return { ok: true };
  }

  @Get("invitations")
  @RequirePermission("manageMembers")
  listInvitations(@Auth() auth: AuthContext) {
    return this.invitations.list(auth);
  }

  @Post("invitations")
  @RequirePermission("manageMembers")
  @RateLimit({ name: "invite", limit: 30, windowMs: 60 * MINUTE })
  async invite(@Auth() auth: AuthContext, @Body() body: unknown) {
    await this.invitations.invite(auth, inviteMemberSchema.parse(body));
    return { ok: true };
  }

  @Delete("invitations/:id")
  @RequirePermission("manageMembers")
  async revokeInvitation(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    await this.invitations.revoke(auth, id);
    return { ok: true };
  }
}
