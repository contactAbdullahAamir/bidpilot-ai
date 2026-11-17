"use client";

import type { DocumentPage, SourceRef } from "@bidpilot/contracts";
import { useEffect, useRef } from "react";
import { useApi } from "../../lib/api";
import { Drawer, ErrorState, Skeleton } from "../ui";

/** Shows the original RFP page with the cited quote highlighted. */
export function SourceDrawer({ source, title, onClose }: { source: SourceRef | null; title: string; onClose: () => void }) {
  const { data, error, loading } = useApi<DocumentPage>(source ? `/documents/${source.documentId}/pages/${source.page}` : null);
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [data]);

  return (
    <Drawer open={Boolean(source)} onClose={onClose} title={title} subtitle={data ? `${data.filename} · page ${data.pageNumber}` : source ? `Page ${source.page}` : undefined}>
      {loading && !data ? (
        <div className="stack">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={14} />)}</div>
      ) : error ? (
        <ErrorState message={error.message} />
      ) : data && source ? (
        <>
          <blockquote className="quote">“{source.quote}”</blockquote>
          <div className="page-text">{highlight(data.text, source.quote, markRef)}</div>
        </>
      ) : null}
    </Drawer>
  );
}

function highlight(text: string, quote: string, ref: React.RefObject<HTMLElement>) {
  const needle = quote.trim().slice(0, 160);
  let index = needle ? text.indexOf(needle) : -1;
  let length = needle.length;
  if (index < 0 && needle) {
    // Whitespace-insensitive fallback
    const pattern = new RegExp(needle.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
    const match = text.match(pattern);
    if (match?.index !== undefined) {
      index = match.index;
      length = match[0].length;
    }
  }
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark ref={ref} className="source-mark">{text.slice(index, index + length)}</mark>
      {text.slice(index + length)}
    </>
  );
}
