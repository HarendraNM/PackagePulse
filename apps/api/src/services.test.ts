import test from 'node:test';
import assert from 'node:assert/strict';
import { healthScore, packageNameSchema, repoUrl } from './services.js';

test('accepts normal and scoped npm names while rejecting malformed names', () => {
  assert.equal(packageNameSchema.safeParse('react').success, true);
  assert.equal(packageNameSchema.safeParse('@types/node').success, true);
  assert.equal(packageNameSchema.safeParse('bad name').success, false);
  assert.equal(packageNameSchema.safeParse('../secret').success, false);
});

test('normalizes GitHub repository URLs and ignores other hosts', () => {
  assert.equal(repoUrl({ url: 'git+https://github.com/facebook/react.git' }), 'https://github.com/facebook/react');
  assert.equal(repoUrl({ url: 'https://gitlab.com/group/project.git' }), undefined);
  assert.equal(repoUrl(undefined), undefined);
});

test('health score reports missing repository signals and renormalizes known weights', () => {
  const score = healthScore({ description: 'package', license: 'MIT', repository: undefined, homepage: undefined, time: { '1.2.3': '2026-11-01T00:00:00.000Z' }, 'dist-tags': { latest: '1.2.3' } }, null);
  assert.equal(score.complete, false);
  assert.equal(score.signals.find(signal => signal.id === 'maintenance')?.score, null);
  assert.equal(score.score, 81);
  assert.match(score.explanation, /not a security assessment/);
});
