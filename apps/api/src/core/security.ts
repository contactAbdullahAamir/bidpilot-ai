import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";

export const RATE_LIMIT_KEY = "bidpilot:rate-limit";

export type RateLimitRule = {
  /** Bucket name; routes sharing a name share a budget. */
  name: string;
  limit: number;
  windowMs: number;
  /** Also count per submitted email (e.g. login, password reset) to stop spraying one account from many IPs. */
  perEmail?: boolean;
};

/** Limit how often a client may call this route. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

/**
 * Fixed-window, in-memory limiter. Good for a single API instance; move the
 * counters to Redis when running several replicas.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    if (this.hits.size > 50_000) this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  reset(): void {
    this.hits.clear();
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export const rateLimiter = new RateLimiter();

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (process.env.RATE_LIMIT_DISABLED === "true") return true;
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const keys = [`${rule.name}:ip:${request.ip ?? "unknown"}`];
    const email = rule.perEmail ? (request.body as { email?: unknown } | undefined)?.email : undefined;
    if (typeof email === "string" && email) keys.push(`${rule.name}:email:${email.trim().toLowerCase()}`);
    for (const key of keys) {
      const result = rateLimiter.hit(key, rule.limit, rule.windowMs);
      if (!result.allowed) {
        context.switchToHttp().getResponse<Response>().setHeader("Retry-After", String(result.retryAfterSec));
        const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
        throw new HttpException(`Too many attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }
}

/** Conservative security headers for a JSON API. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.removeHeader("X-Powered-By");
  next();
}
