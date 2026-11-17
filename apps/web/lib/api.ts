"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let activeOrganization: string | null = null;
export function setActiveOrganization(id: string | null): void {
  activeOrganization = id;
}

/** Fetch wrapper for the same-origin API proxy. Throws ApiError with a human message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (activeOrganization) headers.set("x-organization-id", activeOrganization);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      credentials: "same-origin"
    });
  } catch {
    throw new ApiError(0, "Can't reach the BidPilot API. Check that it's running.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = (body as { message?: string | string[] } | null)?.message;
    const friendly = Array.isArray(message) ? message.join(", ") : message;
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(response.status, friendly || (response.status >= 500 ? "The API is unavailable right now." : `Request failed (${response.status})`));
  }
  return body as T;
}

export type Query<T> = {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T) => void;
};

/** Minimal data hook with optional polling. */
export function useApi<T>(path: string | null, options: { pollMs?: number | ((data: T | undefined) => number | false) } = {}): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const dataRef = useRef<T>();
  const pollRef = useRef(options.pollMs);
  pollRef.current = options.pollMs;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const value = await api<T>(path);
      dataRef.current = value;
      setData(value);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(Boolean(path));
    void load();
  }, [load, path]);

  useEffect(() => {
    if (!path) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = () => {
      const poll = pollRef.current;
      const ms = typeof poll === "function" ? poll(dataRef.current) : poll;
      if (!ms || stopped) {
        timer = setTimeout(tick, 1500);
        return;
      }
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await load();
        tick();
      }, ms);
    };
    if (pollRef.current) tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, path]);

  return {
    data,
    error,
    loading,
    reload: load,
    setData: (value: T) => {
      dataRef.current = value;
      setData(value);
    }
  };
}

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, options);
}

export function relativeTime(value: string): string {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(value);
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
