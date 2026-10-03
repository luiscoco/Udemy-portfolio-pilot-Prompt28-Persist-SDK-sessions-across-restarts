import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown, evidenceLink } from './chat-markdown';
const sources = [{ articleId: 'a', title: 'Article', url: 'https://example.invalid/a', publishedAt: '2026-10-02T12:00:00.000Z', isSynthetic: true }];
it('escapes HTML and refuses images, credential URLs, and model-invented links', () => {
  const html = renderToStaticMarkup(<ChatMarkdown sources={sources} content={'<script>alert(1)</script>\n\n**Facts** [a](https://example.invalid/a) [evil](javascript:alert) [invented](https://evil.invalid/) ![x](https://evil.invalid/a.png)'} />);
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('<strong>Facts</strong>');
  expect(html).toContain('href="https://example.invalid/a"'); expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('href="https://evil');
  expect(evidenceLink('https://user:password@example.invalid/a', sources)).toBeNull();
});
