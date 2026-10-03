import { describe, expect, it } from 'vitest';
import { newsText, sourceLink } from './news-content';
describe('untrusted news content', () => {
  it('rejects script, data, credentials, relative and malformed source URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'https://alice:password@example.com/', '//example.com', 'broken']) expect(sourceLink(url)).toBeNull();
    expect(sourceLink('https://example.com/article?a=1')).toBe('https://example.com/article?a=1');
  });
  it('keeps markup inert text and removes control bytes with a size bound', () => {
    expect(newsText('<img src=x onerror=alert(1)>\u0000')).toBe('<img src=x onerror=alert(1)>');
    expect(newsText('x'.repeat(30000))).toHaveLength(20000);
  });
});
