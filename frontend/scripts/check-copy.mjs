#!/usr/bin/env node
/**
 * Budget de copie non traduite (zéro dépendance).
 *
 *   node scripts/check-copy.mjs              → exit 1 si un fichier dépasse son budget
 *   node scripts/check-copy.mjs --update     → recalcule le budget (après une traduction)
 *   node scripts/check-copy.mjs --report     → liste les pires fichiers, sans contrôler
 *
 * Pourquoi un budget et pas une interdiction : l'app a été écrite en français, puis traduite par
 * strates. Interdire d'un coup signifierait 150+ chaînes à livrer dans un seul commit, donc un
 * commit impossible à relire. Le budget est **décroissant** : aucune ligne nouvelle de copie française
 * ne passe, et chaque traduction fait baisser la ligne correspondante du fichier d'étalonnage.
 *
 * Pourquoi les coquilles sont à 0 (`FLOOR_DIRS`) : `components/customer/*` et `components/admin/*`
 * enveloppent toutes les pages métier. Leur copie était en dur → un utilisateur `nl` avait une page
 * traduite dans un menu français. `components/pwa/*` y est aussi : ces bannières (hors ligne, install,
 * mise à jour, push) sont rendues dans le layout de **toutes** les pages, dont les routes live-SDK et
 * la page de repli servie par le service worker — c'est-à-dire précisément quand l'utilisateur est le
 * moins bien connecté et le plus susceptible de ne pas parler français. Ces répertoires sont donc
 * **interdits** de copie en dur, pas budgétés.
 *
 * Heuristique (délibérément conservatrice) : une « ligne de copie » = une ligne de JSX (hors commentaire)
 * contenant du texte visible de ≥ 2 mots avec au moins un caractère accentué, ou un littéral de chaîne
 * dans ce cas. Les classNames Tailwind, URL, chemins et identifiants sont exclus, idem les lignes qui
 * font déjà suivre la langue au texte (`locale === … ? … : …`) — traduites, mais hors dictionnaires.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "copy.baseline.json");
const SCAN_DIRS = ["app", "components", "features"];
const FLOOR_DIRS = ["components/customer", "components/admin", "components/pwa", "components/layout"];
/**
 * Fichiers passés à zéro, maintenus à zéro (règle dure, pas de budget). La page d'accueil y est
 * depuis que toute sa copie est dans les dictionnaires : son texte est rendu **côté serveur** dans la
 * langue du segment, donc une chaîne qui y repasserait en dur se retrouve littéralement dans le HTML
 * des trois autres langues (index, partages, SEO) — contrairement au reste des pages, invisible
 * jusqu'à l'hydratation.
 */
const FLOOR_FILES = ["app/[locale]/page.tsx", "app/[locale]/offline/page.tsx", "app/layout.tsx", "app/[locale]/layout.tsx"];
/**
 * Sous-règle **stricte**, appliquée seulement aux fichiers déjà sous règle dure (`FLOOR_DIRS` +
 * `FLOOR_FILES`) et aux répertoires listés ici. Le compteur d'accents laisse passer ce qui est français
 * *sans* accent : « Produits », « 338,84€ / mois », « Admin — décision ». Un chrome promis « à zéro » ne
 * peut pas se contenter de ça : là, tout nœud texte littéral doit venir d'un dictionnaire.
 */
const STRICT_DIRS = ["components/layout", "components/pwa", "components/customer", "components/admin", "components/credit", "components/examples", "components/ui", "components/home"];

// --- axe strict ------------------------------------------------------------------------------------------------------
const MOTS_OUTILAGE = /\b(le|la|les|des|du|de|un|une|pour|avec|dans|est|sont|votre|notre|au|aux|ce|cet|cette|ces|mes|ses|requis|requise|voir|cliquer|envoyer|annuler|pr[cé]c[eé]dent|suivant|fermer|ouvrir|modifier|ajouter|supprimer|connecté|d[ée]connexion|hors ligne|disponible|langue|dur[ée]e|montant|frais|taux|pi[èe]ce|justificatif|extrait)\b/i;
const CODE = /[(){}="`;]|=>|\bfunction\b/;
/** Marques et sigles que l'on affiche tels quels sur les quatre marchés (aucune traduction possible). */
const MARQUES_TECHNIQUES = new Set(["kredit", "eidas", "itsme", "febelfin", "swift", "payconiq", "ideal", "secci", "https", "www", "whatsapp"]);

/** Vocabulaire du projet: les mots des valeurs des dictionnaires `fr` — l'oracle « copie d'interface ou pas ». */
function vocabulaireFrancais() {
  const mots = new Set();
  let fichiers = [];
  try { fichiers = readdirSync(join(ROOT, "i18n", "fr")).filter((x) => x.endsWith(".json")); } catch { return mots; }
  for (const f of fichiers) {
    let d;
    try { d = JSON.parse(readFileSync(join(ROOT, "i18n", "fr", f), "utf8")); } catch { continue; }
    for (const v of Object.values(d)) {
      if (typeof v !== "string") continue;
      for (const w of v.toLowerCase().match(/[a-zà-ÿ]{3,}/g) ?? []) mots.add(w);
    }
  }
  return mots;
}

/** Retire les blocs de commentaires (machine à états, comme `copie`) : la doc du projet est en français. */
function sansBlocs(texte) {
  let dansBloc = false;
  return texte.split("\n").map((line) => {
    if (dansBloc) {
      const fin = line.indexOf("*/");
      if (fin === -1) return "";
      dansBloc = false;
      return line.slice(fin + 2);
    }
    let out = "";
    let reste = line;
    for (;;) {
      const debut = reste.indexOf("/*");
      if (debut === -1) { out += reste; break; }
      const fin = reste.indexOf("*/", debut + 2);
      if (fin === -1) { out += reste.slice(0, debut); dansBloc = true; break; }
      out += reste.slice(0, debut) + " " + reste.slice(fin + 2);
      reste = reste.slice(fin + 2);
    }
    return out;
  }).join("\n");
}

function stricte(texte, dictFr) {
  const out = [];
  sansBlocs(texte).split("\n").forEach((raw, i) => {
    const line = clean(raw);
    if (/check-copy:ignore/.test(line)) return; // cas assumés: wordmark, énumération de langues, noms d'API
    for (const m of line.matchAll(/>([^<>{}\n]{2,})</g)) {
      const c = m[1].replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
      if (!c || CODE.test(c)) continue;                    // du code, pas de la copie
      // Un mot tout en majuscules est un acronyme technique (FSMA, RGPD, PWA, EUR), une marque ou un code
      // pays: ce n'est pas de la copie. Idem pour un identifiant (`Intl.DateTimeFormat`, un nom de fichier).
      if (/^[A-Za-z0-9_.\-]+$/.test(c) && /[._::]/.test(c)) continue;
      const mots = (c.match(/[A-Za-zà-ÿ]{3,}/g) ?? [])
        .filter((w) => !/^[A-Z0-9]+$/.test(w))
        .filter((w) => !MARQUES_TECHNIQUES.has(w.toLowerCase()))
        .map((w) => w.toLowerCase());
      if (!mots.length) continue;                          // FSMA, eIDAS, 60 kB, 12m, BE • EUR: technique
      const francais = ACCENTUE.test(c) || MOTS_OUTILAGE.test(c) || mots.some((w) => dictFr.has(w));
      if (francais || mots.length >= 2) out.push({ line: i + 1, texte: c.slice(0, 78) });
    }
  });
  return out;
}

const estStrict = (f) => FLOOR_FILES.includes(f) || STRICT_DIRS.some((d) => f.startsWith(d + "/"));
const sousRegleDure = (f) => FLOOR_DIRS.some((d) => f.startsWith(d + "/")) || FLOOR_FILES.includes(f);

const ACCENTUE = /[éèêëàâäçîïôöûùüœ]/i;
const BRUIT = /(className|style=|href=|src=|url\(|\bpx-|\bpy-|\bmt-|\bmb-|rounded|bg-[a-z]|\btext-(xs|sm|base|lg|xl|\[)|grid|flex|w-\d|h-\d|min-|max-|border|shadow|animate|tracking-|leading-|opacity|pointer-events|select-none|place-items|divide-|sticky|inset|z-\d|overflow|hover:|focus:|disabled:|last:|sm:|md:|lg:)/;

function fichiers(dir) {
  const out = [];
  const base = join(ROOT, dir);
  if (!existsSync(base)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|jsx)$/.test(e)) out.push(full);
    }
  };
  walk(base);
  return out;
}

const clean = (line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

/** Lignes de copie française d'un fichier. */
function copie(texte) {
  const hits = [];
  // Les blocs de documentation sont écrits en français (c'est la langue de travail du projet) et ne
  // sont jamais rendus : sans cette machine à états, une phrase de JSDoc est comptée comme copie
  // d'interface — et le premier qui rencontre le faux positif désactive le contrôle.
  let dansBloc = false;
  texte.split("\n").forEach((raw, i) => {
    let line = raw;
    if (dansBloc) {
      const fin = line.indexOf("*/");
      if (fin === -1) return;
      line = line.slice(fin + 2);
      dansBloc = false;
    }
    for (;;) {
      const debut = line.indexOf("/*");
      if (debut === -1) break;
      const fin = line.indexOf("*/", debut + 2);
      if (fin === -1) { line = line.slice(0, debut); dansBloc = true; break; }
      line = line.slice(0, debut) + " " + line.slice(fin + 2);
    }
    line = clean(line);
    if (!line.trim()) return;
    const candidats = [
      ...[...line.matchAll(/>([^<>{}\n]{3,})</g)].map((m) => m[1]),      // texte JSX
      ...[...line.matchAll(/(["'])((?:(?!\1)[^\\\n]){6,})\1/g)].map((m) => m[2]), // littéraux
    ];
    const ok = candidats.find((c) => {
      const s = c.replace(/&[a-z]+;/gi, " ").trim();
      if (s.split(/\s+/).length < 2) return false;
      if (!ACCENTUE.test(s)) return false;
      if (BRUIT.test(s)) return false;
      // Copie déjà multilingue gérée dans le JSX (`locale === "nl" ? … : …`) : traduite, juste pas
      // par les dictionnaires. La signaler produirait de faux positifs que l'on apprendrait à ignorer.
      if (/\b(locale|lang)\s*[=!]==?/.test(line)) return false;
      return !/^[a-z0-9_\-./:#?&=,%+]+$/i.test(s); // un chemin, une URL ou un identifiant
    });
    if (ok) hits.push({ line: i + 1, texte: ok.replace(/\s+/g, " ").trim().slice(0, 78) });
  });
  return hits;
}

/**
 * Filet supplémentaire, **sans budget** : une chaîne accentuée en position de *défaut de paramètre*
 * (`function CTA({ label = "Voir le détail" })`). Le compteur de copie exige ≥ 2 mots, donc un défaut
 * d'un seul mot français lui passe sous le nez — et c'est justement le piège le plus rentable : le
 * défaut s'affiche dès qu'un appelant omet la prop, sur les quatre marchés à la fois, et il ne peut pas
 * être corrigé par le dictionnaire puisque la valeur est dans la signature. Vu deux fois dans
 * `components/pwa` (`actionLabel = "Opération"`, `label = "Réessayer"`).
 */
/**
 * Filet supplémentaire, **sans budget** : une chaîne accentuée en position de *défaut de prop*
 * (`function CTA({ label = "Voir le détail" })`). Le compteur de copie exige ≥ 2 mots, donc un défaut
 * d'un seul mot français lui passe sous le nez — et c'est justement le piège le plus rentable : le
 * défaut s'affiche dès qu'un appelant omet la prop, sur les quatre marchés à la fois, et il ne peut pas
 * être corrigé par le dictionnaire puisque la valeur est écrite dans la signature. Vu deux fois dans
 * `components/pwa` (`actionLabel = "Opération"`, `label = "Réessayer"`).
 *
 * On ne scanne QUE des listes de paramètres de composants (`function Nom({ … })`, `const Nom = ({ … })`,
 * ou un paramètre simple `function Nom(strategy = "FINANCIAL_DATA")`) : élargir aux attributs JSX
 * ferait matcher `aria-label="…"`, déjà traité par le budget, et le message perdrait sa précision.
 */
const ACCENTUE_I18N = /[éèêëàâäçîïôöûùüœ]/i;
const SIGNATURES = [
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g,      // function Composant({ a = "x", b })
  /\b[A-Za-z_$][\w$]*\s*=\s*\(([^)]*)\)\s*(?::[^=]*)?=>/g, // const Composant = ({ a = "x" }): JSX => …
];
const DEFAUT = /\b([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"/g;

function defautsDeProp(_fichier, texte) {
  const out = [];
  const lignes = texte.split("\n");
  const vus = new Set();
  lignes.forEach((raw, i) => {
    // Une signature s'écrit rarement sur une ligne: on recolle les lignes jusqu'à fermer la parenthèse.
    let bloc = raw;
    for (let j = i; j < Math.min(i + 6, lignes.length) && (bloc.match(/\(/g) || []).length > (bloc.match(/\)/g) || []).length; j++) {
      bloc = bloc + " " + lignes[j + 1];
    }
    for (const re of SIGNATURES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(bloc))) {
        DEFAUT.lastIndex = 0;
        let d;
        while ((d = DEFAUT.exec(m[1]))) {
          if (!ACCENTUE_I18N.test(d[2])) continue;
          const cle = `${i}:${d[1]}`;
          if (vus.has(cle)) continue;
          vus.add(cle);
          out.push({ line: i + 1, prop: d[1], texte: d[2] });
        }
      }
    }
  });
  return out;
}

const rapport = () => {
  const par = new Map();
  for (const dir of SCAN_DIRS) {
    for (const f of fichiers(dir)) {
      const hits = copie(readFileSync(f, "utf8"));
      if (hits.length) par.set(relative(ROOT, f).split("\\").join("/"), hits);
    }
  }
  return par;
};

const budget = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const budgetDe = (f) => (FLOOR_DIRS.some((d) => f.startsWith(d + "/")) || FLOOR_FILES.includes(f) ? 0 : (budget[f] ?? 0));

const args = process.argv.slice(2);
const rel = rapport();

// `--show <fichier>`: liste les lignes comptées, sans faire échouer le build. Indispensable pour
// savoir ce qui RESTE à traduire dans un fichier donné (le budget dit « combien », pas « quoi »).
const showIdx = args.indexOf("--show");
if (showIdx > -1) {
  const cible = args[showIdx + 1];
  const trouvee = [...rel.entries()].filter(([f]) => !cible || f.includes(cible));
  if (!trouvee.length) { console.log(`aucune copie française comptée pour ${cible ?? "(aucun filtre)"}`); process.exit(0); }
  for (const [f, hits] of trouvee) {
    console.log(`\n${f} — ${hits.length} ligne(s) [budget ${budgetDe(f)}]`);
    for (const h of hits) console.log(`  ${String(h.line).padStart(4)}: ${h.texte}`);
  }
  process.exit(0);
}

if (args.includes("--update")) {
  const out = {};
  for (const dir of SCAN_DIRS) for (const [f, hits] of rel) {
    if (!f.startsWith(dir + "/")) continue;
    if (FLOOR_FILES.includes(f) && !hits.length) continue; // zéro durable: pas la peine d'encombrer le budget
    out[f] = hits.length;
  }
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
  console.log(`✔ copy.baseline.json écrit: ${Object.keys(out).length} fichier(s), ${[...rel.values()].reduce((a, h) => a + h.length, 0)} ligne(s) de copie non traduite.`);
  process.exit(0);
}

if (args.includes("--report")) {
  const tri = [...rel.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [f, hits] of tri.slice(0, 20)) console.log(`${String(hits.length).padStart(3)}  ${f}`);
  console.log(`total: ${[...rel.values()].reduce((a, h) => a + h.length, 0)} ligne(s) dans ${rel.size} fichier(s)`);
  const defs = [];
  for (const dir of SCAN_DIRS) for (const f of fichiers(dir)) {
    for (const d of defautsDeProp(relative(ROOT, f).split("\\").join("/"), readFileSync(f, "utf8"))) defs.push(1);
  }
  console.log(`défauts de prop en français: ${defs.length} (règle dure)`);
  process.exit(0);
}

const erreurs = [];

// Défauts de props en français: règle dure, hors budget (un mot seulement ne passe pas le compteur).
const defs = [];
for (const dir of SCAN_DIRS) {
  for (const f of fichiers(dir)) {
    const relNom = relative(ROOT, f).split("\\").join("/");
    for (const d of defautsDeProp(relNom, readFileSync(f, "utf8"))) {
      defs.push(`${relNom}:${d.line}  ${d.prop} = "${d.texte}"`);
    }
  }
}

for (const [f, hits] of rel) {
  const plancher = budgetDe(f);
  if (hits.length > plancher) {
    erreurs.push(
      `${f}: ${hits.length} ligne(s) de copie française pour un budget de ${plancher}\n` +
      hits.slice(0, plancher + 4).map((h) => `    ${h.line}: ${h.texte}`).join("\n") +
      (hits.length > plancher + 4 ? `\n    … ${hits.length - plancher - 4} autre(s)` : "")
    );
  }
}
// Axe strict: uniquement les fichiers sous règle dure. Un texte littéral y est une faute, même sans accent.
const dictFr = vocabulaireFrancais();
const strictes = [];
for (const dir of SCAN_DIRS) {
  for (const f of fichiers(dir)) {
    const relNom = relative(ROOT, f).split("\\").join("/");
    if (!estStrict(relNom) && !sousRegleDure(relNom)) continue;
    for (const h of stricte(readFileSync(f, "utf8"), dictFr)) {
      strictes.push(`${relNom}:${h.line}  ${h.texte}`);
    }
  }
}

for (const f of Object.keys(budget)) {
  if (!rel.has(f) && budget[f] > 0) {
    console.log(`ℹ ${f}: la copie française a disparu (${budget[f]} → 0) — penser à ` + `\`node scripts/check-copy.mjs --update\`.`);
  }
}

if (erreurs.length) {
  console.error(`\n✖ copie non traduite au-dessus du budget (${erreurs.length} fichier(s)):\n`);
  console.error(erreurs.join("\n\n"));
  // Les deux règles partagent la même sortie: n'afficher que la première ferait disparaître la seconde
  // du message, et l'on passerait une correction sous le nez en croyant avoir tout lu.
  if (strictes.length) {
    console.error(`\n… et ${strictes.length} texte(s) littéral(aux) dans un fichier sous règle dure:`);
    console.error(strictes.map((d) => `    ${d}`).join("\n"));
  }
  if (defs.length) {
    console.error(`\n… et ${defs.length} défaut(s) de prop en français (règle dure, hors budget):`);
    console.error(defs.map((d) => `    ${d}`).join("\n"));
  }
  console.error(`\nLes répertoires ${FLOOR_DIRS.join(", ")} (coquilles vues par les 4 langues) sont à zéro.`);
  console.error("Traduire = ajouter la clé dans les 4 dictionnaires (`i18n/{fr,en,nl,de}/*.json`) puis `t(locale, \"ns:cle\")`.");
  console.error("Après une traduction: `node scripts/check-copy.mjs --update` (le budget ne peut que baisser).\n");
  process.exit(1);
}
if (strictes.length) {
  console.error(`\n✖ ${strictes.length} texte(s) JSX littéral(aux) dans un fichier promis « zéro copie en dur »:`);
  console.error(strictes.map((d) => `    ${d}`).join("\n"));
  console.error("\nDans ces fichiers, tout texte passe par un dictionnaire — `t(locale, \"ns:cle\")`. Un cas assumé (wordmark, énumération de langues, nom d'API) se marque `// check-copy:ignore` sur la ligne, jamais avec un budget.\n");
  process.exit(1);
}
if (defs.length) {
  console.error(`\n✖ ${defs.length} défaut(s) de prop en français (règle dure, aucun budget possible):`);
  console.error(defs.map((d) => `    ${d}`).join("\n"));
  console.error("\nUn défaut écrit dans la signature ne peut pas être traduit: passez la prop optionnelle et resolvez la valeur avec `t(\"…\")` dans le corps.\n");
  process.exit(1);
}
console.log(`✔ check-copy: aucune copie française nouvelle (budget par fichier respecté, coquilles et ${FLOOR_FILES.length} fichier(s) à zéro).`);
