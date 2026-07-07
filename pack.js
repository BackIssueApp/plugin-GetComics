// Extract a downloaded GetComics pack archive into a temp directory of comic
// files, ready for core's processPack (which imports each missing issue). A
// GetComics pack is typically a ZIP of CBZ/CBR files; occasionally a post tagged
// as a pack is really one comic (a ZIP of images) — handled as a single file.
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMIC_EXT } from '../../src/sources/usenet.js';

export async function extractPackToDir(buffer, label = 'pack') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcpack-'));
  let zip = null;
  try { zip = await JSZip.loadAsync(buffer); } catch { zip = null; }
  const nested = zip
    ? Object.values(zip.files).filter((f) => !f.dir && COMIC_EXT.has(path.extname(f.name).toLowerCase()))
    : [];
  if (nested.length) {
    // A real pack: write each nested comic out for processPack to walk.
    for (const e of nested) {
      const name = path.basename(e.name);
      await fs.writeFile(path.join(dir, name), await e.async('nodebuffer'));
    }
    return { dir, count: nested.length };
  }
  // Not a nested pack (single comic, or a non-ZIP archive) — write the archive
  // itself as one .cbz so processPack still tries to match+import it.
  const safe = String(label).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'comic';
  await fs.writeFile(path.join(dir, safe + '.cbz'), buffer);
  return { dir, count: 1 };
}

export async function cleanupDir(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
