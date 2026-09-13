#!/usr/bin/env node
/**
 * npm run fresh — remettre l'environnement de dev à zéro, sans taper cinq commandes.
 *
 * Fait, dans cet ordre:
 *   1. repère les processus next de CE projet: la ligne de commande contient « next », et le cwd
 *      réel du processus (/proc/<pid>/cwd) est frontend/ ou un de ses sous-dossiers. Ce second
 *      critère est ce qui empêche de tuer le serveur d'un autre dépôt ouvert dans la même session —
 *      `ps` seul ne suffit pas, Next réécrit son titre en « next-server (v14…) » sans aucun chemin;
 *   2. les arrête (SIGTERM, puis SIGKILL après 3 s si besoin) — sans ça, le `next dev` relancé meurt
 *      en EADDRINUSE et on croit que « le code ne marche pas »;
 *   3. supprime le dossier compilé du dev (.next-dev, et .next avec --all) — la panne « reading
 *      'call' » persistante vient d'un dossier compilé qui n'est plus d'accord avec le HTML servi,
 *      et un reload ne peut pas réparer des fichiers sur disque;
 *   4. relance `npm run dev` dans ce terminal (Ctrl-C pour l'arrêter).
 *
 * Options (à passer avec `npm run fresh -- --look` etc.):
 *   --look   montre ce qui serait fait, ne touche rien (alias --dry-run, mais npm l'avale)
 *   --keep   nettoie sans relancer le serveur (alias --no-start)
 *   --prod   inclut le build de production (.next) au nettoyage (alias --all)
 *   --detail liste les processus ignorés (alias --verbose, avalé par npm aussi)
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const argv = process.argv.slice(2);
const a = (...noms) => noms.some((n) => argv.includes("--" + n));
// Noms courts d'abord: `npm run fresh -- --verbose` ne fonctionne PAS, npm réserve --verbose (et
// --dry-run) comme ses propres configs et ne les transmet pas au script. Les anciens noms restent
// acceptés pour `node scripts/fresh.mjs --dry-run`, appelé directement.
const DRY = a("look", "dry-run");
const ALL = a("prod", "all");
const VERBOSE = a("detail", "verbose");
const NO_START = a("keep", "no-start");

const dit = (m) => console.log(m);
const pu = (m) => console.log("  " + m);

const titre = (pid) => {
  try {
    return fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\0/g, " ").trim();
  } catch {
    return null;
  }
};
const estIci = (pid) => {
  try {
    const cwd = fs.realpathSync("/proc/" + pid + "/cwd");
    return cwd === FRONT || cwd.startsWith(FRONT + path.sep);
  } catch {
    return false;
  }
};

let table = "";
try {
  table = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
} catch {
  dit("[!] `ps` indisponible: aucun processus ne sera arrêté — arrêtez le serveur à la main.");
}

const victimes = [];
for (const ligne of table.split("\n")) {
  const m = /^\s*(\d+)\s+(.*)$/.exec(ligne);
  if (!m) continue;
  const pid = Number(m[1]);
  const cmd = m[2];
  if (pid === process.pid) continue;
  if (!/next[- ]?(dev|start|-server)|\.bin\/next|node.*\/next\b/.test(cmd)) continue;
  if (!estIci(pid)) {
    if (VERBOSE) pu("(ignoré, autre projet) pid " + pid);
    continue;
  }
  if (!ALL && /\bnext start\b/.test(cmd) && !/next-server|next dev/.test(cmd)) {
    pu("(ignoré, serveur de production; --all pour l'inclure) pid " + pid);
    continue;
  }
  victimes.push({ pid, cmd });
}

dit("npm run fresh — remise à zéro du dev");
pu("projet: " + FRONT);
if (!victimes.length) pu("aucun serveur next de ce projet en cours");
if (DRY) pu("mode --look: aucun processus tué, aucun dossier supprimé");
for (const v of victimes) pu((DRY ? "trouvé: " : "arrêt: ") + "pid " + v.pid);

for (const v of victimes) {
  if (DRY) continue;
  try {
    process.kill(v.pid, "SIGTERM");
  } catch (e) {
    pu("pid " + v.pid + ": " + e.code);
  }
}
if (victimes.length && !DRY) {
  const echeance = Date.now() + 3000;
  while (Date.now() < echeance) {
    const vivants = victimes.filter((v) => {
      try {
        process.kill(v.pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!vivants.length) break;
    spawnSync("sleep", ["0.2"]);
  }
  for (const v of victimes) {
    try {
      process.kill(v.pid, "SIGKILL");
      pu("pid " + v.pid + " encore vivant: SIGKILL");
    } catch {
      /* déjà parti: le cas normal */
    }
  }
}

const cibles = ALL ? [".next-dev", ".next"] : [".next-dev"];
for (const d of cibles) {
  const p = path.join(FRONT, d);
  if (!fs.existsSync(p)) {
    pu("dossier " + d + ": absent");
    continue;
  }
  let n = "?";
  try {
    n = execFileSync("sh", ["-c", "find \"$1\" | wc -l", "sh", p], { encoding: "utf8" }).trim();
  } catch {
    /* find indisponible: on ne bloque pas le nettoyage pour un compteur */
  }
  if (DRY) {
    pu("dossier " + d + ": " + n + " entrée(s) — dry-run, non supprimé");
    continue;
  }
  fs.rmSync(p, { recursive: true, force: true });
  pu("dossier " + d + ": supprimé (" + n + " entrée(s))");
}

if (DRY || NO_START) {
  dit("\n" + (DRY ? "[dry-run] rien n'a été modifié." : "Nettoyé, serveur non relancé (--no-start)."));
  dit("Ensuite: `npm run dev`, puis recharger l'onglet DEUX fois — le premier installe la réparation du");
  dit("worker, le second est propre. Vérifier: `npm run check:state`.");
  process.exit(0);
}

dit("\nRelance de `next dev` dans ce terminal (Ctrl-C pour l'arrêter)…");
const r = spawnSync("npm", ["run", "dev"], { cwd: FRONT, stdio: "inherit" });
process.exit(r.status == null ? 1 : r.status);
