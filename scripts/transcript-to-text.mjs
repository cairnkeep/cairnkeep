#!/usr/bin/env node
// transcript-to-text.mjs — read a Claude/OpenCode JSONL transcript and emit a
// readable plain-text stream of the conversation (user + assistant text only,
// tool calls/results trimmed). Piped into `mcp-memory-server extract` so the
// extraction model sees what actually happened in the session.
//
// Usage: node transcript-to-text.mjs <transcript.jsonl> [max-chars]
//   max-chars defaults to 12000; keeps the most recent turns when truncating.
'use strict';
import { readFileSync } from 'node:fs';

const [, , transcriptPath, maxCharsArg] = process.argv;
const maxChars = parseInt(maxCharsArg ?? '12000', 10);

if (!transcriptPath) {
  process.stderr.write('transcript-to-text: no transcript path given\n');
  process.exit(0);
}

let raw;
try {
  raw = readFileSync(transcriptPath, 'utf8');
} catch {
  process.exit(0);
}

const lines = raw.split('\n').filter(Boolean);
const turns = [];
for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  const role = obj.type || obj.role || obj.message?.role;
  // Extract text content from common transcript shapes.
  let text = '';
  const content = obj.message?.content ?? obj.content;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b) => typeof b === 'object' && b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text ?? '')
      .join('\n');
  }
  text = text.trim();
  if (!text) continue;
  // Skip pure tool-result noise and system reminders.
  if (role === 'user' || role === 'human') turns.push(`USER: ${text}`);
  else if (role === 'assistant' || role === 'ai') turns.push(`ASSISTANT: ${text}`);
}

let out = turns.join('\n\n');
if (out.length > maxChars) out = out.slice(-maxChars);
process.stdout.write(out);
