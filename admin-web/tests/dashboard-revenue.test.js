import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, '..');

test('kartu omzet menampilkan bulan ini dan all time dalam dua baris ringkas', () => {
  const tempDir = fs.mkdtempSync(path.join(adminRoot, '.dashboard-revenue-'));

  try {
    const probe = path.join(tempDir, 'probe.jsx');
    const output = path.join(tempDir, 'probe.cjs');
    const dashboardPath = path.join(adminRoot, 'src/pages/Dashboard.jsx');

    fs.writeFileSync(probe, `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { RevenueBreakdown } from ${JSON.stringify(dashboardPath)};

      process.stdout.write(renderToStaticMarkup(
        <RevenueBreakdown month={1250000} allTime={56732990} />
      ));
    `);

    const build = spawnSync(path.join(adminRoot, 'node_modules/.bin/esbuild'), [
      probe,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--loader:.jsx=jsx',
      '--jsx=automatic',
      '--packages=external',
      `--outfile=${output}`
    ], { cwd: adminRoot, encoding: 'utf8' });

    assert.equal(build.status, 0, build.stderr || build.stdout);

    const render = spawnSync(process.execPath, [output], {
      cwd: adminRoot,
      encoding: 'utf8'
    });
    assert.equal(render.status, 0, render.stderr || render.stdout);

    const html = render.stdout;
    assert.match(html, /class="stat-breakdown"/);
    assert.match(html, /Bulan ini/);
    assert.match(html, /Rp 1\.250\.000/);
    assert.match(html, /All time/);
    assert.match(html, /Rp 56\.732\.990/);
    assert.equal((html.match(/class="stat-breakdown-row"/g) || []).length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
