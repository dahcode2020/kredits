#!/usr/bin/env node
/**
 * check:state — l'état du poste, pas celui du code.
 *
 * Écrit parce qu'une classe de panne résiste à tout ce qu'on peut prouver dans le dépôt: le serveur
 * répond 200 sur chaque route, chaque ressource référencée par le HTML est servie, `next build` passe,
 * et pourtant le navigateur meurt sur « Cannot read properties of undefined (reading 'call') » dans
 * `options.factory`, identiquement à chaque rechargement. Dans cet état, la cause n'est ni dans une
 * source ni dans le serveur: c'est le dossier compilé et le cache du navigateur qui ne sont plus
 * d'accord. Ce script les compare, et dit lequel des cinq états on occupe.
 *
 * Il répond aussi à la question qui bloque tout le reste: le correctif est-il réellement dans
 * l'arbre de la machine qui souffre (le pull est-il arrivé, le serveur a-t-il redémarré après)?
 *
 *   node scripts/check-state.mjs [--base http://localhost:3000] [--detail] [--dist .next-dev]
 *
 * Sortie: 0 si rien de rouge, 1 sinon. Aucune dépendance, aucun réseau hors le localhost sondé.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  if (i === -1) return dflt;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
};
const VERBOSE = !!flag("detail", false) || !!flag("verbose", false) || !!process.env.CHECK_STATE_DETAIL;
const BASE = String(flag("base", process.env.KREDIT_BASE || "http://localhost:3000")).replace(/\/$/, "");
const DIST_FORCÉ = flag("dist", null);

const lignes = [];
let COURANT = "divers";
const nom = (s) => s.replace(FRONT + "/", "");
const section = (titre) => {
  COURANT = titre;
};
const pousser = (niveau, m) => lignes.push({ s: COURANT, niveau, m });
const pOk = (m) => pousser("ok", m);
const pWarn = (m) => pousser("attention", m);
const pRouge = (m) => pousser("ROUGE", m);

const swVersion = (contenu) => {
  const m = /VERSION\s*=\s*["']kredit-v(\d+)["']/.exec(contenu || "");
  return m ? Number(m[1]) : null;
};

/** Mtime le plus récent sous `dir`, en ignorant les dossiers lourds. `limite` = garde-fou. */
function mtimeMax(dir, filtre, limite = 40000) {
  const racine = path.isAbsolute(dir) ? dir : path.join(FRONT, dir);
  let meilleur = 0;
  let nomMeilleur = null;
  let vus = 0;
  const pile = fs.existsSync(racine) ? [racine] : [];
  while (pile.length) {
    const d = pile.pop();
    let entrees;
    try {
      entrees = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "cache") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        pile.push(p);
        continue;
      }
      if (++vus > limite) return { t: meilleur, fichier: nomMeilleur, tronc: true };
      if (filtre && !filtre(p)) continue;
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs > meilleur) {
          meilleur = st.mtimeMs;
          nomMeilleur = p;
        }
      } catch {
        /* fichier disparu entre le readdir et le stat */
      }
    }
  }
  return { t: meilleur, fichier: nomMeilleur, tronc: false };
}

const anc = (t) => (t ? new Date(t).toISOString().slice(0, 19).replace("T", " ") : "absent");

// ---------------------------------------------------------------- 1. l'arbre
section("Arbre de travail");

let head = "(git indisponible)";
try {
  head = execFileSync("git", ["-C", path.join(FRONT, ".."), "log", "-1", "--format=%h | %ad | %s", "--date=iso-local"], {
    encoding: "utf8",
  }).trim();
} catch {
  /* pas un dépôt git: on continue sans cette ligne */
}
pOk("HEAD = " + head);

const FICHIERS = {
  sw: path.join(FRONT, "public/sw.js"),
  layout: path.join(FRONT, "app/layout.tsx"),
  config: path.join(FRONT, "next.config.js"),
  packageRacine: path.join(FRONT, "..", "package.json"),
};
const lu = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

const sw = lu(FICHIERS.sw);
const v = swVersion(sw);
// Slice 1: pas de service worker (la slice PWA l'installera, avec les contrôles qui vont avec).
// L'absence est un état NORMAL ici — signalée verte, pas rouge; dès que public/sw.js existe,
// l'exigence de version redevient pleine.
const aSw = fs.existsSync(FICHIERS.sw);
if (!aSw) {
  pOk("public/sw.js absent — slice PWA pas encore installée: les contrôles de version du worker sont sautés.");
} else if (v === null) {
  pRouge("public/sw.js: pas de VERSION « kredit-vN » reconnaissable — le worker n'est plus celui du dépôt.");
} else if (v < 8) {
  pRouge(
    "public/sw.js servi depuis l'arbre = version v" + v + " ; le correctif « respondWith forcé à une Response » est v8. " +
      "Le pull n'est pas arrivé sur cette machine: tout ce qui suit mesure un arbre périmé.",
  );
} else {
  pOk("public/sw.js = v" + v + " (le correctif respondWith est dans l'arbre).");
}

const layout = lu(FICHIERS.layout);
if (!aSw) {
  if (layout.includes("kredit-dev-sw-heal")) pWarn("app/layout.tsx rend le script d'auto-réparation alors que public/sw.js n'existe pas.");
  else pOk("app/layout.tsx sans script d'auto-réparation — cohérent avec l'absence de worker.");
} else if (!layout.includes("kredit-dev-sw-heal")) {
  pRouge(
    "app/layout.tsx ne rend pas le script d'auto-réparation (id « kredit-dev-sw-heal »). Soit le pull n'est pas arrivé, " +
      "soit vous ouvrez une route qui ne passe pas par ce layout.",
  );
} else {
  pOk("app/layout.tsx rend le script d'auto-réparation.");
}
if (!fs.existsSync(FICHIERS.packageRacine)) {
  pWarn(
    "Pas de package.json à la racine: `npm run <script>` depuis la racine du monorepo échoue en ENOENT. " +
      "Il faut `cd frontend` (ou un package.json relais à la racine, présent depuis le commit qui ajoute ce contrôle).",
  );
}

// ---------------------------------------------------------------- 2. le dossier compilé
section("Dossier compilé");

const config = lu(FICHIERS.config);
const distIsolé = /distDir:\s*process\.env\.NODE_ENV\s*===\s*["']production["']\s*\?\s*["']\.next["']\s*:\s*["']\.next-dev["']/.test(config);
const dev = ["development", "test", undefined, ""].includes(process.env.NODE_ENV) || !distIsolé;
const dist = DIST_FORCÉ ? String(DIST_FORCÉ) : distIsolé && process.env.NODE_ENV === "production" ? ".next" : ".next-dev";

const dossiers = [".next", ".next-dev"].filter((d) => fs.existsSync(path.join(FRONT, d)));
if (!dossiers.length) {
  pWarn("Ni .next ni .next-dev: rien de compilé sur ce poste (`npm run dev` ou `npm run build` à lancer).");
}

const aUnBUILD_ID = fs.existsSync(path.join(FRONT, ".next/BUILD_ID"));
const chunksDe = (d) => path.join(FRONT, d, "static/chunks");
const aDesChunksHachés = (d) => {
  const p = chunksDe(d);
  if (!fs.existsSync(p)) return false;
  return fs.readdirSync(p).some((f) => /^main-[A-Za-z0-9_-]+\.js$/.test(f));
};
const aUnMainApp = (d) => fs.existsSync(path.join(chunksDe(d), "main-app.js"));

if (!distIsolé) {
  pWarn(
    "next.config.js n'isole pas encore le dev de la production (pas de `distDir` conditionnel): un " +
      "`npm run build` écrase les chunks que votre `next dev` a en mémoire. Ce mélange produit exactement la panne " +
      "« reading 'call' ». Après un pull, le serveur doit être redémarré: next.config.js n'est lu qu'au démarrage.",
  );
} else {
  pOk("next.config.js: dev dans .next-dev, production dans .next (les deux ne peuvent plus s'écraser).");
}

if (aUnBUILD_ID && aUnMainApp(".next")) {
  pRouge(
    ".next contient un build de production (BUILD_ID) ET des chunks de dev (static/chunks/main-app.js): les deux " +
      "compilations ont partagé le même dossier. Le runtime webpack chargé par le navigateur vient d'une compilation, " +
      "le HTML qui référence les modules vient de l'autre. Réparation: npm run fresh.",
  );
} else if (aUnBUILD_ID && aDesChunksHachés(".next")) {
  pOk(".next = build de production cohérent (BUILD_ID + chunks hachés).");
}
const residuDeDev = !aUnBUILD_ID && aUnMainApp(".next");
if (residuDeDev && distIsolé) {
  pWarn(
    ".next ne contient que des artefacts de dev (pas de BUILD_ID) : résidu d'avant l'isolation distDir. " +
      "Inoffensif maintenant que le dev écrit dans .next-dev, mais à jeter: npm run fresh -- --prod.",
  );
} else if (fs.existsSync(path.join(FRONT, ".next/server")) && !aUnBUILD_ID) {
  pRouge(".next/server existe sans .next/BUILD_ID et sans trace de dev: build de production interrompu. `rm -rf .next` puis rebuild.");
}

if (distIsolé && process.env.NODE_ENV !== "production" && !fs.existsSync(path.join(FRONT, ".next-dev")) && fs.existsSync(path.join(FRONT, ".next"))) {
  pWarn(
    "Vous lancez le dev mais seul .next existe: le serveur en cours a démarré AVANT la mise à jour de next.config.js " +
      "(il est lu au démarrage uniquement). Arrêtez-le et relancez, ou lancez npm run fresh.",
  );
}

// ---------------------------------------------------------------- 3. fraîcheur de la compilation
section("Fraîcheur de la compilation");

const sources = [
  ["app", (p) => /\.(tsx|ts|jsx|js)$/.test(p)],
  ["components", (p) => /\.(tsx|ts|jsx|js)$/.test(p)],
  ["features", (p) => /\.(tsx|ts|jsx|js)$/.test(p)],
  ["lib", (p) => /\.(tsx|ts|jsx|js)$/.test(p)],
  ["i18n", (p) => /\.json$/.test(p)],
  ["next.config.js", null],
];
let src = { t: 0, fichier: null };
for (const [d, f] of sources) {
  const r = mtimeMax(d, f ?? undefined);
  if (r.t > src.t) src = r;
}
const compile = mtimeMax(dist, (p) => /\.js$/.test(p));
if (!compile.t) {
  pWarn("Aucun chunk dans " + dist + "/static/chunks: le serveur n'a encore rien compilé pour ce dossier.");
} else {
  const delta = (src.t - compile.t) / 1000;
  if (src.t && delta > 90) {
    pRouge(
      "La source la plus récente (" + nom(src.fichier) + ", " + anc(src.t) + ") est plus récente de " +
        Math.round(delta) + "s que le chunk le plus récent de " + dist + " (" + anc(compile.t) + "). Le compilateur n'a " +
        "pas suivi: watcher inactif (volume monté, inotify saturé) ou fichiers modifiés hors de l'éditeur. Le HTML " +
        "servi peut alors référencer des modules que les chunks sur disque ne contiennent pas. Réparation: npm run fresh.",
    );
  } else if (src.t) {
    pOk("Compilation à jour: les chunks de " + dist + " sont plus récents que les sources de " + Math.abs(Math.round(delta)) + "s.");
  }
  try {
    const max = Number(fs.readFileSync("/proc/sys/fs/inotify/max_user_watches", "utf8").trim());
    if (max < 131072) {
      pWarn(
        "/proc/sys/fs/inotify/max_user_watches = " + max + " : bas pour un monorepo. Si le watcher ne réagit plus, " +
          "`sudo sysctl fs.inotify.max_user_watches=524288` puis npm run fresh.",
      );
    } else {
      pOk("inotify max_user_watches = " + max + ".");
    }
  } catch {
    /* hors Linux: rien à dire */
  }
}

// ---------------------------------------------------------------- 4. ce que le serveur répond vraiment
section("Ce que le serveur répond");

// Un sondeur, deux besoins: lire du HTML (donc chercher une chaîne) et lire une ressource
// opaque (compter ses octets). `corps` n'est rempli que pour text/html: sans ce garde-fou j'ai
// déclaré « sw.js non lisible » sur un worker parfaitement servi, parce que /sw.js part en
// application/javascript et que je ne demandais le texte que dans ce seul cas.
const sonde = async (u, { html = false } = {}) => {
  try {
    const r = await fetch(BASE + u, { signal: AbortSignal.timeout(6000), headers: { "cache-control": "no-cache" } });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    const lisible = html ? ct.includes("text/html") : true;
    return { code: r.status, taille: buf.length, octets: buf, corps: lisible ? buf.toString("utf8") : null, ct };
  } catch (e) {
    return { erreur: (e && e.cause && e.cause.code) || (e && e.name) || "injoignable" };
  }
};

const html = await sonde("/fr", { html: true });
if (html.erreur) {
  pWarn(
    "Aucun serveur sur " + BASE + " (" + html.erreur + ") : les contrôles « ce qui est réellement servi » et « écart disque/réseau » " +
      "sautent. Lancez npm run dev dans un autre terminal, ou passez --base http://localhost:PORT.",
  );
} else {
  pOk("GET " + BASE + "/fr -> " + html.code);
  if (html.code !== 200) pRouge("La page d'accueil répond " + html.code + ", pas 200.");
  if (html.corps && html.corps.includes("kredit-dev-sw-heal")) pOk("Le HTML SERVI contient bien le script d'auto-réparation (le serveur a démarré sur l'arbre à jour).");
  else if (html.corps && aSw) pRouge("Le HTML servi ne contient pas « kredit-dev-sw-heal » alors que app/layout.tsx le rend: ce serveur a été démarré avant le pull. Redémarrez-le (npm run fresh).");
  else if (html.corps) pOk("Le HTML servi ne contient pas le script d'auto-réparation — cohérent, pas de worker dans cet arbre.");

  for (const url of ["/_next/static/chunks/webpack.js", "/_next/static/chunks/main-app.js"]) {
    const sur = await sonde(url);
    if (sur.erreur) {
      pRouge("Ressource " + url + " injoignable (" + sur.erreur + ").");
      continue;
    }
    // Comparé à TOUS les dossiers compilés du poste, pas seulement celui que je crois actif: un
    // `--dist` approximatif, un serveur démarré avant le changement de distDir, ou un `.next` résiduel
    // produisaient un rouge mensonger (taille identique, contenu différent parce qu'il vient d'une autre
    // compilation). Si AUCUN dossier ne correspond, là c'est rouge, et je liste ce qui a été consulté.
    const dossiersALire = [...new Set([dist, ...dossiers])].filter((d) => fs.existsSync(path.join(FRONT, d)));
    const candidats = dossiersALire.map((d) => path.join(FRONT, d, "static/chunks", path.basename(url))).filter((f) => fs.existsSync(f));
    if (!candidats.length) {
      pWarn(url + " servi (" + sur.code + ") mais introuvable sur disque dans " + (dossiersALire.join(" / ") || "aucun dossier compilé") + " — normal si le serveur tourne ailleurs que sur ce poste.");
      continue;
    }
    const identique = candidats.find((f) => Buffer.compare(fs.readFileSync(f), sur.octets) === 0);
    if (sur.code !== 200) {
      pRouge(url + " répond " + sur.code + " alors que le fichier existe sur disque (" + nom(candidats[0]) + "): un service worker ou un proxy répond à la place du serveur.");
    } else if (!identique) {
      const tailles = candidats.map((f) => nom(f) + " = " + fs.statSync(f).size).join(", ");
      pRouge(
        url + " servi en " + sur.taille + " octets ne correspond octet pour octet à AUCUN fichier du poste (" + tailles +
          "). Le chemin entre le navigateur et le serveur ment: service worker encore actif, cache HTTP, ou port " +
          "tenu par un serveur plus ancien que les fichiers. Réparation: npm run fresh, puis recharger deux fois " +
          "(à défaut: DevTools > Application > Service Workers > Unregister + Bypass for network).",
      );
    } else {
      pOk(url + " = octet pour octet " + nom(identique) + " (" + sur.taille + " octets).");
    }
  }
  if (aSw) {
    const swServi = await sonde("/sw.js");
    const vServi = swServi.corps ? swVersion(swServi.corps) : null;
    if (vServi === null) {
      pWarn(
        "sw.js sur " + BASE + " ne répond pas avec un VERSION lisible" +
          (swServi.erreur ? " (" + swServi.erreur + ")" : " (statut " + swServi.code + ", type " + (swServi.ct || "?") + ")") +
          " — soit le serveur ne sert pas public/, soit le worker est intercepté ailleurs.",
      );
    }
    else if (v !== null && vServi !== v) pRouge("Le worker SERVI est v" + vServi + " alors que l'arbre est v" + v + ": l'onglet a un worker plus ancien que le code. Rechargez une 2e fois (le script d'auto-réparation fait ce travail), ou npm run fresh.");
    else pOk("Worker servi et arbre d'accord (v" + vServi + ").");
  }
}

// ---------------------------------------------------------------- sortie
const nb = (n) => lignes.filter((l) => l.niveau === n).length;
console.log("");
for (const titre of [...new Set(lignes.map((l) => l.s))]) {
  const du = lignes.filter((l) => l.s === titre && (VERBOSE || l.niveau !== "ok"));
  if (!du.length) continue;
  console.log(titre);
  for (const l of du) console.log("  [" + (l.niveau === "ok" ? "ok       " : l.niveau === "attention" ? "attention" : "ROUGE    ") + "] " + l.m);
}
const verts = nb("ok");
if (verts) console.log("(+" + verts + " contrôle(s) vert(s) masqués — détail: --detail)");
console.log(
  "\ncheck:state: " + verts + " vert(s), " + nb("attention") + " attention(s), " + nb("ROUGE") + " rouge(s)" +
    " — dossier compilé: " + (dossiers.length ? dossiers.join(" + ") : "aucun") + ".",
);
if (nb("ROUGE")) {
  console.log(
    "Ordre de réparation: (1) git -C .. log --oneline -1 pour vérifier que le pull est arrivé, (2) npm run fresh, " +
      "(3) recharger l'onglet DEUX fois (le premier échoue, le second est réparé), (4) si le rouge survit, " +
      "npm run check:assets et m'envoyer la première ligne rouge de Console.",
  );
}
process.exit(nb("ROUGE") ? 1 : 0);
