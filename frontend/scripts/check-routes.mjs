#!/usr/bin/env node
/**
 * Intégrité des liens internes — `npm run check:links`
 *
 * Une `<Link href="/…/login">` vers une route qui n'existe pas ne casse rien au build : le 404
 * n'apparaît qu'au clic, et en App Router le visiteur tombe alors sur le document « not found »
 * après une page correctement rendue — exactement le « le site disparaît après être apparu »
 * vécu depuis le navigateur. Ce contrôle croise chaque cible interne du code ET des
 * dictionnaires avec les `page.tsx` réellement présents.
 *
 *   node scripts/check-routes.mjs            # sort 1 si une cible est morte
 *
 * Les segments dynamiques sont traités comme des jokers dans les deux sens : `/${locale}/x`
 * matche `x`, `x/[id]` et `[id]`, et `/[locale]/admin/customers/${id}` matche
 * `admin/customers/[id]`.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SEG_LOCALE = /^(fr|en|nl|de)$/;
const FICHIERS_SCAN = ["app", "components", "lib", "hooks", "features"];

/** Routes du segment [locale], relatives et sans slash de bord. */
function routes() {
  const base = join(ROOT, "app/[locale]");
  const out = new Set();
  const marcher = (dossier, prefix) => {
    for (const nom of readdirSync(dossier)) {
      const plein = join(dossier, nom);
      if (statSync(plein).isDirectory()) {
        const nomSeg = nom.replace(/^\((.*)\)$/, ""); // groupes de routes optionnels
        marcher(plein, prefix ? `${prefix}/${nomSeg}` : nomSeg);
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(nom)) {
        out.add(prefix);
      }
    }
  };
  if (existsSync(base)) marcher(base, "");
  return [...out];
}

const normaliser = (p) => {
  let s = p.split("?")[0].split("#")[0];
  if (!s.startsWith("/")) return null; // hash relatif, ancre: hors périmètre
  s = s.replace(/\/+$/, "");
  return s === "" ? "/" : s;
};

/** Un chemin -> segments, les parties dynamiques (`${…}`, `{…}`, `[…]`) devenant des jokers. */
function segments(chemin) {
  return chemin
    .split("/")
    .filter(Boolean)
    .map((s) => (/^(\$\{|\{|\[).*/.test(s) || /^\}*\]$/.test(s) || /^\$\{.*\}$/.test(s) || /^\{.*\}$/.test(s) ? "*" : s));
}

function ignorer(chemin) {
  if (!chemin || !chemin.startsWith("/")) return true;
  if (/^\/\//.test(chemin)) return true;
  const s = chemin.slice(1);
  if (s === "api" || s.startsWith("api/")) return true; // backend, pas une page
  if (s.startsWith("_next/")) return true;
  if (/^(icons|screenshots|manifest)\b/.test(s) || /^manifest(\.json|\/)/.test(s)) return true;
  if (/^(sw\.js|favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest)$/.test(s)) return true;
  if (/\.(png|jpe?g|svg|ico|webp|avif|json|txt|xml|css|js|webmanifest)$/.test(s)) return true;
  return false;
}

// Sans not-found à la racine, Next garde SA page 404 : une phrase en anglais, aucun lien,
// rendue hors du segment localisé — le visiteur croit à une panne. Le contrôle porte là aussi.
const FATAUX = ["app/not-found.tsx", "app/[locale]/not-found.tsx", "app/[locale]/error.tsx", "app/global-error.tsx"];
const absents = FATAUX.filter((f) => !existsSync(join(ROOT, f)));
if (absents.length) {
  console.error(`\n✖ check-routes: fichier(s) de secours manquant(s): ${absents.join(", ")}\n   Sans eux, une route inconnue ou une exception de rendu laisse une page vide (docs/hydration.md, règles 13 et 14).\n`);
  process.exit(1);
}

const liste = routes();
const motifs = liste.map((r) => segments(r.startsWith("/") ? r : `/${r}`));

function routeConnue(chemin) {
  const norm = normaliser(chemin);
  if (norm === null) return true; // cible non absolue: hors périmètre
  if (ignorer(norm)) return true;
  let segs = segments(norm);
  if (segs.length && SEG_LOCALE.test(segs[0])) segs = segs.slice(1);
  else if (segs.length && segs[0] === "*") segs = segs.slice(1); // `/${locale}/…`
  if (segs.length === 0) return true; // la racine du segment existe toujours
  return motifs.some((m) => m.length === segs.length && m.every((s, i) => s === "*" || segs[i] === "*" || s === segs[i]));
}

const CIBLES = new Map();
const PATRON = /(?:href=|href=\{|push\(|replace\(|redirect\(|src=)\s*[`"']([^`"'\n]*\/[A-Za-z0-9_.$%-][^`"'\n]*)[`"']/g;
// Les tableaux de navigation des coquilles déclarent `href: "dashboard"` (nu) et le composant
// préfixe lui-même par `/${locale}/` : sans cette capture, la moitié des routes paraîtraient
// orphelines alors qu'elles sont le cœur du parcours.
const PATRON_NU = /\b(?:href|to|path|url|target)\s*[:=]\s*["'](\/??[a-z][a-z0-9._-]*(?:\/[a-zA-Z0-9._$%{}-]+)*)["']/g;

function indexer(fichier, texte) {
  const lignes = texte.split("\n");
  lignes.forEach((ligne, i) => {
    if (ligne.includes("check-routes:ignore")) return;
    const voir = (cible) => {
      if (!CIBLES.has(cible)) CIBLES.set(cible, []);
      CIBLES.get(cible).push(`${relative(ROOT, fichier)}:${i + 1}`);
    };
    let m;
    PATRON.lastIndex = 0;
    while ((m = PATRON.exec(ligne)) !== null) {
      const cible = m[1];
      if (!cible.startsWith("/") || cible.startsWith("//")) continue;
      voir(cible);
    }
    PATRON_NU.lastIndex = 0;
    while ((m = PATRON_NU.exec(ligne)) !== null) {
      const brute = m[1];
      if (/^(https?|mailto|tel|javascript)$/.test(brute)) continue;
      const cible = brute.startsWith("/") ? brute : `/${brute}`;
      if (ignorer(cible)) continue;
      voir(cible);
    }
  });
}

function* marcher(dir) {
  if (!existsSync(dir)) return;
  for (const nom of readdirSync(dir)) {
    const plein = join(dir, nom);
    const st = statSync(plein);
    if (st.isDirectory()) yield* marcher(plein);
    else if (/\.(tsx|ts|jsx|js)$/.test(nom)) yield plein;
  }
}

for (const dossier of FICHIERS_SCAN) for (const f of marcher(join(ROOT, dossier))) indexer(f, readFileSync(f, "utf8"));

// Les libellés de dictionnaire peuvent porter une URL de CTA: un lien mort y est aussi un lien mort.
for (const loc of ["fr", "en", "nl", "de"]) {
  const dossier = join(ROOT, "i18n", loc);
  if (!existsSync(dossier)) continue;
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith(".json")) continue;
    const objet = JSON.parse(readFileSync(join(dossier, nom), "utf8"));
    for (const [cle, valeur] of Object.entries(objet)) {
      if (typeof valeur === "string" && /^\/[a-z]/.test(valeur) && !/\s/.test(valeur) && !routeConnue(valeur)) {
        const cible = `${valeur}  (i18n)`;
        if (!CIBLES.has(cible)) CIBLES.set(cible, []);
        CIBLES.get(cible).push(`i18n/${loc}/${nom}:${cle}`);
      }
    }
  }
}

const mortes = [...CIBLES.entries()].filter(([cible]) => !routeConnue(cible));

if (mortes.length) {
  console.error(`\n✖ check-routes: ${mortes.length} lien(s) interne(s) vers une route inexistante:\n`);
  for (const [cible, sites] of mortes) {
    console.error(`  ${cible}\n    ← ${sites.slice(0, 4).join(", ")}${sites.length > 4 ? ` (+${sites.length - 4})` : ""}`);
  }
  console.error(`\n  Soit créer la page sous app/[locale]/…, soit corriger la cible. Échapper un cas
  délibéré (lien vers une app externe montée séparément) avec un commentaire « check-routes:ignore »
  sur la ligne.\n`);
  process.exit(1);
}

// Routes sans lien entrant: information seulement (une page peut être atteinte par URL directe,
// un webhook, un shortcut de manifeste ou un deep-link marketing), jamais bloquant.
function routeCorrespondante(chemin) {
  const norm = normaliser(chemin);
  if (norm === null || ignorer(norm)) return null;
  let segs = segments(norm);
  if (segs.length && (SEG_LOCALE.test(segs[0]) || segs[0] === "*")) segs = segs.slice(1);
  if (segs.length === 0) return "";
  const i = motifs.findIndex((m) => m.length === segs.length && m.every((r, j) => r === "*" || segs[j] === "*" || r === segs[j]));
  return i === -1 ? null : liste[i];
}
const atteignables = new Set();
for (const [cible] of CIBLES) {
  const r = routeCorrespondante(cible);
  if (r !== null) atteignables.add(r);
}
const orphelines = liste.filter((r) => r !== "" && !atteignables.has(r));

console.log(
  `✔ check-routes: ${CIBLES.size} cible(s) interne(s), toutes résolues sur ${liste.length} route(s) du segment [locale].`
);
if (orphelines.length) {
  console.log(`  (sans lien entrant détecté, donc accessibles par URL directe: ${orphelines.join(", ")})`);
}
