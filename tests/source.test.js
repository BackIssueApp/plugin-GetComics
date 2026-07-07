// Source selection logic (network-free). find()/fetch() are thin glue over
// parseSearchResults + pickBestPost + parseDownloadLinks (each tested here or in
// parse.test.js) and the shared HTTP layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestPost, getcomics, buildQuery } from '../source.js';
import { parseSearchResults } from '../parse.js';
import { SEARCH_HTML } from './fixtures.js';

test('buildQuery uses the bare issue number, not the zero-padded usenet token', () => {
  // GetComics search matches "Poison Ivy 46" but not "Poison Ivy 046".
  assert.equal(buildQuery('Poison Ivy', { issue_number: '46' }), 'Poison Ivy 46');
  assert.equal(buildQuery('Saga', { issue_number: '012' }), 'Saga 12');
  assert.equal(buildQuery('One-Shot', { issue_number: null }), 'One-Shot'); // no number → name only
});

const target = { series: 'Saga', names: ['Saga'], number: '12', year: '2013' };

test('pickBestPost picks the exact issue over a pack and an unrelated title', () => {
  const best = pickBestPost(parseSearchResults(SEARCH_HTML), target);
  assert.ok(best);
  // Saga #12 beats "Saga Vol. 1 (#1-6)" and "Paper Girls #12".
  assert.equal(best.url, 'https://getcomics.org/other-comics/saga-012-2013/');
});

test('pickBestPost returns null when nothing matches the series+number', () => {
  const rows = parseSearchResults(SEARCH_HTML);
  assert.equal(pickBestPost(rows, { series: 'Nonexistent', names: ['Nonexistent'], number: '99' }), null);
});

test('pickBestPost drops suspiciously small posts', () => {
  const rows = [{ title: 'Saga #12 (2013)', url: 'u', size: 1 }]; // 1 byte → fake-release guard
  assert.equal(pickBestPost(rows, target), null);
});

test('the source is an immediate, toggle-gated adapter', () => {
  assert.equal(getcomics.id, 'getcomics');
  assert.equal(getcomics.kind, 'immediate');
  assert.equal(getcomics.isEnabled({ getcomicsEnabled: true }), true);
  assert.equal(getcomics.isEnabled({}), false); // defaults off
  assert.equal(typeof getcomics.find, 'function');
  assert.equal(typeof getcomics.fetch, 'function');
});
