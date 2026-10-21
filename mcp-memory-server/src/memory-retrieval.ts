/** Read-only ranking over already scope-filtered, live memory records. */
export type RetrievalEntry = { scope: string; key: string; value: string; node_type?: string; tags?: string[] };
export type HybridOptions<T extends RetrievalEntry> = {
    topK: number;
    minScore: number;
    aliases?: string[];
    explain?: boolean;
    semanticScores?: Map<T, number>;
    embeddingStatus?: 'unconfigured' | 'not_used' | 'available' | 'failed';
};
const STOP = new Set('a an and are as at be by can do does for from how i in is it me my of on or our please that the their this to use we what when where which with would you your un una uno il lo la gli le di da del della e che con come per posso mio mia sul nel dei'.split(' '));
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
const compare = (left: Pick<RetrievalEntry, 'scope' | 'key'>, right: Pick<RetrievalEntry, 'scope' | 'key'>) => left.scope.localeCompare(right.scope, 'en') || left.key.localeCompare(right.key, 'en');
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;

export function retrievalTerms(text: string): string[] {
    const result: string[] = [];
    for (const match of normalize(text).matchAll(/[\p{L}\p{N}]+/gu)) {
        if (match[0].length > 1 && !STOP.has(match[0])) result.push(match[0]);
        if (result.length === 4096) break;
    }
    return result;
}
function identifiers(text: string): Set<string> {
    // Match ordinary words too, then select identifiers. Requiring a separator
    // in an unanchored greedy expression repeatedly rescans long plain words.
    const result = new Set<string>();
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[._:/-][\p{L}\p{N}]+)*/gu)) {
        if (/[._:/\d-]/u.test(match[0])) result.add(match[0]);
    }
    return result;
}
function variant(text: string) {
    const normalized = normalize(text).trim();
    return { normalized, terms: [...new Set(retrievalTerms(text))].slice(0, 64), identifiers: identifiers(normalized) };
}

/** BM25 is also used by the transparent Markdown-folder baseline. */
export function lexicalMemoryScores<T extends RetrievalEntry>(entries: T[], query: string): number[] {
    const queryTerms = [...new Set(retrievalTerms(query))].slice(0, 64);
    const docs = entries.map(entry => [
        ...retrievalTerms(entry.key), ...retrievalTerms(entry.key),
        ...retrievalTerms(entry.value), ...retrievalTerms([entry.node_type, ...(entry.tags ?? [])].filter(Boolean).join(' ')),
    ]);
    const frequencies = docs.map(terms => {
        const counts = new Map<string, number>();
        for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
        return counts;
    });
    const averageLength = docs.reduce((total, terms) => total + terms.length, 0) / Math.max(1, docs.length) || 1;
    const documentFrequencies = new Map(queryTerms.map(term => [term, frequencies.filter(counts => counts.has(term)).length]));
    return docs.map((terms, index) => queryTerms.reduce((score, term) => {
        const frequency = frequencies[index].get(term) ?? 0;
        const df = documentFrequencies.get(term) ?? 0;
        const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5));
        return score + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * terms.length / averageLength));
    }, 0));
}

export function rankHybridMemory<T extends RetrievalEntry>(entries: T[], query: string, options: HybridOptions<T>) {
    const aliases = options.aliases ?? [];
    if (Buffer.byteLength(query, 'utf8') > 4096 || !query.trim() || aliases.length > 8
        || aliases.some(alias => !alias.trim() || Buffer.byteLength(alias, 'utf8') > 256)
        || !Number.isInteger(options.topK) || options.topK < 1 || options.topK > 50
        || !Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 1) {
        throw new Error('Hybrid memory search requires bounded query, aliases, result count and similarity threshold.');
    }
    const variants = [...new Set([query, ...aliases].map(text => normalize(text).trim()))].map(variant);
    const lexicalScores = variants.map(item => lexicalMemoryScores(entries, item.normalized));
    const candidates = entries.map((entry, index) => {
        const text = normalize([entry.key, entry.value, entry.node_type, ...(entry.tags ?? [])].filter(Boolean).join('\n'));
        const words = new Set(retrievalTerms(text));
        const entryIdentifiers = identifiers(text);
        const matches = variants.map((item, v) => {
            const matched = item.terms.filter(term => words.has(term));
            const coverage = item.terms.length ? matched.length / item.terms.length : 0;
            const identifierMatch = [...item.identifiers].every(id => entryIdentifiers.has(id));
            const exactKey = normalize(entry.key) === item.normalized;
            return {
                matched, coverage, identifierMatch, exactKey,
                eligible: identifierMatch && (exactKey || (coverage >= 0.6 && matched.length >= Math.min(2, item.terms.length) && matched.length > 0)),
                lexical: lexicalScores[v][index],
            };
        });
        const best = matches.filter(match => match.eligible).sort((a, b) => Number(b.exactKey) - Number(a.exactKey) || b.lexical - a.lexical)[0];
        const rawSemantic = options.semanticScores?.get(entry);
        const semantic = typeof rawSemantic === 'number' && Number.isFinite(rawSemantic) && rawSemantic >= -1 && rawSemantic <= 1 ? rawSemantic : null;
        const semanticAdmission = options.minScore > 0 && semantic !== null && semantic >= options.minScore && matches.some(match => match.identifierMatch);
        const lexical = best?.lexical ?? 0;
        const score = 0.8 * lexical / (1 + lexical) + 0.2 * Math.max(0, semantic ?? 0);
        return { entry, best, semantic, semanticAdmission, score };
    }).filter(item => item.best || item.semanticAdmission)
        .sort((a, b) => Number(Boolean(b.best?.exactKey)) - Number(Boolean(a.best?.exactKey)) || b.score - a.score || compare(a.entry, b.entry));

    const grouped = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
        const key = JSON.stringify([candidate.entry.key, candidate.entry.value]);
        const group = grouped.get(key) ?? [];
        group.push(candidate); grouped.set(key, group);
    }
    const results = [...grouped.values()].slice(0, options.topK).map(group => {
        const item = group[0];
        const reasons = [
            ...(item.best?.exactKey ? ['exact-key'] : []),
            ...(item.best ? ['lexical-coverage'] : []),
            ...(item.semanticAdmission ? ['semantic-threshold'] : []),
            ...(group.length > 1 ? ['identical-records-collapsed'] : []),
        ];
        return {
            ...item.entry, score: rounded(item.score),
            ...(options.explain ? { match: {
                reasons, matched_terms: item.best?.matched ?? [], lexical_coverage: rounded(item.best?.coverage ?? 0),
                semantic_score: item.semantic === null ? null : rounded(item.semantic),
                sources: group.map(({ entry }) => ({ scope: entry.scope, key: entry.key })).sort(compare),
            } } : {}),
        };
    });
    const conflicts = [...new Set(results.map(item => item.key))].flatMap(key => {
        const relevant = candidates.filter(item => item.entry.key === key);
        return new Set(relevant.map(item => item.entry.value)).size > 1
            ? [{ key, scopes: [...new Set(relevant.map(item => item.entry.scope))].sort() }] : [];
    });
    return {
        results,
        retrieval: {
            strategy: 'hybrid' as const,
            score_kind: 'ranking-not-confidence' as const,
            embedding_status: options.embeddingStatus ?? (options.semanticScores ? 'available' : 'unconfigured'),
            semantic_min_score: options.minScore > 0 ? options.minScore : null,
            alias_count: aliases.length,
            candidates: entries.length,
            admitted: grouped.size,
            ...(results.length === 0 ? { empty_reason: entries.length ? 'no_relevant_memory' : 'empty_scope' } : {}),
            ...(options.explain ? { possible_conflicts: conflicts } : {}),
        },
    };
}
