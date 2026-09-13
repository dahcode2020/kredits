#!/usr/bin/env node
/**
 * Vérificateur d'imbrication JSX/HTML (zéro dépendance).
 *
 * Pourquoi c'est un problème d'HYDRATATION : le parseur HTML du navigateur « répare » le
 * markup invalide (un <div> dans un <p> ferme le <p>, un <li> hors <ul> est remonté, un
 * <button> dans un <a> est extrait…). Le DOM que React trouve à l'hydratation n'est donc plus
 * celui que l'arbre React attend → « Hydration failed because the initial UI does not match
 * what was rendered on the server » / « Did not expect server HTML to contain a <div> in <p> ».
 * `next build` ne le signale pas : seul un parseur HTML le voit.
 *
 *   node scripts/check-dom-nesting.mjs        # exit 1 si imbrication invalide
 *
 * Heuristique : balaye le flux de balises JSX en ordre documentaire (commentaires, chaînes et
 * template literals retirés). Les composants (<Card>) sont opaques : si l'un d'eux rend un <p>,
 * l'anomalie est à corriger dans ce composant.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIRS = ["app", "components", "features"];

/** Blocs interdits dans un <p> (le parseur ferme le <p> avant de les ouvrir). */
const BLOCK_IN_P = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "main", "nav",
  "ol", "p", "pre", "section", "table", "ul",
]);
/** Contenu interactif : interdit à l'intérieur de <a> / <button>. */
const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "iframe", "label", "summary"]);
/** Éléments dont le parent est imposé par la spec HTML. */
const REQUIRES_PARENT = {
  li: ["ul", "ol", "menu"],
  tr: ["table", "thead", "tbody", "tfoot"],
  td: ["tr"],
  th: ["tr"],
  option: ["select", "datalist", "optgroup"],
  optgroup: ["select"],
  caption: ["table"],
  colgroup: ["table"],
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
  figcaption: ["figure"],
  summary: ["details"],
  row: ["rowgroup"],
};
/** Nos composants maison qui rendent un élément HTML cible. */
const TAG_ALIAS = { Link: "a", Button: "button", Image: "img" };
/** Enveloppes « inline » qui autorisent le passage au travers d'un <p>. */
const INLINE_WRAPPERS = new Set(["a", "button", "span", "code", "strong", "em", "small", "label", "time", "abbr", "u", "b", "i", "mark", "sub", "sup"]);

function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length))
    .replace(/`[\s\S]*?`/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(["'])((?:\\.|(?!\1).)*)\1/g, (m) => " ".repeat(m.length));
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx|jsx)$/.test(e)) yield p;
  }
}

const problems = [];

for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).split("\\").join("/");
    const src = stripNoise(readFileSync(file, "utf8"));
    const stack = [];
    const tagRe = /<\s*(\/?)\s*([A-Za-z][\w.]*)([^>]*?)(\/?)>/g;
    let m;
    while ((m = tagRe.exec(src))) {
      const [, closing, rawTag, , selfClose] = m;
      const aliased = TAG_ALIAS[rawTag];
      if (/^[A-Z]/.test(rawTag) && !aliased) continue; // composant opaque
      const tag = aliased ?? rawTag;
      const line = src.slice(0, m.index).split("\n").length;
      if (selfClose && !closing) continue;

      if (closing) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) { stack.length = i; break; }
        }
        continue;
      }

      const parents = stack.map((s) => s.tag);
      const parent = parents[parents.length - 1];

      if (BLOCK_IN_P.has(tag)) {
        const pIdx = parents.lastIndexOf("p");
        if (pIdx > -1) {
          const between = parents.slice(pIdx + 1);
          if (between.every((t) => INLINE_WRAPPERS.has(t))) {
            problems.push({
              rel, line, tag,
              msg: `<${tag}> dans un <p>${between.length ? ` (via <${between.join(">/<")}>)` : ""} : le parseur HTML ferme le <p> avant d'ouvrir <${tag}> → le DOM hydraté ne correspond plus à l'arbre React`,
            });
          }
        }
      }

      if ((parent === "a" || parent === "button") && INTERACTIVE.has(tag)) {
        problems.push({
          rel, line, tag,
          msg: `<${tag}> (contenu interactif) dans <${parent}> : le navigateur extrait/réécrit le markup — remplacer l'un des deux (ex. <${parent}> parent en <div> + liens imbriqués interdits)`,
        });
      }

      const required = REQUIRES_PARENT[tag];
      if (required && !parents.some((p) => required.includes(p))) {
        problems.push({
          rel, line, tag,
          msg: `<${tag}> sans parent valide (attendu : ${required.join(" | ")}) : le parseur le remonte hors du flux`,
        });
      }

      stack.push({ tag, line });
    }
  }
}

if (problems.length) {
  console.error(`\n✖ ${problems.length} imbrication(s) HTML invalide(s) — sources de mismatch d'hydratation :\n`);
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  <${p.tag}>\n    → ${p.msg}\n`);
  console.error("Corriger le balisage ; jamais avec suppressHydrationWarning. Voir docs/hydration.md\n");
  process.exit(1);
}
console.log("✔ check-dom-nesting : aucune imbrication HTML invalide détectée dans app/, components/, features/.");
