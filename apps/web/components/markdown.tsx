"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown renderer (no HTML passthrough). Supports headings,
 * paragraphs, bullet/numbered lists, bold, italics, code, and evidence
 * citations like [E3] which render as interactive chips.
 */
export function Markdown({ source, onCite, citeTone }: { source: string; onCite?: (label: string) => void; citeTone?: (label: string) => "ok" | "warn" | "missing" }) {
  const blocks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        const heading = lines.length === 1 ? lines[0].match(/^(#{1,6})\s+(.*)$/) : null;
        if (heading) {
          const level = Math.min(heading[1].length + 1, 5);
          const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
          return <Tag key={index}>{inline(heading[2], onCite, citeTone)}</Tag>;
        }
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={index}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ""), onCite, citeTone)}</li>)}</ul>;
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return <ol key={index}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), onCite, citeTone)}</li>)}</ol>;
        }
        return (
          <Fragment key={index}>
            {lines.map((line, i) => {
              const h = line.match(/^(#{1,6})\s+(.*)$/);
              if (h) return <h4 key={i}>{inline(h[2], onCite, citeTone)}</h4>;
              return null;
            })}
            {lines.some((l) => !/^#{1,6}\s/.test(l)) && <p>{inline(lines.filter((l) => !/^#{1,6}\s/.test(l)).join(" "), onCite, citeTone)}</p>}
          </Fragment>
        );
      })}
    </div>
  );
}

function inline(text: string, onCite?: (label: string) => void, citeTone?: (label: string) => "ok" | "warn" | "missing"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*\[Needs input[^\]]*\]\*|\*[^*]+\*|`[^`]+`|\[E\d+\])/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*[Needs input")) nodes.push(<mark key={key++} className="needs-input">{token.slice(2, -2)}</mark>);
    else if (token.startsWith("*")) nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("`")) nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else {
      const label = token.slice(1, -1);
      const tone = citeTone?.(label) ?? "ok";
      nodes.push(
        <button key={key++} type="button" className={`cite cite-${tone}`} onClick={() => onCite?.(label)} title="View evidence">
          {label}
        </button>
      );
    }
    last = match.index! + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
