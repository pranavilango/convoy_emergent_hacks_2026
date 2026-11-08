import type { ReactNode } from "react";

/**
 * Renders the analysis Gemini writes, which uses a small slice of Markdown: headings, bullet and
 * numbered lists, rules, **bold**, *italic*, and `code`. Everything is rendered as React text
 * (never as HTML), so model output can't inject markup.
 */
export function AnalysisText({ text }: { text: string }) {
  return <div className="space-y-3 text-sm leading-relaxed">{blocks(text)}</div>;
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function parse(text: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      out.push({ kind: "heading", text: line.replace(/^#{1,6}\s+/, "") });
    } else if (/^([-*_])\1{2,}$/.test(line)) {
      flush();
      out.push({ kind: "rule" });
    } else if (BULLET.test(raw) || NUMBERED.test(raw)) {
      flush();
      const ordered = NUMBERED.test(raw);
      const item = raw.replace(ordered ? NUMBERED : BULLET, "").trim();
      const last = out.at(-1);
      // Indented sub-items join their parent list rather than starting a new one.
      if (last?.kind === "list" && (last.ordered === ordered || /^\s{2,}/.test(raw))) {
        last.items.push(item);
      } else {
        out.push({ kind: "list", ordered, items: [item] });
      }
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return out;
}

function blocks(text: string): ReactNode[] {
  return parse(text).map((block, i) => {
    switch (block.kind) {
      case "heading":
        return (
          <h3 key={i} className="pt-2 font-mono text-[11px] uppercase tracking-wider opacity-70">
            {inline(block.text)}
          </h3>
        );
      case "rule":
        return <hr key={i} className="border-foreground/20" />;
      case "list": {
        const items = block.items.map((item, j) => (
          <li key={j} className="marker:text-brand">
            {listItem(item)}
          </li>
        ));
        return block.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        );
      }
      case "paragraph":
        return <p key={i}>{inline(block.text)}</p>;
    }
  });
}

function listItem(text: string): ReactNode[] {
  const markdownLabel = text.match(/^\*\*(.+?):\*\*\s*(.*)$/);
  if (markdownLabel) {
    return [
      <strong key="label" className="font-semibold text-white">
        {markdownLabel[1]}:
      </strong>,
      ...inline(markdownLabel[2] ?? ""),
    ];
  }

  const colon = text.indexOf(":");
  if (colon < 1) return inline(text);

  const label = text.slice(0, colon).trim();
  return [
    <strong key="label" className="font-semibold text-white">
      {label}:
    </strong>,
    ...inline(text.slice(colon + 1)),
  ];
}

/** **bold**, *italic* / _italic_, and `code`; anything else stays literal text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [, bold, code, em1, em2] = match;
    const key = match.index;
    if (bold !== undefined)
      out.push(
        <strong key={key} className="font-semibold text-brand">
          {bold}
        </strong>,
      );
    else if (code !== undefined)
      out.push(
        <span key={key} className="font-mono text-xs">
          {code}
        </span>,
      );
    else out.push(<em key={key}>{em1 ?? em2}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
