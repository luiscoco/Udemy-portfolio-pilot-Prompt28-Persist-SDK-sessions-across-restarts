import { Fragment, type ReactNode } from 'react';
import { validatedSourceUrl, type ChatSource } from '@portfolio-pilot/contracts';

export function evidenceLink(value: string, sources: readonly ChatSource[]) {
  const url = validatedSourceUrl(value);
  return url && sources.some(s => validatedSourceUrl(s.url) === url) ? url : null;
}
/** Deliberately small Markdown grammar. React escapes all text; no HTML, images or autolinks. */
function inline(text: string, sources: readonly ChatSource[]): ReactNode[] {
  const tokens = text.split(/(\[[^\]\n]{1,200}\]\([^\s)]{1,2048}\)|\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return tokens.map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = evidenceLink(link[2]!, sources);
      return href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link[1]}</a> : <Fragment key={i}>{link[1]} (unverified link)</Fragment>;
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
export function ChatMarkdown({ content, sources }: { content: string; sources: readonly ChatSource[] }) {
  const blocks = content.slice(0, 16000).split(/\n\s*\n/);
  return <div className="chat-markdown">{blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={i}>{lines.map((line, j) => <li key={j}>{inline(line.slice(2), sources)}</li>)}</ul>;
    if (/^#{1,3} /.test(block)) return <h3 key={i}>{inline(block.replace(/^#{1,3} /, ''), sources)}</h3>;
    return <p key={i}>{lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line, sources)}</Fragment>)}</p>;
  })}</div>;
}
