#!/usr/bin/env node
/**
 * Intégrité du graphe de ressources — `npm run check:assets`
 *
 * Cas d'école rencontré en codespace : le serveur répond `GET /fr 200`, le terminal n'affiche
 * aucune erreur, et le navigateur montre une page blanche. Entre les deux, il y a le HTML : s'il
 * référence un chunk que le serveur ne peut plus fournir (build à moitié régénéré, `.next` supprimé
 * sous un serveur en cours, deux Next majeurs mélangés, cache d'install tronqué), la page « démarre »
 * puis meurt au premier `import` — sans jamais le dire côté serveur.
 *
 * Ce contrôle fait ce que fait le navigateur, mais depuis le terminal :
 *   1. il télécharge le HTML de chaque route ;
 *   2. il en extrait TOUTES les ressources internes (`/_next/static/…`, `/_next/image?…`, `/icons/…`,
 *      `/images/…`, `/manifest…`, `/sw.js`) ;
 *   3. il les re-demande une par une et exige un 2xx (ou 3xx pour les ressources servies via redirect).
 *
 *   npm run dev                              # à côté
 *   npm run check:assets                     # /fr /en /nl /de + simulateur + admin
 *   npm run check:assets -- --routes /fr --detail
 *
 * Sortie : 0 si chaque ressource référencée est servie, 1 sinon.
 */
import process from "node:process";

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : defaut;
};
const drapeau = (nom) => process.argv.includes(`--${nom}`);

const BASE = (arg("base", "http://localhost:3000")).replace(/\/$/, "");
// Slice 1 = la page d'accueil, quatre langues: les routes par défaut sont celles qui EXISTENT.
// (L'ancienne liste promettait /fr/credit/simulator et /fr/admin/dashboard: un défaut par rapport à
// la règle « un écran qui ne fait rien est pire qu'un écran absent » — les remettre quand elles vivent.)
const ROUTES = (drapeau("routes") ? process.argv.slice(process.argv.indexOf("--routes") + 1).filter((a) => !a.startsWith("--")) : ["/fr", "/en", "/nl", "/de"]);
// `--detail` et pas seulement `--verbose`: npm réserve --verbose (comme --dry-run) comme sa propre
// config et ne le transmet PAS au script -> `npm run check:assets -- --verbose` passerait en muet.
const VERBOSITE = drapeau("verbose") || drapeau("detail");
const CONCURRENCE = Number(arg("concurrency", 8));

const PATRON = /(?:href|src)=["'](\/[^"']+)["']|url\((\/[^)]+)\)/g;

function ressources(html) {
  const vues = new Set();
  let m;
  PATRON.lastIndex = 0;
  while ((m = PATRON.exec(html)) !== null) {
    const u = m[1];
    if (!u || u.startsWith("//")) continue; // protocole-relatif: hors origine
    if (!/^\/(_next|icons|images|manifest|screenshots|sw\.js|favicon)/.test(u)) continue; // pages: testées par la route elle-même
    vues.add(u);
  }
  return [...vues];
}

async function demander(url) {
  try {
    const rep = await fetch(BASE + url, { redirect: "follow" });
    return { code: rep.status, type: rep.headers.get("content-type") ?? "", cc: rep.headers.get("cache-control") ?? "" };
  } catch (e) {
    return { code: 0, type: "", cc: "", erreur: e.message.split("\n")[0] };
  }
}

const lignes = [];
const anomalies = [];
let total = 0;

for (const route of ROUTES) {
  const page = await demander(route);
  if (page.code >= 400 || page.code === 0) {
    anomalies.push(`${route} → ${page.code || "aucune réponse"}${page.erreur ? ` (${page.erreur})` : ""} : la route elle-même n'est pas servie`);
    continue;
  }
  const html = await (await fetch(BASE + route)).text();
  const refs = ressources(html);
  total += refs.length;

  const resultats = [];
  for (let i = 0; i < refs.length; i += CONCURRENCE) {
    const groupe = refs.slice(i, i + CONCURRENCE);
    resultats.push(...(await Promise.all(groupe.map(async (u) => ({ u, ...await demander(u) })))));
  }
  const morts = resultats.filter((r) => r.code >= 400 || r.code === 0);
  lignes.push(`  ${route}  ${refs.length} ressource(s), ${morts.length} en échec`);
  for (const r of morts) {
    anomalies.push(`${route} → ${r.u} : ${r.code || "aucune réponse"}${r.erreur ? ` (${r.erreur})` : ""}`);
  }
  if (VERBOSITE) {
    for (const r of resultats) console.log(`    ${String(r.code).padEnd(3)} ${r.type.split(";")[0].padEnd(24)} ${r.u.slice(0, 96)}`);
  }
}

if (anomalies.length) {
  console.error(`\n✖ check-assets: ${anomalies.length} ressource(s) référencée(s) par le HTML et non servies:\n`);
  for (const a of anomalies.slice(0, 30)) console.error(`  ${a}`);
  if (anomalies.length > 30) console.error(`  … ${anomalies.length - 30} autre(s)`);
  console.error([
    "",
    "  Le HTML demande une ressource que le serveur ne fournit pas: la page se vide dans le",
    "  navigateur sans erreur côté serveur. Causes déjà vues sur ce dépôt:",
    "    - .next supprimé ou réécrit pendant qu'un serveur tournait: Ctrl-C, rm -rf .next, relancer;",
    "    - build de production et next dev partageant le même .next: ne jamais lancer les deux;",
    "    - install npm tronquée (voir npm run check:links et la note npm >= 12 du README);",
    "    - un second serveur sur un autre port, avec l'aperçu branché sur le mauvais.",
    "",
  ].join("\n"));
  process.exit(1);
}

console.log(`✔ check-assets: ${total} ressource(s) référencée(s) par ${ROUTES.length} route(s), toutes servies (${BASE}).`);
if (lignes.length) console.log(lignes.join("\n"));
