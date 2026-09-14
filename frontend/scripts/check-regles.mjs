#!/usr/bin/env node
/**
 * check-regles — verrou de la grille partagée (miroir backend).
 *
 * Une seule table de vérité : `rate_be/grille.json` (paliers de taux, bornes produits, frais,
 * historique hash-chaîné). Le moteur frontend (`lib/credit-engine.ts`) l'importe ; le futur
 * backend lira le même fichier. Cette garde vérifie :
 *
 *  1. la table elle-même : paliers entiers contigus, taux dans (0,1), bornes produits cohérentes,
 *     continuité des périodes d'effet, une seule entrée ouverte (la dernière) ;
 *  2. la chaîne de hashes : sha256 canonique par entrée, chaînée à la précédente — toute
 *     modification de la grille sans re-scellement est détectée (`--stamp` pour sceller) ;
 *  3. les identifiants de règle : `rate_<PAYS>_<PRODUIT>_<min>_<max>`, dérivés de la table,
 *     uniques — ce sont eux qui sortent dans `meta.rateRuleId` et le journal d'audit ;
 *  4. le miroir : credit-engine.ts importe la table (pas de paliers recodés en dur), et aucune
 *     UI n'écrit d'identifiant `rate_…` à la main.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";

const FRONT = resolve(new URL(".", import.meta.url).pathname, "..");
const DEPOT = join(FRONT, "..");
const GRILLE = join(DEPOT, "rate_be", "grille.json");

let echecs = 0;
const probleme = (m) => { console.log("✖ " + m); echecs++; };
const ok = (m) => console.log("✔ " + m);

const brut = readFileSync(GRILLE, "utf8");
let grille;
try { grille = JSON.parse(brut); } catch (e) { console.log("✖ grille.json illisible : " + e.message); process.exit(1); }

const stamp = process.argv.includes("--stamp");

/* --- 1. invariants de la table ------------------------------------------------------------- */
if (grille.schema !== "kredit.grille/1") probleme(`schema inconnu: ${grille.schema}`);
if (!grille.pays || !grille.devise) probleme("pays/devise manquants");
if (!Array.isArray(grille.historique) || !grille.historique.length) probleme("historique vide");

const estISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

(grille.historique || []).forEach((entree, i) => {
  const ou = `historique[${i}] (${entree.version ?? "?"})`;
  if (!estISO(entree.effectif_du)) probleme(`${ou}: effectif_du doit être une date AAAA-MM-JJ`);
  if (entree.effectif_au !== null && !estISO(entree.effectif_au)) probleme(`${ou}: effectif_au doit être null ou AAAA-MM-JJ`);
  const p = entree.paliers_taux;
  if (!Array.isArray(p) || !p.length) { probleme(`${ou}: paliers_taux vide`); return; }
  p.forEach((b, j) => {
    if (!Number.isInteger(b.min) || b.min <= 0) probleme(`${ou}: palier[${j}].min doit être un entier > 0`);
    if (b.max !== null && (!Number.isInteger(b.max) || b.max <= b.min)) probleme(`${ou}: palier[${j}].max doit être null ou un entier > min`);
    if (!(typeof b.taux === "number" && b.taux > 0 && b.taux < 1)) probleme(`${ou}: palier[${j}].taux doit être dans (0,1)`);
    if (j > 0 && p[j - 1].max !== null && b.min !== p[j - 1].max + 1) {
      probleme(`${ou}: paliers non contigus — palier[${j}].min doit être palier[${j - 1}].max + 1`);
    }
    if (j > 0 && p[j - 1].max === null) probleme(`${ou}: un seul palier ouvert (le dernier) est admis`);
  });
  if (p[p.length - 1].max !== null) probleme(`${ou}: le dernier palier doit être ouvert (max null)`);
  const codes = Object.keys(entree.produits || {});
  if (!codes.length) probleme(`${ou}: aucun produit`);
  for (const code of codes) {
    const pr = entree.produits[code];
    if (!(pr.min < pr.max)) probleme(`${ou}: ${code} min >= max`);
    if (!(pr.minTerm > 0 && pr.maxTerm > pr.minTerm)) probleme(`${ou}: ${code} durées incohérentes`);
    if (!(pr.pas > 0)) probleme(`${ou}: ${code} pas <= 0`);
    const f = pr.frais || {};
    if (!(f.filePct >= 0 && f.fileMin >= 0 && f.fileMax >= f.fileMin)) probleme(`${ou}: ${code} frais incohérents`);
  }
  const chevauchent = codes.filter((c) => {
    const a = entree.produits[c];
    return (grille.historique[i].paliers_taux || []).some((b) => (b.max === null || b.max >= a.min) && b.min <= a.max);
  });
  if (!chevauchent.length) probleme(`${ou}: aucun produit ne touche aucun palier`);
});

/* Continuité des périodes : l'entrée i se termine quand l'entrée i+1 commence. */
for (let i = 1; i < (grille.historique || []).length; i++) {
  const prev = grille.historique[i - 1];
  const cur = grille.historique[i];
  if (prev.effectif_au !== cur.effectif_du) {
    probleme(`continuité rompue : historique[${i - 1}].effectif_au (${prev.effectif_au}) ≠ historique[${i}].effectif_du (${cur.effectif_du})`);
  }
}
const ouvertes = (grille.historique || []).filter((e) => e.effectif_au === null);
if (ouvertes.length !== 1 || grille.historique[grille.historique.length - 1].effectif_au !== null) {
  probleme("il faut exactement une entrée ouverte (effectif_au null), et ce doit être la dernière");
}

/* --- 2. chaîne de hashes --------------------------------------------------------------------- */
function canonique(entree) {
  const { hash, ...reste } = entree;
  return JSON.stringify({ pays: grille.pays, devise: grille.devise, ...reste });
}
const empreinte = (entree) => createHash("sha256").update(canonique(entree), "utf8").digest("hex");

let precedente = null;
let chaineValide = true;
const maj = [];
for (const entree of grille.historique || []) {
  const attendu = empreinte(entree);
  if (stamp) { entree.hash_precedent = precedente; entree.hash = attendu; maj.push(entree); }
  if (!stamp && entree.hash !== attendu) {
    probleme(`hash invalide pour la version ${entree.version} (relancer avec --stamp si la modification est volontaire)`);
    chaineValide = false;
  }
  if (!stamp && entree.hash_precedent !== precedente) {
    probleme(`chaîne brisée : version ${entree.version} ne pointe pas vers le hash de la version précédente`);
    chaineValide = false;
  }
  precedente = stamp ? attendu : entree.hash;
}
if (stamp) {
  writeFileSync(GRILLE, JSON.stringify(grille, null, 2) + "\n", "utf8");
  ok(`check-regles --stamp : ${maj.length} entrée(s) scellée(s) dans rate_be/grille.json`);
} else if (chaineValide) {
  ok("chaîne de hashes de la grille valide");
}

/* --- 3. identifiants de règle dérivés de la table -------------------------------------------- */
const derivees = [];
for (const entree of grille.historique || []) {
  for (const code of Object.keys(entree.produits || {})) {
    const pr = entree.produits[code];
    for (const b of entree.paliers_taux || []) {
      if (b.min > pr.max) continue;
      const plafond = b.max === null ? pr.max : Math.min(b.max, pr.max);
      if (plafond < pr.min) continue;
      const plancher = Math.max(b.min, pr.min);
      if (plancher > plafond) continue;
      derivees.push({ version: entree.version, id: `rate_${grille.pays}_${code}_${plancher}_${plafond}` });
    }
  }
}
const parVersion = new Map();
for (const r of derivees) {
  if (!parVersion.has(r.version)) parVersion.set(r.version, []);
  parVersion.get(r.version).push(r.id);
}
for (const [version, ids] of parVersion) {
  const uniques = new Set(ids);
  if (uniques.size !== ids.length) probleme(`version ${version}: identifiants de règle en double`);
  for (const id of ids) if (!/^rate_[A-Z]{2}_[A-Z]+_\d+_\d+$/.test(id)) probleme(`version ${version}: identifiant mal formé : ${id}`);
}
const courante = grille.historique[grille.historique.length - 1];
ok(`identifiants de règle dérivés de la table : ${parVersion.get(courante.version).length} pour la version effective ${courante.version}`);

/* --- 4. le miroir : le moteur lit la table, personne ne la recode ---------------------------- */
const moteur = readFileSync(join(FRONT, "lib", "credit-engine.ts"), "utf8");
if (!/from\s+["']\.\.\/\.\.\/rate_be\/grille\.json["']/.test(moteur)) {
  probleme("credit-engine.ts doit importer rate_be/grille.json (la grille ne vit qu'à un seul endroit)");
}
const moteurSansCommentaires = moteur
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1 ");
if (/taux:\s*0[.,]\d+/.test(moteurSansCommentaires) || /PALIERS_TAUX\s*=\s*\[/.test(moteurSansCommentaires)) {
  probleme("credit-engine.ts contient des paliers de taux en dur — ils doivent sortir de rate_be/grille.json");
}

/* Aucun identifiant rate_… écrit à la main dans l'UI : ils sortent du moteur, point. */
const dossiersUI = ["app", "components"].map((d) => join(FRONT, d));
function* tsx(sous) {
  for (const entree of readdirSync(sous)) {
    const chemin = join(sous, entree);
    const st = statSync(chemin);
    if (st.isDirectory()) yield* tsx(chemin);
    else if ([".ts", ".tsx"].includes(extname(chemin))) yield chemin;
  }
}
let idEnDur = 0;
for (const dossier of dossiersUI) {
  for (const fichier of tsx(dossier)) {
    const src = readFileSync(fichier, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1 ");
    if (/rate_[A-Z]{2}_[A-Z]+_\d+_\d+/.test(src)) { probleme(`identifiant de règle écrit en dur dans ${fichier}`); idEnDur++; }
  }
}
if (!idEnDur && !echecs) ok("miroir : le moteur importe la table partagée, aucune règle recodée dans l'UI");

/* --- 5. référentiel des virements (pipeline + défauts définis par l'administration) ---------- */
const REFERENTIEL = join(DEPOT, "operations", "virements.json");
try {
  const ref = JSON.parse(readFileSync(REFERENTIEL, "utf8"));
  const p = ref.pipeline;
  if (!Array.isArray(p) || p.length < 2) probleme("référentiel : pipeline doit avoir au moins 2 niveaux");
  else {
    p.forEach((n, i) => {
      if (!/^[A-Z][A-Z_]*$/.test(n.code)) probleme(`référentiel : code de niveau mal formé (${n.code})`);
      if (!(Number.isInteger(n.pct) && n.pct > 0 && n.pct <= 100)) probleme(`référentiel : pct invalide pour ${n.code}`);
      if (i > 0 && n.pct <= p[i - 1].pct) probleme(`référentiel : les pct doivent strictement croître (${n.code})`);
    });
    if (p[p.length - 1].pct !== 100) probleme("référentiel : le dernier niveau doit atteindre 100 %");
  }
  const codes = new Set();
  const pctsPipeline = new Set((p || []).map((n) => n.pct));
  for (const d of ref.defauts || []) {
    if (!/^[A-Z][A-Z_]*$/.test(d.code)) probleme(`référentiel : code de défaut mal formé (${d.code})`);
    if (!(typeof d.cout === "number" && d.cout >= 0)) probleme(`référentiel : coût invalide pour ${d.code}`);
    if (!pctsPipeline.has(d.pct)) probleme(`référentiel : le pct d'arrêt de ${d.code} doit être celui d'un niveau du pipeline`);
    if (codes.has(d.code)) probleme(`référentiel : défaut en double (${d.code})`);
    codes.add(d.code);
  }
  // Chaque code a son libellé ET son explication dans les quatre langues
  // (clés banque.pipeline.<CODE> / banque.defaut.<CODE> / banque.defaut.<CODE>.explain).
  for (const loc of ["fr", "en", "nl", "de"]) {
    const d = JSON.parse(readFileSync(join(FRONT, "i18n", loc, "banque.json"), "utf8"));
    for (const n of p || []) if (!d[`pipeline.${n.code}`]) probleme(`clé manquante : banque.pipeline.${n.code} (${loc})`);
    for (const c of codes) {
      if (!d[`defaut.${c}`]) probleme(`clé manquante : banque.defaut.${c} (${loc})`);
      if (!d[`defaut.${c}.explain`]) probleme(`clé manquante : banque.defaut.${c}.explain (${loc})`);
    }
  }
  const moteurBanque = readFileSync(join(FRONT, "lib", "banque.ts"), "utf8");
  if (!/from\s+["']\.\.\/\.\.\/operations\/virements\.json["']/.test(moteurBanque)) {
    probleme("lib/banque.ts doit importer operations/virements.json (le référentiel ne vit qu'à un seul endroit)");
  }
  if (!echecs) ok(`référentiel virements : ${p.length} niveaux, ${codes.size} défauts, libellés ×4 présents`);
} catch (e) {
  probleme(`référentiel virements illisible : ${e.message}`);
}

if (echecs) { console.log(`\ncheck-regles: ${echecs} problème(s)`); process.exit(1); }
console.log("✔ check-regles: la grille partagée est valide et son miroir tient.");
