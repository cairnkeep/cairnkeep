import assert from 'node:assert/strict';
import { validateCodeqlCohort } from './verify-security-baseline.mjs';

const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const workflows = [
  { jobs: { scan: { steps: [{ uses: `github/codeql-action/init@${sha}` }, { uses: `github/codeql-action/analyze@${sha}` }] } } },
  { jobs: { score: { steps: [{ uses: `github/codeql-action/upload-sarif@${sha}` }] } } },
];
const dependabot = { version: 2, updates: [{ 'package-ecosystem': 'github-actions', directory: '/', groups: { 'codeql-action': { patterns: ['github/codeql-action/*'] } } }] };
validateCodeqlCohort(workflows, dependabot);
assert.throws(() => validateCodeqlCohort([], dependabot), /cohort/);
assert.throws(() => validateCodeqlCohort(workflows.slice(0, 1), dependabot), /missing upload-sarif/);
assert.throws(() => validateCodeqlCohort(workflows, {}), /group/);
const duplicateUpdates = structuredClone(dependabot);
duplicateUpdates.updates.push(structuredClone(dependabot.updates[0]));
assert.throws(() => validateCodeqlCohort(workflows, duplicateUpdates), /group/);
for (let index = 0; index < 3; index++) {
  const changed = structuredClone(workflows);
  const target = index < 2 ? changed[0].jobs.scan.steps[index] : changed[1].jobs.score.steps[0];
  target.uses = target.uses.replace(sha, other);
  assert.throws(() => validateCodeqlCohort(changed, dependabot), /same.*commit|cohort/);
}
const unpinned = structuredClone(workflows);
unpinned[0].jobs.scan.steps[0].uses = 'github/codeql-action/init@v4';
assert.throws(() => validateCodeqlCohort(unpinned, dependabot), /pinned|commit/);
for (const mutate of [
  value => { delete value.updates[0].groups; },
  value => { value.updates[0].groups['codeql-action'].patterns = ['github/codeql-action/init']; },
  value => { value.updates[0].groups['codeql-action']['exclude-patterns'] = ['github/codeql-action/analyze']; },
  value => { value.updates[0].groups['codeql-action']['update-types'] = ['patch']; },
]) {
  const changed = structuredClone(dependabot); mutate(changed);
  assert.throws(() => validateCodeqlCohort(workflows, changed), /group|cohort/);
}
console.log('PASS: CodeQL same-commit cohort and grouped dependency-update mutation controls');
