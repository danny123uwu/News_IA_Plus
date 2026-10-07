const { spawn } = require('child_process');
const path = require('path');

const servicios = [
  ['auth', path.join(__dirname, 'services', 'auth', 'index.js')],
  ['feeds', path.join(__dirname, 'services', 'feeds', 'index.js')],
  ['agente', path.join(__dirname, 'services', 'agent', 'index.js')],
  ['web', path.join(__dirname, 'web', 'index.js')]
];

for (const [nombre, archivo] of servicios) {
  const p = spawn(process.execPath, [archivo], { env: process.env });
  p.stdout.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, `[${nombre}] `)));
  p.stderr.on('data', (d) => process.stderr.write(String(d).replace(/^/gm, `[${nombre}] `)));
  p.on('exit', (c) => console.log(`[${nombre}] terminado (${c})`));
}

console.log('\n=== Portal IA News ===');
console.log('Abrir: http://localhost:8090');
console.log('Servicios: auth :3001 | feeds :3002 | agente :3003 | web :8090');
console.log('Ctrl+C para apagar todo\n');
