import { readFile } from 'node:fs/promises';
import { ImmutableSessionArtifactStore, SESSION_ARTIFACT_LIMIT, SessionArtifactError, type SessionArtifactRef } from './session-artifacts.js';

export type BlobArtifactOptions = {
  /** Existing private container URL, HTTPS, no query/SAS. */
  containerUrl: string;
  accessToken: () => Promise<string>;
  fetch?: typeof fetch;
};
/** Azure REST adapter; Entra tokens stay server-side and refresh on every request. */
export class AzureBlobSessionArtifactStore extends ImmutableSessionArtifactStore {
  private readonly url: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: BlobArtifactOptions, now?: () => Date) {
    super(now); this.url = new URL(options.containerUrl); this.fetcher = options.fetch ?? fetch;
    if (this.url.protocol !== 'https:' || this.url.search || this.url.hash || this.url.username || this.url.password || !/^[a-z0-9]+\.blob\.core\.windows\.net$/.test(this.url.hostname) || !/^\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(this.url.pathname)) throw new Error('Use an existing private Azure Blob container URL without SAS');
  }
  private async request(url: URL, init: RequestInit) {
    try { return await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${await this.options.accessToken()}`, 'x-ms-date': this.now().toUTCString(), 'x-ms-version': '2023-11-03', ...init.headers } }); }
    catch { throw new SessionArtifactError('unavailable'); }
  }
  private async privateContainer() {
    const url = new URL(this.url); url.search = '?restype=container';
    const response = await this.request(url, { method: 'HEAD' });
    if (!response.ok || response.headers.get('x-ms-blob-public-access')) throw new SessionArtifactError('unavailable');
  }
  private object(key: string) { const url = new URL(this.url); url.pathname += '/' + key; return url; }
  protected async put(key: string, bytes: Buffer, ref: SessionArtifactRef) {
    await this.privateContainer();
    const response = await this.request(this.object(key), { method: 'PUT', body: new Uint8Array(bytes), headers: {
      'x-ms-blob-type': 'BlockBlob', 'If-None-Match': '*', 'Content-Type': 'application/json', 'Content-Length': String(bytes.length),
      'x-ms-meta-format': '1', 'x-ms-meta-sdk': '0.3.276', 'x-ms-meta-sha256': ref.sha256, 'x-ms-meta-expires': ref.expiresAt
    } });
    if (response.status !== 201) throw new SessionArtifactError('unavailable');
  }
  protected async get(key: string) {
    await this.privateContainer();
    const response = await this.request(this.object(key), { method: 'GET' });
    if (response.status === 404) throw new SessionArtifactError('missing');
    if (!response.ok || Number(response.headers.get('content-length')) > SESSION_ARTIFACT_LIMIT) throw new SessionArtifactError('unavailable');
    const reader = response.body?.getReader(); if (!reader) throw new SessionArtifactError('corrupt');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > SESSION_ARTIFACT_LIMIT) throw new SessionArtifactError('corrupt'); chunks.push(next.value); } }
    finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  protected async remove(key: string) {
    await this.privateContainer();
    const response = await this.request(this.object(key), { method: 'DELETE' });
    if (![202, 404].includes(response.status)) throw new SessionArtifactError('unavailable');
  }
  protected async *keys(prefix: string) {
    await this.privateContainer(); let marker = '';
    do {
      const url = new URL(this.url); url.search = new URLSearchParams({ restype: 'container', comp: 'list', prefix, maxresults: '500', marker }).toString();
      const response = await this.request(url, { method: 'GET' });
      if (!response.ok) throw new SessionArtifactError('unavailable');
      const xml = await response.text();
      for (const match of xml.matchAll(/<Name>([^<]+)<\/Name>/g)) {
        // Our keys contain only these ASCII characters; reject any untrusted XML/path escape.
        if (!/^sessions\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/\d{13}-[a-f0-9-]{36}\.json$/.test(match[1]!) || !match[1]!.startsWith(prefix)) throw new SessionArtifactError('corrupt');
        yield match[1]!;
      }
      marker = /<NextMarker>([^<]*)<\/NextMarker>/.exec(xml)?.[1] ?? '';
      marker = marker.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    } while (marker);
  }
}

/** AKS workload identity federation. Token audience/scope follow the Azure Storage REST contract. */
export function workloadIdentityBlobToken(input: { tenantId: string; clientId: string; tokenFile: string; fetch?: typeof fetch }) {
  if (!/^[a-f0-9-]{36}$/i.test(input.tenantId) || !/^[a-f0-9-]{36}$/i.test(input.clientId)) throw new Error('Invalid workload identity');
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > Date.now() + 60000) return cached.token;
    const assertion = (await readFile(input.tokenFile, 'utf8')).trim();
    const response = await (input.fetch ?? fetch)(`https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: input.clientId, scope: 'https://storage.azure.com/.default', grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion })
    });
    if (!response.ok) throw new SessionArtifactError('unavailable');
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token || !Number.isFinite(Number(body.expires_in))) throw new SessionArtifactError('unavailable');
    cached = { token: body.access_token, until: Date.now() + Number(body.expires_in) * 1000 }; return cached.token;
  };
}
