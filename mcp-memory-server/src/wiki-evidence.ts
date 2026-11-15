import { z } from 'zod';
import { posix } from 'node:path';
import { canonicalLocalProject, localDigest, localFileReader, localRelative, localText, publishLocalRecord, readLocalRecord, sealLocal, verifyLocal } from './local-context-record.js';

const source = z.object({ path: localRelative, quotes: z.array(localText(4096)).max(8) }).strict();
const page = z.object({ path: localRelative, sources: z.array(source).min(1).max(8), links: z.array(localRelative).max(32) }).strict();
export const wikiEvidenceInputSchema = z.object({ schema_version: z.literal(1), pages: z.array(page).min(1).max(64) }).strict();
const boundPage = page.extend({ digest: localDigest, sources: z.array(source.extend({ digest: localDigest })).min(1).max(8) });
const recordSchema = z.object({ schema_version: z.literal(1), kind: z.literal('wiki-evidence'), project_root: z.string(), pages: z.array(boundPage).min(1).max(64), digest: localDigest }).strict();
type WikiEvidence = z.infer<typeof recordSchema>;

function pageLinks(text: string, path: string): string[] {
    const links: string[] = [];
    // Relative Markdown-page links and wiki links only. No URL fetching, vault
    // basename guessing, HTML interpretation or code-fence examples.
    const prose = text.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
    for (const match of prose.matchAll(/(!?\[[^\]\n]{0,512}\]\(([^)\n]{1,512})\))|\[\[([^\]\n]{1,512})\]\]/g)) {
        if (match[1]?.startsWith('!')) continue;
        let target = (match[3] ?? match[2]).split('|')[0].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
        target = decodeURIComponent(target);
        if (match[3] && !posix.extname(target)) target += '.md';
        if (!target.endsWith('.md')) continue;
        if (target.startsWith('/') || target.includes('\\')) throw new Error('Unsafe wiki link.');
        links.push(localRelative.parse(posix.normalize(posix.join(posix.dirname(path), target))));
        if (links.length > 32) throw new Error('Wiki link limit exceeded.');
    }
    return links;
}

export function planWikiEvidence(project: string, input: unknown): WikiEvidence {
    const root = canonicalLocalProject(project), manifest = wikiEvidenceInputSchema.parse(input), read = localFileReader(root);
    if (new Set(manifest.pages.map(p => p.path)).size !== manifest.pages.length) throw new Error('Duplicate wiki page.');
    const pages = manifest.pages.map(p => {
        const contents = read(p.path);
        const links = [...new Set([...p.links, ...pageLinks(contents.text, p.path)])].sort();
        if (links.length > 32) throw new Error('Wiki link limit exceeded.');
        const bound = { ...p, links, digest: contents.digest, sources: p.sources.map(s => {
            const file = read(s.path);
            if (s.quotes.some(q => !file.text.includes(q))) throw new Error('Evidence quote missing from selected source.');
            return { ...s, digest: file.digest };
        }) };
        for (const link of links) read(link);
        return bound;
    });
    return recordSchema.parse(sealLocal({ schema_version: 1, kind: 'wiki-evidence', project_root: root, pages }));
}

export function publishWikiEvidence(project: string, input: unknown, confirm: string): WikiEvidence {
    const root = canonicalLocalProject(project), record = verifyLocal(recordSchema.parse(input));
    if (record.digest !== confirm) throw new Error('Exact evidence plan confirmation required.');
    if (record.project_root !== root) throw new Error('Evidence plan belongs to a different project.');
    let fresh: WikiEvidence;
    try { fresh = planWikiEvidence(root, { schema_version: 1, pages: record.pages.map(({ digest: _digest, sources, ...p }) => ({ ...p, sources: sources.map(({ digest: _sourceDigest, ...s }) => s) })) }); }
    catch { throw new Error('Evidence plan changed or is stale.'); }
    if (fresh.digest !== record.digest) throw new Error('Evidence plan changed or is stale.');
    publishLocalRecord(root, 'wiki-evidence', record); return record;
}

export function checkWikiEvidence(project: string, digest: string) {
    const root = canonicalLocalProject(project), record = verifyLocal(recordSchema.parse(readLocalRecord(root, 'wiki-evidence', digest)));
    if (record.project_root !== root) throw new Error('Evidence belongs to a different project.');
    const read = localFileReader(root), findings: { page: string; path: string; code: string }[] = [];
    const inspect = (pagePath: string, path: string, expected?: string, quotes: string[] = []) => {
        try {
            const current = read(path);
            if (expected && current.digest !== expected) findings.push({ page: pagePath, path, code: path === pagePath ? 'page_changed' : 'source_changed' });
            if (quotes.some(q => !current.text.includes(q))) findings.push({ page: pagePath, path, code: 'quote_missing' });
        } catch { findings.push({ page: pagePath, path, code: 'missing_or_unsafe' }); }
    };
    for (const p of record.pages) {
        inspect(p.path, p.path, p.digest);
        for (const s of p.sources) inspect(p.path, s.path, s.digest, s.quotes);
        for (const link of p.links) inspect(p.path, link);
    }
    return { schema_version: 1, digest, ok: findings.length === 0, checked_pages: record.pages.length,
        affected_pages: [...new Set(findings.map(f => f.page))], findings, semantic_truth_checked: false };
}
