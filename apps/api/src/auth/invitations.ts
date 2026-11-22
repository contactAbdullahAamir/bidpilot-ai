import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { AcceptInvitation, Invitation, InvitationPreview, InviteMember, OrganizationRole } from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import { AuditService, sha256 } from "../core/common";
import { DatabaseService, Queryable } from "../core/database.service";
import { actionEmail, appUrl, MailService } from "../core/mail";
import { AuthContext, AuthService, hashPassword, newSecret, verifyPassword } from "./auth";

const INVITE_DAYS = 7;

type InvitationRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: OrganizationRole;
  invited_by_name: string | null;
  expires_at: Date;
  created_at: Date;
};

/** Email invitations plus member role changes and removal, with owner safeguards. */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService
  ) {}

  async list(auth: AuthContext): Promise<Invitation[]> {
    const rows = await this.db.query<InvitationRow>(
      `SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.name AS invited_by_name
       FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       ORDER BY i.created_at DESC`,
      [auth.organizationId]
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      invitedBy: r.invited_by_name,
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString()
    }));
  }

  /** Creates (or re-sends) an invitation and emails the link. */
  async invite(auth: AuthContext, input: InviteMember): Promise<void> {
    if (input.role === "owner" && auth.role !== "owner") throw new ForbiddenException("Only owners can invite other owners.");
    const member = await this.db.query(
      "SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2",
      [auth.organizationId, input.email]
    );
    if (member.length) throw new ConflictException("That person is already a member of this workspace.");

    const secret = newSecret();
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      // A new invitation replaces any pending one for the same email.
      await tx.query("UPDATE invitations SET revoked_at = now() WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [auth.organizationId, input.email]);
      await tx.query(
        `INSERT INTO invitations (id, organization_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + interval '${INVITE_DAYS} days')`,
        [id, auth.organizationId, input.email, input.role, sha256(secret), auth.userId]
      );
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "member.invited", entityType: "invitation", entityId: id, entityLabel: `${input.email} (${input.role})` }, tx);
    });

    const org = await this.db.query<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [auth.organizationId]);
    await this.mail.send(
      actionEmail({
        to: input.email,
        subject: `${auth.userName} invited you to ${org[0]?.name ?? "a workspace"} on BidPilot AI`,
        intro: `${auth.userName} invited you to join ${org[0]?.name ?? "their workspace"} on BidPilot AI as ${input.role.replace("_", " ")}. BidPilot helps teams turn RFPs into evidence-backed proposals.`,
        action: "Accept invitation",
        url: appUrl(`/invite?token=${secret}`),
        outro: `This invitation expires in ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.`
      })
    );
  }

  async revoke(auth: AuthContext, id: string): Promise<void> {
    const rows = await this.db.query<{ email: string }>(
      "UPDATE invitations SET revoked_at = now() WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email",
      [id, auth.organizationId]
    );
    if (!rows[0]) throw new NotFoundException("Invitation not found or already used.");
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "member.invitation_revoked", entityType: "invitation", entityId: id, entityLabel: rows[0].email });
  }

  private async pending(secret: string, tx: Queryable = this.db): Promise<InvitationRow> {
    const rows = await tx.query<InvitationRow>(
      `SELECT i.id, i.organization_id, o.name AS organization_name, i.email, i.role, i.expires_at, i.created_at, u.name AS invited_by_name
       FROM invitations i JOIN organizations o ON o.id = i.organization_id LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
      [sha256(secret)]
    );
    if (!rows[0]) throw new NotFoundException("This invitation is invalid, expired or has already been used. Ask your admin for a new one.");
    return rows[0];
  }

  async preview(secret: string): Promise<InvitationPreview> {
    const invite = await this.pending(secret);
    const user = await this.db.query("SELECT 1 FROM users WHERE email = $1", [invite.email]);
    return { email: invite.email, role: invite.role, organizationName: invite.organization_name, invitedBy: invite.invited_by_name, accountExists: user.length > 0 };
  }

  /** Joins the workspace (creating the account if needed) and returns a session. */
  async accept(input: AcceptInvitation): Promise<{ token: string; organizationId: string }> {
    return this.db.transaction(async (tx) => {
      const invite = await this.pending(input.token, tx);
      const users = await tx.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1", [invite.email]);
      let userId = users[0]?.id;
      if (userId) {
        if (!(await verifyPassword(input.password, users[0].password_hash))) throw new UnauthorizedException(`Enter the password for your existing account (${invite.email}).`);
        await tx.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
      } else {
        if (!input.name) throw new BadRequestException("Enter your name to create your account.");
        if (input.password.length < 8) throw new BadRequestException("Use at least 8 characters for your password.");
        userId = randomUUID();
        // The invitation link was delivered to this address, so it is verified.
        await tx.query("INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1,$2,$3,$4, now())", [userId, invite.email, input.name, await hashPassword(input.password)]);
      }
      await tx.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (organization_id, user_id) DO NOTHING", [invite.organization_id, userId, invite.role]);
      await tx.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [invite.id]);
      await this.audit.log({ organizationId: invite.organization_id, actorId: userId, action: "member.joined", entityType: "user", entityId: userId, entityLabel: `${invite.email} (${invite.role})` }, tx);
      return { token: await this.auth.createSession(userId, tx), organizationId: invite.organization_id };
    });
  }

  async changeRole(auth: AuthContext, userId: string, role: OrganizationRole): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.target(tx, auth, userId);
      if (userId === auth.userId) throw new BadRequestException("You can't change your own role. Ask another owner or admin.");
      if ((current === "owner" || role === "owner") && auth.role !== "owner") throw new ForbiddenException("Only owners can grant or remove the owner role.");
      if (current === "owner" && role !== "owner") await this.assertAnotherOwner(tx, auth.organizationId, userId);
      await tx.query("UPDATE memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2", [auth.organizationId, userId, role]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "member.role_changed", entityType: "user", entityId: userId, entityLabel: `${current} → ${role}` }, tx);
    });
  }

  async remove(auth: AuthContext, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.target(tx, auth, userId);
      if (current === "owner" && auth.role !== "owner") throw new ForbiddenException("Only owners can remove an owner.");
      if (current === "owner") await this.assertAnotherOwner(tx, auth.organizationId, userId);
      await tx.query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2", [auth.organizationId, userId]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "member.removed", entityType: "user", entityId: userId, entityLabel: current }, tx);
    });
  }

  private async target(tx: Queryable, auth: AuthContext, userId: string): Promise<OrganizationRole> {
    const rows = await tx.query<{ role: OrganizationRole }>("SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2", [auth.organizationId, userId]);
    if (!rows[0]) throw new NotFoundException("Member not found.");
    return rows[0].role;
  }

  private async assertAnotherOwner(tx: Queryable, organizationId: string, exceptUserId: string): Promise<void> {
    const owners = await tx.query("SELECT 1 FROM memberships WHERE organization_id = $1 AND role = 'owner' AND user_id <> $2", [organizationId, exceptUserId]);
    if (!owners.length) throw new BadRequestException("A workspace needs at least one owner. Make someone else an owner first.");
  }
}
