'use strict';
// Validaciones puras (sin Express ni base de datos) para poder probarlas.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizarEmail(v) {
  const e = String(v == null ? '' : v).slice(0, 254).toLowerCase().trim();
  return EMAIL.test(e) ? e : '';
}

function nombreValido(v) {
  return String(v == null ? '' : v).slice(0, 80).trim();
}

function passwordValida(v) {
  const p = String(v == null ? '' : v);
  if (p.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (p.length > 200) return 'La contraseña es demasiado larga';
  return '';
}

/**
 * Detecta el tipo real de una imagen por sus primeros bytes.
 * Devuelve null para HTML, SVG, ejecutables o cualquier cosa que no sea
 * PNG/JPG/GIF/WEBP (así no se puede subir contenido activo).
 */
function tipoImagen(buf) {
  if (!buf || !buf.length) return null;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  const cabecera = buf.subarray(0, 6).toString('ascii');
  if (cabecera === 'GIF87a' || cabecera === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

module.exports = { EMAIL, normalizarEmail, nombreValido, passwordValida, tipoImagen };
