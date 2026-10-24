// Exit codes are a value-free doctor protocol: 0 disabled/healthy,
// 2 invalid opt-in configuration, 3 unavailable or invalid ranking response.
import { getMemoryRerankerConfig, rerankMemoryResults } from '../mcp-memory-server/dist/memory-reranker.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function probeMemoryReranker() {
  if (process.env.CAIRN_MEMORY_RERANK !== '1') return 0;
  const config = getMemoryRerankerConfig();
  if (!config) return 2;
  const result = await rerankMemoryResults([
    { key: 'health/policy', value: 'Corrections append a new release ledger entry.' },
    { key: 'health/theme', value: 'The release ledger interface uses a dark theme.' },
  ], 'How are release ledger corrections recorded?', 2, config);
  return result.status === 'reranked' ? 0 : 3;
}

let invokedDirectly = false;
try { invokedDirectly = Boolean(process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)); } catch {}
if (invokedDirectly) {
  process.exitCode = await probeMemoryReranker();
}
