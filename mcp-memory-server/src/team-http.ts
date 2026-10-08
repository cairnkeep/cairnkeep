import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { normalizeHostAuthority } from './http-security.js';
import { TeamError, TeamStore, teamDigest } from './team-store.js';

const MAX_BODY = 512 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
function reply(response: ServerResponse, status: number, body: unknown): void {
    const bytes = Buffer.from(JSON.stringify(body));
    if (bytes.byteLength > MAX_RESPONSE) { reply(response, 503, { error: 'unavailable' }); return; }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': bytes.byteLength, ...(status >= 400 ? { Connection: 'close' } : {}) });
    response.end(bytes);
}
async function body(request: IncomingMessage): Promise<unknown> {
    if (request.headers['content-type'] !== 'application/json') throw new TeamError('invalid');
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
        let size = 0;
        const cleanup = () => { request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onError); };
        const onError = () => { cleanup(); reject(new TeamError('invalid')); };
        const onEnd = () => { cleanup(); resolve(); };
        const onData = (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > MAX_BODY) { cleanup(); request.pause(); reject(new RangeError('body-limit')); }
            else chunks.push(chunk);
        };
        request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onError);
    });
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new TeamError('invalid'); }
}

/** This is a token-first JSON API, not OAuth-authorized remote MCP. It only
 * listens on loopback; use an authenticated encrypted tunnel for remote use. */
export function createTeamHttpServer(store: TeamStore) {
    if (process.env.CAIRN_TEAM !== '1' || process.env.CAIRN_TEAM_HTTP !== '1') throw new TeamError('disabled');
    const limits = new Map<string, { start: number; count: number }>();
    const admitted = (key: string): boolean => {
        const now = Date.now();
        for (const [id, state] of limits) if (now - state.start >= 60000) limits.delete(id);
        let state = limits.get(key);
        if (!state) {
            if (limits.size >= 512) return false;
            limits.set(key, state = { start: now, count: 0 });
        }
        return ++state.count <= 120;
    };
    const server = createServer({ maxHeaderSize: 32 * 1024 }, (request, response) => {
        void (async () => {
            // Reject browser access and host rebinding before reading any body.
            const authority = normalizeHostAuthority(request.headers.host);
            const port = request.socket.localPort;
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.localAddress ?? '') || !authority || ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(authority) || request.headers.origin !== undefined) { reply(response, 403, { error: 'denied' }); return; }
            if (request.url !== '/v1/team/execute') { reply(response, 404, { error: 'not-found' }); return; }
            if (request.method !== 'POST') { reply(response, 405, { error: 'method' }); return; }
            const authHeaders = request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === 'authorization');
            const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
            if (!admitted(teamDigest(`connection:${request.socket.remoteAddress ?? ''}`))) { reply(response, 429, { error: 'rate-limit' }); return; }
            if (!token || authHeaders.length !== 1) { reply(response, 401, { error: 'unauthorized' }); return; }
            const identity = await store.checkCredential(token);
            if (!admitted(teamDigest(identity.subject))) { reply(response, 429, { error: 'rate-limit' }); return; }
            const length = request.headers['content-length'];
            if (length && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY)) { reply(response, 413, { error: 'body-limit' }); return; }
            request.setTimeout(10000, () => request.destroy());
            const input = await body(request);
            const result = await store.execute(token, input); // reauthorize after body receipt
            reply(response, 200, { result });
        })().catch(error => {
            const status = error instanceof TeamError ? ({ unauthorized: 401, denied: 403, invalid: 400, conflict: 409, disabled: 503, integrity: 503 }[error.code]) : error instanceof RangeError ? 413 : 503;
            if (!response.headersSent && !response.destroyed) reply(response, status, { error: error instanceof TeamError ? error.code : status === 413 ? 'body-limit' : 'unavailable' });
        });
    });
    server.headersTimeout = 10000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
    server.maxRequestsPerSocket = 100;
    server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
    return server;
}

export function validateTeamUrl(raw: string): URL {
    let url: URL;
    try { url = new URL(raw); } catch { throw new TeamError('invalid'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new TeamError('invalid');
    return url;
}
export async function teamRequest(rawUrl: string, token: string, input: unknown): Promise<unknown> {
    if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
    const url = validateTeamUrl(rawUrl);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TeamError('unauthorized');
    const bytes = JSON.stringify(input);
    if (Buffer.byteLength(bytes) > MAX_BODY) throw new TeamError('invalid');
    try {
        const response = await fetch(new URL('/v1/team/execute', url), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: bytes });
        const errorCode = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'denied' : response.status === 409 ? 'conflict' : response.status === 400 ? 'invalid' : 'integrity';
        if (!response.ok) { await response.body?.cancel(); throw new TeamError(errorCode); }
        const chunks: Uint8Array[] = []; let size = 0;
        if (!response.body) throw new TeamError('integrity');
        const reader = response.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                size += value.byteLength;
                if (size > MAX_RESPONSE) throw new TeamError('integrity');
                chunks.push(value);
            }
        } finally { await reader.cancel().catch(() => undefined); }
        const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'result')) throw new TeamError('integrity');
        return parsed.result;
    } catch (error) { if (error instanceof TeamError) throw error; throw new TeamError('integrity'); }
}
