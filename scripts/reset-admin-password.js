#!/usr/bin/env node
require('dotenv').config();
const readline = require('readline');
const { setAdminPassword } = require('../src/web/auth');

if (!process.stdin.isTTY) {
  console.error('Jalankan script ini dari terminal interaktif.');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askHidden = (prompt) => new Promise((resolve) => {
  const original = rl._writeToOutput;
  rl._writeToOutput = function (text) {
    if (rl._muted && !String(text).includes(prompt)) return;
    original.call(rl, text);
  };
  rl._muted = true;
  rl.question(prompt, (answer) => {
    rl._muted = false;
    rl._writeToOutput = original;
    process.stdout.write('\n');
    resolve(answer);
  });
});

(async () => {
  try {
    const first = await askHidden('Password admin baru (min. 10 karakter): ');
    const second = await askHidden('Konfirmasi password baru: ');
    if (first !== second) throw new Error('Konfirmasi password tidak cocok');
    setAdminPassword(first, 10);
    console.log('Password admin berhasil direset. Semua sesi lama sudah dicabut.');
  } catch (error) {
    console.error(`Gagal: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
})();
