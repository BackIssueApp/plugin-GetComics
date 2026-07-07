import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchResults, parseDownloadLinks, pixeldrainDirectUrl,
  sniffBuffer, extractYear, extractSizeBytes,
} from '../parse.js';
import { SEARCH_HTML, POST_HTML } from './fixtures.js';

test('parseSearchResults pulls title/url/cover/year/size from article cards', () => {
  const rows = parseSearchResults(SEARCH_HTML);
  assert.equal(rows.length, 3);
  const saga = rows[0];
  assert.equal(saga.title, 'Saga #12 (2013)');
  assert.equal(saga.url, 'https://getcomics.org/other-comics/saga-012-2013/');
  assert.equal(saga.cover, 'https://i0.wp.com/getcomics.org/uploads/saga-012.jpg');
  assert.equal(saga.year, '2013');
  assert.equal(saga.size, 38_000_000);
});

test('parseSearchResults ignores category links as titles', () => {
  // "Image Comics" is a /cat/ link and must not become a result.
  const titles = parseSearchResults(SEARCH_HTML).map((r) => r.title);
  assert.ok(!titles.includes('Image Comics'));
});

test('parseDownloadLinks classifies all hosts, supported first, by label', () => {
  const links = parseDownloadLinks(POST_HTML);
  // main + pixeldrain first (supported), then mega/mediafire (recognized).
  assert.deepEqual(links.map((l) => l.host), ['main', 'pixeldrain', 'mega', 'mediafire']);
  assert.equal(links[0].url, 'https://getcomics.org/dlds/12345/');
  assert.ok(!links.some((l) => /#reader/.test(l.url))); // read-online is not a download
});

test('a /dls/ link is classified by its LABEL, not its URL path (the real-world bug)', () => {
  // GetComics wraps MEGA/Mediafire behind getcomics.org/dls/ too — the label is
  // the only signal. These must NOT be mistaken for the direct "main" server.
  const html = `<article><div class="post-contents">
    <a href="https://getcomics.org/dls/AAA/">Mega Link</a>
    <a href="https://getcomics.org/dls/BBB/">Mediafire Link</a>
  </div></article>`;
  const links = parseDownloadLinks(html);
  assert.deepEqual(links.map((l) => l.host).sort(), ['mediafire', 'mega']);
  assert.ok(!links.some((l) => l.host === 'main'), 'a /dls/ "Mega Link" is NOT main');
});

test('SUPPORTED_HOSTS excludes mega/mediafire', async () => {
  const { SUPPORTED_HOSTS } = await import('../parse.js');
  assert.ok(SUPPORTED_HOSTS.has('main') && SUPPORTED_HOSTS.has('pixeldrain'));
  assert.ok(!SUPPORTED_HOSTS.has('mega') && !SUPPORTED_HOSTS.has('mediafire'));
});

test('pixeldrainDirectUrl maps a share link to the API file url', () => {
  assert.equal(pixeldrainDirectUrl('https://pixeldrain.com/u/abc123XY'),
    'https://pixeldrain.com/api/file/abc123XY?download');
  // A non-share url passes through.
  assert.equal(pixeldrainDirectUrl('https://example.com/x.cbz'), 'https://example.com/x.cbz');
});

test('sniffBuffer identifies zip/rar/pdf by magic bytes', () => {
  assert.equal(sniffBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'cbz');
  assert.equal(sniffBuffer(Buffer.from('Rar!\x1a\x07\x00')), 'cbr');
  assert.equal(sniffBuffer(Buffer.from('%PDF-1.7')), 'pdf');
  assert.equal(sniffBuffer(Buffer.from('nope')), null);
  assert.equal(sniffBuffer(Buffer.alloc(2)), null);
});

test('size + year extraction handle units and absence', () => {
  assert.equal(extractSizeBytes('Size : 1.2 GB'), 1_200_000_000);
  assert.equal(extractSizeBytes('Size: 500 KB'), 500_000);
  assert.equal(extractSizeBytes('no size here'), 0);
  assert.equal(extractYear('Year : 1984'), '1984');
  assert.equal(extractYear('The Thing (2011) whatever'), '2011');
  assert.equal(extractYear('no year'), null);
});
