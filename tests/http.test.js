// downloadToBuffer streams to a Buffer and reports byte progress. Uses a local
// HTTP server so the undici path (incl. the redirect dispatcher) is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
// The SSRF guard blocks localhost/private targets; these tests use a local
// mock server, so opt into the internal-address test hook.
process.env.GETCOMICS_ALLOW_INTERNAL = '1';
import { downloadToBuffer } from '../http.js';

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('downloadToBuffer collects the body and reports increasing byte progress', async () => {
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KB
  const { server, port } = await serve((req, res) => {
    res.setHeader('content-length', String(payload.length));
    res.setHeader('content-disposition', 'attachment; filename="Comic 001.cbz"');
    // Write in chunks so progress fires more than once.
    let off = 0;
    const step = () => {
      if (off >= payload.length) return res.end();
      res.write(payload.subarray(off, off + 32 * 1024));
      off += 32 * 1024;
      setTimeout(step, 5);
    };
    step();
  });
  try {
    const seen = [];
    const { buffer, filename } = await downloadToBuffer(`http://localhost:${port}/x.cbz`, {
      onProgress: (p) => seen.push(p),
    });
    assert.equal(buffer.length, payload.length);
    assert.equal(filename, 'Comic 001.cbz');
    assert.ok(seen.length >= 1, 'progress fired');
    const last = seen[seen.length - 1];
    assert.equal(last.done, payload.length);
    assert.equal(last.total, payload.length);
    // done never decreases
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].done >= seen[i - 1].done);
  } finally {
    server.close();
  }
});

test('downloadToBuffer enforces the size cap', async () => {
  const { server, port } = await serve((req, res) => { res.end(Buffer.alloc(4096)); });
  try {
    await assert.rejects(
      downloadToBuffer(`http://localhost:${port}/big`, { maxBytes: 1024 }),
      /size cap/,
    );
  } finally {
    server.close();
  }
});

test('SSRF guard: internal addresses are refused without the test hook', async () => {
  const prev = process.env.GETCOMICS_ALLOW_INTERNAL;
  delete process.env.GETCOMICS_ALLOW_INTERNAL;
  try {
    for (const url of ['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'file:///etc/passwd']) {
      await assert.rejects(() => downloadToBuffer(url), /refusing|invalid|non-http/, `blocks ${url}`);
    }
  } finally { if (prev !== undefined) process.env.GETCOMICS_ALLOW_INTERNAL = prev; }
});
