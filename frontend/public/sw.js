/* KREDIT — service worker v9 (slice PWA).
 *
 * Règles de survie, verrouillées par scripts/check-hydration.mjs et scripts/check-state.mjs :
 *  1. jamais de document HTML en PRECACHE (périmé au déploiement suivant → hydration mismatch) :
 *     uniquement assets immuables + les pages /offline ;
 *  2. jamais de chunk /_next/ sans hash de build en cache (webpack.js change à chaque compile →
 *     « reading 'call' ») : la classification passe par assetHache() ;
 *  3. jamais d'écriture en cache sans la garde reponseCacheable (no-store/no-cache = dev et HTML) ;
 *  4. un seul appel respondWith, dans le helper repondre qui force une Response
 *     (Response.error en dernier recours) — une panne réseau ne doit pas devenir page blanche ;
 *  5. jamais enregistré hors production (components/pwa/SWRegister.tsx).
 *
 * Sécurité hors-ligne : les pages personnelles (/account) ne sont JAMAIS mises en cache ; les
 * données financières ne vivent que dans le localStorage de l'appareil, jamais dans le worker.
 */
const VERSION = "kredit-v9";
const CORE = "kredit-" + VERSION + "-core";
const PAGES = "kredit-" + VERSION + "-pages";
const ASSETS = "kredit-" + VERSION + "-assets";

const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-72.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/fr/offline",
  "/en/offline",
  "/nl/offline",
  "/de/offline",
];

function versResponse(valeur) { return valeur instanceof Response ? valeur : Response.error(); }
function repondre(event, valeur) { event.respondWith(versResponse(valeur)); }

/* Un chunk est durable s'il porte son hash de build dans le nom ; webpack.js, main-app.js et les
   page.js non hachés sont exclus d'office. */
function assetHache(url) {
  const u = new URL(url, self.location.href);
  if (!u.pathname.startsWith("/_next/static/")) return false;
  const nom = u.pathname.split("/").pop() || "";
  return /[.-][0-9a-f]{8,}\.(js|css)$/.test(nom);
}
function isStaticAsset(url) {
  const u = new URL(url, self.location.href);
  if (u.pathname.startsWith("/_next/static/")) return assetHache(url);
  return /^\/(icons|images)\//.test(u.pathname) || u.pathname === "/favicon.ico" || u.pathname === "/manifest.webmanifest";
}

function reponseCacheable(reponse) {
  if (!reponse || reponse.status !== 200 || reponse.type !== "basic") return false;
  const cc = (reponse.headers.get("cache-control") || "").toLowerCase();
  return !cc.includes("no-store") && !cc.includes("no-cache");
}

self.addEventListener("install", (event) => {
  repondre(event, caches.open(CORE).then((c) => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  repondre(
    event,
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith("kredit-") && !c.startsWith("kredit-" + VERSION)).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* Navigations : réseau d'abord ; hors-ligne, la dernière visite publique ou la page /offline de
   la langue demandée. /account (données personnelles) n'est jamais écrit dans le worker. */
async function navigation(req, url) {
  try {
    const reponse = await fetch(req);
    if (reponseCacheable(reponse) && !url.pathname.includes("/account") && !url.pathname.includes("/offline")) {
      const cache = await caches.open(PAGES);
      await cache.put(req, reponse.clone());
    }
    return reponse;
  } catch (e) {
    const cache = await caches.open(PAGES);
    const deja = await cache.match(req);
    if (deja) return deja;
    const segment = url.pathname.split("/")[1] || "";
    const locale = ["fr", "en", "nl", "de"].includes(segment) ? segment : "fr";
    const secours = await caches.match("/" + locale + "/offline");
    return secours || Response.error();
  }
}

/* Assets hachés / médias : cache d'abord, réseau en secours, rafraîchissement en arrière-plan. */
async function statique(req) {
  const cache = await caches.open(ASSETS);
  const deja = await cache.match(req);
  const reseau = fetch(req)
    .then((reponse) => {
      if (reponseCacheable(reponse)) cache.put(req, reponse.clone());
      return reponse;
    })
    .catch(() => deja || Response.error());
  return deja || reseau;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") { repondre(event, navigation(req, url)); return; }
  if (isStaticAsset(req.url)) { repondre(event, statique(req)); return; }
  repondre(event, fetch(req));
});
