'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function entorno(t) {
  const base = process.platform === 'linux' ? '/tmp/opencode' : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'portal-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['portal.sh', '.env.example']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\n[ "$1" = info ] || exit 1\necho "{}"\n', { mode: 0o755 });
  const ejecutar = () => spawnSync('bash', [path.join(dir, 'portal.sh'), 'motor', 'docker'], {
    cwd: dir, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, OLLAMA_MODO: '' }, encoding: 'utf8'
  });
  return { dir, ejecutar };
}

test('lanzador prepara configuración privada sin mostrar la clave', { skip: process.platform === 'win32' }, t => {
  const { dir, ejecutar } = entorno(t);
  const r = ejecutar();
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(dir, '.env');
  const cfg = fs.readFileSync(file, 'utf8');
  const key = cfg.match(/^JWT_SECRET=([a-f0-9]{64})$/m)?.[1];
  assert.ok(key);
  assert.match(cfg, /^OLLAMA_MODO=docker$/m);
  assert.ok(!(r.stdout + r.stderr).includes(key));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('elegir motor conserva el secreto y otros valores existentes', { skip: process.platform === 'win32' }, t => {
  const { dir, ejecutar } = entorno(t);
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'JWT_SECRET=clave-original-de-prueba\nOTRO_VALOR=conservar\nOLLAMA_MODO=host\n');
  const r = ejecutar();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'JWT_SECRET=clave-original-de-prueba\nOTRO_VALOR=conservar\nOLLAMA_MODO=docker\n');
});
