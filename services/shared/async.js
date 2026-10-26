'use strict';
// Ejecuta `fn` sobre la lista con un máximo de tareas simultáneas.
// Se usa para refrescar fuentes y traducir sin abrir decenas de conexiones.
async function mapLimit(items, limite, fn) {
  const lista = Array.from(items || []);
  const max = Math.max(1, Math.min(Number(limite) || 1, lista.length || 1));
  const salida = new Array(lista.length);
  let indice = 0;

  async function obrero() {
    while (indice < lista.length) {
      const i = indice++;
      salida[i] = await fn(lista[i], i);
    }
  }

  await Promise.all(Array.from({ length: max }, obrero));
  return salida;
}

module.exports = { mapLimit };
