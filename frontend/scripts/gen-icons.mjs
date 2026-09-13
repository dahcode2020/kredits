#!/usr/bin/env node
/**
 * Générateur d'icônes — zéro dépendance (PNG écrit à la main via zlib).
 *
 *   node scripts/gen-icons.mjs     → public/icons/icon-{72,192,512}.png,
 *                                    public/icons/apple-touch-icon.png, public/favicon.ico
 *
 * Pourquoi un générateur plutôt que des binaires déposés: les icônes sont reproductibles
 * (mêmes octets à chaque exécution), donc `check:state` ne verra jamais une icône « modifiée »
 * par accident, et n'importe qui peut les régénérer sans outil externe.
 *
 * Dessin: carré aux coins arrondis #FF4A17 (primaire du thème), lettre K blanche.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIMAIRE = [0xff, 0x4a, 0x17];
const BLANC = [0xff, 0xff, 0xff];

// Lettre K sur une grille 5×7 (1 = plein).
const K = [
  [1, 0, 0, 0, 1],
  [1, 0, 0, 1, 0],
  [1, 0, 1, 0, 0],
  [1, 1, 0, 0, 0],
  [1, 0, 1, 0, 0],
  [1, 0, 0, 1, 0],
  [1, 0, 0, 0, 1],
];

/** Point dans le rectangle arrondi (rayon en proportion de la taille)? */
function dansRectangle(x, y, taille, rayon) {
  if (x < 0 || y < 0 || x >= taille || y >= taille) return false;
  const r = taille * rayon;
  const cx = x < r ? r : x >= taille - r ? taille - r - 1 : x;
  const cy = y < r ? r : y >= taille - r ? taille - r - 1 : y;
  if (cx === x && cy === y) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Le pixel (x, y) est-il dans le glyphe K? (glyphes centrés, ~52 % de la taille) */
function dansK(x, y, taille) {
  const g = taille * 0.52;
  const gx0 = (taille - g) / 2;
  const gy0 = (taille - g * (7 / 5)) / 2;
  const col = Math.floor(((x - gx0) / g) * 5);
  const lig = Math.floor(((y - gy0) / (g * (7 / 5))) * 7);
  if (col < 0 || col > 4 || lig < 0 || lig > 6) return false;
  return K[lig][col] === 1;
}

function pixels(taille) {
  const buf = Buffer.alloc(taille * taille * 4);
  const r = 0.18;
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      // Antialiasing: moyenne sur 4 sous-échantillons.
      let dedans = 0;
      let k = 0;
      for (const sx of [0.25, 0.75]) {
        for (const sy of [0.25, 0.75]) {
          const px = x + sx;
          const py = y + sy;
          if (dansRectangle(px, py, taille, r)) {
            dedans++;
            if (dansK(px, py, taille)) k++;
          }
        }
      }
      const i = (y * taille + x) * 4;
      if (!dedans) { buf[i + 3] = 0; continue; }
      const [cr, cg, cb] = k >= dedans / 2 ? BLANC : PRIMAIRE;
      buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = Math.round((dedans / 4) * 255);
    }
  }
  return buf;
}

// — encodeur PNG minimal (RGBA, filtre 0)
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([len, corps, crc]);
}
function png(taille) {
  const brut = pixels(taille);
  const scan = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    scan[y * (taille * 4 + 1)] = 0; // filtre « aucun »
    brut.copy(scan, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8;  // profondeur
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scan, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// — conteneur ICO (une entrée PNG, valide depuis Windows Vista et tous les navigateurs)
function ico(pngBuf, taille) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  const entree = Buffer.alloc(16);
  entree[0] = taille >= 256 ? 0 : taille;
  entree[1] = taille >= 256 ? 0 : taille;
  entree.writeUInt16LE(1, 4);   // plans
  entree.writeUInt16LE(32, 6);  // bpp
  entree.writeUInt32LE(pngBuf.length, 8);
  entree.writeUInt32LE(22, 12); // offset des données
  return Buffer.concat([head, entree, pngBuf]);
}

const cibles = [
  ["public/icons/icon-72.png", png(72)],
  ["public/icons/icon-192.png", png(192)],
  ["public/icons/icon-512.png", png(512)],
  ["public/icons/apple-touch-icon.png", png(180)],
  ["public/favicon.ico", ico(png(64), 64)],
];
for (const [rel, buf] of cibles) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log("✔", rel, buf.length, "octets");
}
