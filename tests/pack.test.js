import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { isPackTitle } from '../parse.js';
import { extractPackToDir, cleanupDir } from '../pack.js';

test('isPackTitle flags multi-issue RANGES only — not plain collected editions', () => {
  // Ranges (multiple separate issues) → pack.
  for (const t of [
    'Saga Vol. 1 (#1-6) (2013)',
    'Batman #1 - 12',
    'Judge Dredd – 2000AD #1 – 2100 (Collection) (1977-2018)',
    'Harley Quinn and Poison Ivy #1 – 6 (2019-2020)',
  ]) assert.equal(isPackTitle(t), true, t);

  // Single collected editions (no range) and single issues → NOT packs. A year
  // range in the title must not count as an issue range.
  for (const t of [
    'X-Men TPB',
    'The Boys Omnibus Vol. 2',
    'Fables: The Deluxe Edition',
    'Harley Quinn and Poison Ivy (TPB) (2020)',
    'Poison Ivy #46 (2026)',
    'Batman (2016-2020) #45',   // year range, single issue
    '2000AD #2489 (2026)',
  ]) assert.equal(isPackTitle(t), false, t);
});

test('extractPackToDir writes each nested comic out of a pack ZIP', async () => {
  // A pack ZIP: two CBZ entries (each itself a tiny ZIP) + a junk file.
  const inner = await new JSZip().file('001.jpg', 'x').generateAsync({ type: 'nodebuffer' });
  const pack = new JSZip();
  pack.file('Saga 001 (2012).cbz', inner);
  pack.file('Saga 002 (2012).cbz', inner);
  pack.file('readme.txt', 'ignore me');
  const buf = await pack.generateAsync({ type: 'nodebuffer' });

  const { dir, count } = await extractPackToDir(buf, 'Saga Vol 1');
  try {
    assert.equal(count, 2);
    const files = (await fs.readdir(dir)).sort();
    assert.deepEqual(files, ['Saga 001 (2012).cbz', 'Saga 002 (2012).cbz']);
    // The extracted files are the real nested archives.
    assert.ok((await fs.stat(path.join(dir, files[0]))).size > 0);
  } finally { await cleanupDir(dir); }
});

test('extractPackToDir falls back to a single .cbz when the archive has no nested comics', async () => {
  // A single-issue archive: images directly, no nested .cbz.
  const single = await new JSZip().file('001.jpg', 'x').file('002.jpg', 'y').generateAsync({ type: 'nodebuffer' });
  const { dir, count } = await extractPackToDir(single, 'Weird: Post? Title');
  try {
    assert.equal(count, 1);
    const files = await fs.readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.cbz$/);
    assert.ok(!/[\\/:*?"<>|]/.test(files[0]), 'filename is sanitized');
  } finally { await cleanupDir(dir); }
});
