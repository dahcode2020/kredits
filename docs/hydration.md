# Hydratation SSR ↔ client — règles et correctifs

Erreur observée :

```
Error: Hydration failed because the initial UI does not match what was rendered on the server.
```

En App Router (Next 14 / React 18), cette erreur signifie une seule chose : **le premier
rendu du client ne reproduit pas le HTML envoyé par le serveur**. React ne « rattrape » pas
l'écart : il jette l'arbre et re-rend tout (d'où le flash et les corrections qui
« disparaissent au refresh »).

## 1. Lire le warning au-dessus de l'overlay

| Warning React | Cause |
|---|---|
| `Text content did not match. Server: "…" Client: "…"` | formatage (locale/`Intl`/dates) ou i18n non aligné |
| `Extra attributes from the server HTML: class, style` | attribut muté hors React (thème, extension navigateur) |
| `Did not expect server HTML to contain a <div> in <div>` | arbre différent : rendu conditionnel lié à `window`, `localStorage`, SW, portal |
| `validateDOMNesting` | HTML invalide : le navigateur corrige le HTML, React hydrate l'original |
| aucun autre warning | écart de structure (voir §2) |

L'overlay peut aussi porter une erreur purement runtime, sans warning React : **`TypeError: Cannot read
properties of undefined (reading 'call')`** avec `options.factory` dans la pile, pointant sur
`.next/static/chunks/webpack.js`. Ce n'est pas un mismatch : le runtime webpack servi au navigateur ne
connaît pas les identifiants de modules des chunks en cours (règle 12).

## 2. Règles appliquées dans ce dépôt

1. **Aucune API navigateur pendant le render** d'un client component
   (`window`, `document`, `localStorage`, `navigator`, `Notification`, `matchMedia`).
   Le serveur renvoie une valeur, le navigateur une autre → mismatch. À déplacer dans un
   `useEffect` (ou `useSyncExternalStore` avec un snapshot serveur explicite).
   → corrigé dans `hooks/usePushNotifications.ts`, `components/pwa/PushManager.tsx`, `hooks/useLocale.ts`.

2. **Pas de branche de rendu sur l'environnement** : `if (typeof window !== 'undefined') return <A/>`
   sert `<B/>` côté serveur. Rendre le même arbre (placeholder de même forme) puis ajuster.
   → corrigé dans `components/pwa/PushManager.tsx`, et le pattern `hasHydrated` des shells
   (`AdminShell`, `CustomerShell`, `Header`) qui rend **le même skeleton** au premier rendu client.

3. **Locale Intl explicite partout + sorties normalisées** : jamais `toLocaleString()`, `toLocaleDateString()` ni
   `new Intl.NumberFormat(undefined, …)` — la locale par défaut du runtime diffère entre le
   conteneur Node et le navigateur. Utiliser `localeToIntl[locale]` (`lib/formatters.ts`).
   Dates : `timeZone: 'Europe/Brussels'` forcé (déjà le cas dans `lib/formatters.ts`) ;
   corrigé dans `components/credit/Simulator.tsx` qui écrivait `"fr-BE"` en dur.

4. **Valeurs « maintenant »** (année, heure relative, date du jour) : rendues seulement après
   hydratation, sinon le serveur (UTC) et le navigateur (UTC+1/+2) peuvent changer de jour.
   → `components/layout/Footer.tsx` (l'année n'est plus substituée par un `2026` codé en dur).

5. **`suppressHydrationWarning` n'est pas un correctif.** Le prop ne porte **que** sur
   l'élément qui le reçoit (ses attributs/texte propre), jamais sur ses descendants : posé sur
   un `<main>` ou un `<div>` de page, il masquait le diagnostic sans rien réparer. Il n'est
   conservé que sur `<html>` dans `app/layout.tsx`, c'est-à-dire là où `lang` est muté hors React.

6. **`<html lang>` aligné sur le segment `[locale]`** : le layout racine ne reçoit pas les
   params des segments enfants (vérifié : `params === {}` en Next 14.2). Un effect
   (`components/layout/HtmlLang.tsx`) applique `lang`/`dir` après hydratation — mutation hors
   arbre React, donc sans risque d'hydratation.

7. **Balisage valide, sinon le navigateur réécrit le DOM.** Un `<div>` dans un `<p>` ferme le
   `<p>` ; un `<li>` hors `<ul>` est remonté ; un `<button>` dans un `<a>` est un contenu
   interactif imbriqué interdit. Le HTML parsé ne correspond plus à l'arbre React → mismatch.
   Le projet rendait donc `<Link><Button/></Link>` sur le hero et dans le header ; `Button`
   expose maintenant `buttonClasses(variant, size, className)` pour poser le style sur le
   `<Link>` lui-même (`app/[locale]/page.tsx`, `components/layout/Header.tsx`).
   Détecté par `node scripts/check-dom-nesting.mjs` (inclus dans `npm run check:hydration`).

8. **Une seule source pour la détection de locale.** `middleware.ts` et `lib/i18n.ts`
   contenaient chacun leur copie de `parseAcceptLanguage` + leur liste de locales : deux
   implémentations qui divergent = une langue choisie côté edge/serveur et une autre côté client
   → tous les textes traduits mismatchent. Tout passe désormais par `lib/locale-detection.ts`
   (sans dépendance à `next/server` ni au DOM : exécutable en Edge, en Node et en navigateur,
   et testable en unit). Le cookie `NEXT_LOCALE` y a aussi une seule définition d'attributs
   (`SameSite=Lax`, 1 an, `Secure` dès que le contexte est HTTPS).

9. **Le service worker ne doit jamais servir un document HTML périmé.** Le SW precachait
   `/`, `/fr`, `/en`, `/nl`, `/de` et écrivait les réponses de navigation en cache : après un
   déploiement, le navigateur recevait l'ancien HTML avec les nouveaux chunks → hydratation
   cassée, et le cache ne se purgeait que si `VERSION` était bumpé à la main.
   → `public/sw.js` : plus aucun HTML en cache (précaches = page `/offline`, manifest, icônes,
   assets hachés), payloads RSC en `NetworkOnly`, `VERSION` incrémentée pour purger les caches
   corrompus des visiteurs existants, et correction des `ReferenceError: url is not defined`
   dans `networkFirst`/`networkOnly` (le fallback offline levait → rechargements en boucle).

10. **Un instant ne se lit pas dans le rendu, et une date ne se parse pas « à la légère ».**
    Deux pièges distincts, tous deux corrigés :
    - les chaînes `YYYY-MM-DD HH:mm` (SQL, mocks) passées à `new Date()` sont lues en **heure
      locale du runtime** : `2026-09-09 14:22` devient 14:22Z sur un serveur UTC et 14:22+02:00
      dans un navigateur belge → la même ligne de liste s'affiche à deux heures, parfois à deux
      **jours**. `resolveDate()` (`lib/formatters.ts`) ancre ces valeurs sur UTC, avertit en
      développement et réclame de l'ISO-8601 avec décalage à la source ; `formatDate`,
      `formatDateTime`, `formatDateLong` et `relativeTime` y passent tous et forcent
      `timeZone: Europe/Brussels`. Une valeur invalide rend une chaîne vide au lieu de faire
      planter `Intl` (`RangeError: Invalid time value`) — un champ de date manquant ne doit pas
      emporter la page.
    - « il y a 3 heures » dépend de l'horloge : `formatRelative()` lit `Date.now()` à l'appel et
      est donc **interdit dans un composant** (règle `relative-time-in-render` de
      `scripts/check-hydration.mjs`, avec `raw-date-parse` pour les chaînes sans décalage).
      À la place, `<RelativeTime date locale now />` (`components/ui/RelativeTime.tsx`) :
      premier rendu déterministe — date absolue, ou relatif calculé depuis le `now` **reçu en prop
      du serveur** si on veut éviter le saut visuel — puis bascule en relatif dans un
      `useEffect`, rafraîchi toutes les 60 s et nettoyé au démontage. Le `<time dateTime=… title=…>`
      conserve l'instant exact : l'information ne dépend jamais du moment où le HTML a été produit.

    Les données suivent la même règle : `lib/mock.ts` écrit `2026-09-09T14:22:00+02:00`.

11. **Aucun tag ni liste de locale dans `app/` et `components/`.** Huit pages écrivaient
    `formatEUR2(v, "fr-BE")` (et le layout racine `canonical: "/fr"` + `locale: "fr_BE"`), parce que
    `formatEUR/formatEUR2` avaient un **défaut** `locale = "fr-BE"` : un utilisateur `nl`, `de` ou
    `en` recevait du français, sans erreur nulle part. Trois verrous :
    - les formatteurs de l'app ne prennent **que** la locale applicative (`fr|en|nl|de`) — le
      paramètre est **obligatoire** et typé `Locale`, donc `formatEUR2(v, "fr-BE")` ne *compile plus* ;
      la conversion `Locale → tag Intl` a lieu dans `lib/` (`localeToIntl`, source unique, ré-exportée
      par `lib/formatters.ts`) ;
    - les tables de noms/étiquettes/codes sont dans `lib/i18n.ts` : `localeToIntl`, `localeLabels`,
      `localeTagLabel` (dérivée), `openGraphLocale`, `whatsappLocale`. Un composant qui a besoin d'un
      tag (le sélecteur de langue affiche `FR-BE`) lit la table, il ne recopie pas ;
    - `scripts/check-hydration.mjs` interdit désormais `locale-tag-literal` (chaîne `"fr-BE"`/`"nl_BE"`
      dans `app/`+`components/`), `locale-arg-literal` (locale en argument d'un formatteur, dont
      `t("fr", …)`), `locale-list-literal` (liste `['fr','en','nl','de']` recopiée — c'est ainsi qu'un
      template `fr` était exclu de son propre aperçu) et `intl-tag-in-ui` (`localeToIntl` importé dans
      un composant ; seule exception documentée : `components/layout/HtmlLang.tsx`, qui pose
      `data-intl` hors arbre React). Deux règles jumelles verrouillent la variante « hors arbre
      React » du même défaut (passée 6) : `localized-url-literal` (aucune URL commençant par
      `/fr/`… dans `app/`, `components/`, `lib/`, `hooks/` — c'est ainsi que `start_url` du manifeste
      PWA et les motifs de cache étaient français pour tout le monde) et `untranslated-metadata`
      (aucun `title:`/`description:` en littéral dans un `layout.tsx`/`route.ts` de `app/` : cette
      copie passe par `t(locale, "common:seo.*")`).
      S'ajoute `scripts/check-copy.mjs` (`npm run check:copy`, dans `npm run check`) : budget de copie
      française par fichier — **zéro** dans `components/customer/**` et `components/admin/**`, qui
      enveloppent toutes les pages métier (leur nav en dur rendait le menu français sur /nl et /de),
      et compteur figé ailleurs, donc non croissant — `app/[locale]/page.tsx`, elle, est en règle dure (`FLOOR_FILES`) parce que son texte est rendu côté serveur dans la langue du segment : une chaîne en dur y partirait littéralement dans le HTML des trois autres langues (et dans l'index). Détail inattendu relevé au passage : ces coquilles
      rendent un skeleton tant que le store `persist` n'a pas parlé, donc le HTML serveur ne contient
      aucune copie — un test fige cette égalité (`shell-i18n.spec.tsx`) pour qu'on n'aille pas « corriger »
      ce qui n'a jamais cassé l'hydratation.

    Conséquence mesurée au passage (et piégée par un test) : Next **remplace** le bloc `openGraph`
    entre parent et enfant au lieu de le fusionner — le redéclarer à moitié dans le layout enfant
    supprimait silencieusement `og:image`, `og:site_name` et `og:type`. Le bloc complet vit donc dans
    `app/[locale]/layout.tsx`, avec les constantes partagées dans `lib/seo.ts`.

    Ces littéraux n'étaient pas un mismatch en soi — serveur et navigateur affichaient le **même**
    texte faux — mais la classe exacte de divergence apparaît dès qu'un appelant, lui, dérive la
    locale du segment (deux formats dans la même page). Le vrai défaut observable était ailleurs :
    voir §« SEO » de `docs/i18n.md` (canonical croisé sur /en, /nl, /de et `og:locale` refusé par le
    parseur Open Graph).

### 11. Une chaîne en dur dans une zone rendue sur les quatre marchés, c'est aussi du HTML serveur

`app/layout.tsx` et `components/pwa/*` sont rendus pour **toutes** les pages, dans la langue du segment
pour les seconds, sans aucune locale disponible pour le premier. Leur texte atterrit dans le HTML de
`/fr`, `/en`, `/nl` **et** `/de`, avec les mêmes contraintes que la règle 10 — et l'`aria-label` de la
pastille de connexion est comparé par les tests d'accessibilité. Les bannières PWA sont donc passées en
`FLOOR_DIRS` dans `scripts/check-copy.mjs` (compteur à zéro), `app/layout.tsx` en `FLOOR_FILES`.

Les bannières PWA (`components/pwa/*`) sont montées par le layout de toutes les pages : leur texte
atterrit dans le HTML de `/fr`, `/en`, `/nl` **et** `/de`, avec les mêmes contraintes que la règle 10 — et
l'`aria-label` de la pastille de connexion est comparé par les tests d'accessibilité. Le répertoire est donc
passé en `FLOOR_DIRS` dans `scripts/check-copy.mjs` (compteur à zéro), comme les coquilles client et admin.

La variante la plus vicieuse, repérée deux fois ici, n'est pas du tout du JSX : `{ actionLabel = "Opération" }`
et `{ label = "Réessayer" }` sont des **défauts de paramètres**. Une seule phrase, donc hors du champ de
l'heuristique de copie (qui exige deux mots), et surtout intraduisible par dictionnaire puisque la valeur
est écrite dans la signature : elle s'affiche dès qu'un appelant omet la prop, sur les quatre marchés. La
forme correcte est une prop optionnelle résolue dans le corps (`label ?? t("pwa.retry")`), et
`check-copy.mjs` refuse désormais toute chaîne accentuée en position de défaut de paramètre. Deux réglages
de mesure, tous deux indispensables : le compteur **ignore les blocs `/** … */`** (la documentation du projet
est en français et n'est jamais rendue — un faux positif appris, c'est un contrôle désactivé), et il ne peut
rien sur un libellé **sans** accent : « Aller au contenu » lui échappe par construction. D'où la règle dure
ajoutée à `scripts/check-hydration.mjs`, `skip-link-in-root-layout` — la première à cibler un fichier précis
(option `only`) — parce que le skip-link du layout racine était à la fois français et dédoublé :
`tests/a11y/axe.spec.ts`, réécrit pour lire les sources au lieu de s'auto-vérifier, contrôle qu'il n'existe
**qu'un seul** `href="#main"`, rendu par `app/[locale]/layout.tsx` avec `common:shell.skipToContent`.

### 12. Un chunk sans hash de build ne se met jamais en cache — ni par le SW, ni par un `immutable` en dev

Deux fichiers se ressemblent et ne se traitent pas pareil :

- `/_next/static/chunks/main-4c9c1e9bb24fb188.js` — **production** : le nom porte le hash, le contenu est
  immuable par construction ;
- `/_next/static/chunks/webpack.js` — **développement** : URL stable, contenu réécrit à **chaque** compile.

En cache-first, le second renvoie un `__webpack_modules__` d'une compilation morte pendant que les autres
chunks viennent de la compilation courante : `__webpack_require__(id)` renvoie `undefined`, et la ligne
suivante du runtime échoue sur `module.exports = factory.call(...)`. Le symptôme est donc un chargement qui
marche, puis casse après `Ctrl-C` / `rm -rf .next` / un `npm ci` — et un reload ne change rien, le cache
gardant l'exemplaire périmé. Le dépôt applique trois gardes :

1. `public/sw.js` classe les assets via `assetHache()` : sans hash dans le nom de fichier, la requête
   `/_next/**` n'est **pas interceptée du tout** (le navigateur reprend la main, le HMR respire) ;
2. `public/sw.js` n'écrit en cache qu'après `reponseCacheable()` — `no-store`, `no-cache`, `max-age=0` et
   les réponses non-`ok` sont refusés, sur `CacheFirst`, `StaleWhileRevalidate` et `preloadResponse` ;
3. `components/pwa/SWRegister.tsx` ne s'enregistre pas hors `production` et **désenregistre** les
   installations héritées (purge des caches `kredit-*` même si la registration a disparu), pour qu'un poste
   déjà empoisonné se répare tout seul au rechargement suivant.

`next.config.js` ne déclare `/_next/static/:path*` en `immutable` **qu'en production** : ce réglage
appliqué au dev équivalait à signer l'arrêt de validité du cache pour des fichiers qui changent en permanence
(Next 16 émet d'ailleurs un avertissement explicite sur ce header). Les trois gardes sont tenues par
`check:hydration` (règles `sw-cache-unstable-chunk`, `sw-registered-in-dev`) et le comportement réel du
worker est exécuté dans `tests/pwa/sw-cache-policy.spec.ts`.

### 13. Une panne de rendu ne doit jamais vider la page — `error.tsx` et `global-error.tsx`

Symptôme: la page s'affiche, puis devient **blanche**, sans message. React 18 démonte l'arbre entier
quand une exception remonte jusqu'à la racine et qu'**aucune frontière d'erreur n'est déclarée** ; en
production il n'y a même pas d'overlay pour le dire. Le dépôt pose donc les deux fichiers App Router:

- `app/[locale]/error.tsx` — segment localized : panneau avec `reset()` (re-render du segment), repli
  vers `/${locale}`, copie intégralement en `common:shell.error*` (quatre langues), détail technique
  affiché **uniquement** hors production ;
- `app/global-error.tsx` — dernier recours quand le layout racine tombe : il rend lui-même
  `<html lang>` et `<body>` (sinon le navigateur reçoit un fragment sans racine).

Les deux relisent la locale dans le chemin (`usePathname`, déterministe serveur ↔ client) et **jamais**
dans un store : une frontière doit rester debout quand le reste de l'application est justement en train
de tomber. Un lien interne vers une route inexistante produit le même écran blanc après un clic —
d'où `npm run check:links` (voir `docs/tests.md`).

### 14. Une route inconnue doit rester une page du site, pas la page 404 de Next

`app/[locale]/not-found.tsx` ne couvre que les `notFound()` **levés dans le segment**. Une URL qui ne
correspond à aucune page — faute de frappe, lien périmé, deep-link d'une campagne — est traitée **hors**
du segment localisé : sans `app/not-found.tsx`, Next sert son document intégré, une phrase en anglais,
sans bandeau, sans pied, sans lien. Sur un site revendiqué FR/EN/NL/DE, c'est indistinguable d'une panne
depuis le navigateur — et c'était le deuxième sens de « le site disparaît après être apparu ».

Les deux fichiers existent désormais : `app/not-found.tsx` (composant **serveur**, la langue vient du
cookie `NEXT_LOCALE` posé par le sélecteur, repli `fr`, et les quatre langues sont proposées comme seule
issue de la page) et `app/[locale]/not-found.tsx` (composant client, langue relue dans `usePathname`,
rendu **dans** le layout localisé donc avec bandeau et pied de page). La copie passe par
`common:shell.notFound*` ; `npm run check:links` échoue si l'un des quatre fichiers de secours
(`not-found`, `error`, racine et segment) disparaît.

---

### 15. `next dev` et `next build` ne partagent jamais le même dossier compilé

Un build de production écrit dans `.next` : il remplace les chunks que le serveur de dev a en mémoire,
et le `webpack.js` qui reste sur le disque est celui d'une autre compilation. Le HTML servi référence
alors des identifiants de modules que le runtime chargé ne connaît pas, et le navigateur meurt de façon
parfaitement reproductible sur `Cannot read properties of undefined (reading 'call')` dans
`options.factory` — pendant que le terminal du serveur affiche `GET /fr 200` et que chaque fichier
réclamé est servi à 200. Rien, dans le dépôt, ne permet de le deviner depuis le code : c'est un état du
poste.

D'où `distDir: process.env.NODE_ENV === "production" ? ".next" : ".next-dev"` dans `next.config.js`
(isolation mesurée : `npm run build` lancé pendant que le dev tourne laisse `/fr` à 200, et
`main-app.js` — chunk que le dev seul produit — n'apparaît pas dans `.next`). Deux conséquences à
connaître : `next.config.js` n'est lu **qu'au démarrage**, donc un pull qui change `distDir` est sans
effet sur le serveur en cours (d'où la ligne rouge « le serveur a démarré avant » de `check:state`) ;
et `tsconfig.json` est réécrit par Next pour ajouter `".next-dev/types/**/*.ts"` à `include` — la
version formatée du fichier est la version canonique, ne pas la re-plier.

Le contrôle `npm run check:state` (`frontend/scripts/check-state.mjs`) vérifie l'arbre, les deux
dossiers compilés, la fraîcheur relative des sources et des chunks, `max_user_watches`, et compare
l'octet servi à l'octet du disque pour `webpack.js` et `main-app.js` : c'est lui qui dit si l'on est
dans ce cas, dans l'autre (worker hérité) ou dans aucun.

### 16. Une animation ne doit jamais être le seul chemin vers le contenu

`opacity: 0` dans un `style` calculé au render, c'est la même famille d'erreur qu'un composant
client-only rendu trop tôt : le HTML serveur et le HTML client ne racontent pas la même chose — et ici
le texte manque carrément à l'appel (crawler sans moteur, bloqueur de scripts, impression,
`prefers-reduced-motion`). La couche de mouvement pose donc ses états initiaux **dans la feuille de
style** (`[data-reveal]`, section Motion de `app/globals.css`), seul endroit d'où un média query et un
`<noscript>` peuvent les annuler. Son contrat d'hydratation est double :

- `data-shown="false"` est écrit par le serveur **et** par le premier rendu client — la bascule vient
  après, en effet ;
- `CountUp` reçoit le texte déjà rendu (`final`) et y revient à la fin de la montée : un `Intl` de
  navigateur qui écrit une insécable là où le serveur écrivait une espace fine ne peut plus créer
  d'écart, puisqu'ils ne s'occupent jamais du même rendu.

Gardé par quatre règles de `check:hydration` (`motion-reduced-motion`, `motion-keyframes-orphelin`,
`motion-client-composant`, `motion-cache-au-render`) et par `tests/unit/motion.spec.tsx` (15 cas). Le
reste — pourquoi `transform`/`opacity` et jamais `width`, d'où viennent les durées — est dans
`docs/motion.md`.

## 3. Vérification

Verrous permanents dans la suite Jest (`npm --prefix frontend test`) :

- `tests/unit/hydration.spec.ts` — aucun espace non normalisé ne sort des formatteurs, et la
  sortie est **identique** que le runtime emploie U+202F ou U+00A0 (le test simule un CLDR de
  navigateur en proxifiant `Intl.NumberFormat`), plus la table de priorité de détection de locale ;
- `tests/unit/locale-propagation.spec.tsx` — table de tags unique (`localeToIntl` de
  `lib/formatters` **est** celle de `lib/i18n`, identité d'objet), `openGraphLocale` complet et sans
  `fr_BE`, `generateMetadata` du layout `[locale]` (canonical/hreflang/og par segment), et **montage
  réel** de la page Paiements en `fr` puis `nl` pour vérifier que le montant suit la langue de l'URL
  (et que le HTML serveur reste le skeleton — ces pages client ne mettent pas les montants dans le
  HTML) ;
- `tests/unit/dates-timezone.spec.tsx` — `resolveDate` (ancrage UTC, offsets explicites, « jour
  seul », valeur invalide), pureté de `relativeTime` (l'appel échoue si l'horloge est lue), et
  **hydratation réelle** de `<RelativeTime>` : `renderToString` puis `hydrateRoot` dans jsdom,
  avec `onRecoverableError` + écoute de `console.error` (un écart de texte ferait échouer le test).

- `tests/unit/pwa-chrome-i18n.spec.tsx` — le chrome du layout (pastille de connexion, bandeaux hors ligne /
  sync, notifications push, `RetryButton`, `ServerRequiredNotice`) monté en jsdom pour les quatre marchés :
  le texte rendu **doit** être la valeur du dictionnaire de la locale et non la valeur française, plus
  `renderToString` de `/[locale]/offline`, dont le HTML part à l'index et aux partages ;
- `npm run check:copy` — budget décroissant de copie française en dur, avec deux règles dures : les
  répertoires vus par les quatre langues (`components/customer`, `components/admin`, `components/pwa`) et
  les pages rendues côté serveur (`app/[locale]/page.tsx`, `app/[locale]/offline/page.tsx`) sont à zéro, et
  **aucun** défaut de prop textuel n'est toléré nulle part (cf. règle 11).

Le fuseau du processus de test est épinglé par `tests/global-setup.js` (`TZ=Europe/Brussels`) :
sinon un CI en UTC rendrait indétectable le retour d'un parse « à la locale ».

```bash
cd frontend
npm run lint                     # eslint-config-next + react/no-unescaped-entities (voir .eslintrc.json)
npm test                         # verrous Jest (tests/unit/hydration.spec.ts)
npm run check:hydration          # garde-fous statiques (zéro dépendance) : APIs au render, dates
                                 # sans décalage, temps relatif au render, imbrications HTML
npm run check:copy               # copie française en dur (budget + règles dures), sans dépendance
npx next build                   # le prerender de toutes les pages [locale] casse si un render touche une API navigateur
```

En pratique, pour un composant douteux :

```bash
curl -s localhost:3000/fr > /tmp/server.html   # HTML serveur réel
```
puis, dans DevTools, comparer le `outerHTML` du même conteneur : **le premier** nœud divergent
est la cause (pas le dernier). Test complémentaire : naviguer vers la page via un `<Link>` —
si l'erreur disparaît, l'écart vient bien du rendu serveur vs premier rendu client.

## 4. Diagnostic d'un mismatch restant

1. Fenêtre privée (extensions = `Extra attributes from the server HTML`).
2. `npx next build && npm start` : propre en prod mais pas en `dev` → double-render StrictMode
   ou effet qui modifie le markup initial.
3. DevTools → cocher « Pause on exceptions » dans la catégorie des erreurs non catchées, ou
   ajouter temporairement `onRecoverableError` via un `ErrorBoundary` pour logger l'écart.
4. HTML minifié/caché en amont (proxy, Cloudflare) : les marqueurs `<!--$-->` de React doivent
   survivre, sinon l'hydratation échoue globalement — vider le cache, pas le composant.
5. CSS-in-JS (styled-components/emotion) non enregistré au SSR → attributs `class`/`style`
   différents : configurer le registry serveur, ne pas `suppressHydrationWarning`.

## 5. Reproduction et mesure (sans navigateur)

jsdom suffit, puisqu'il exécute les vrais chunks client de Next : React hydrate réellement la page.

```bash
cd frontend
npm i -D jsdom                 # dépendance du harnais uniquement (non requise au build)
npm run dev                    # :3000
npm run check:hydrate -- --skew-intl --wait 12000 --routes /fr /en /credit/simulator
```

`scripts/hydrate-check.mjs` rend `exit 1` si une page présente un écart serveur/client.

Le principe du script : charger l'URL, attendre, et compter les `console.error` React contenant
`hydrat|did not match|Text content|server HTML`. Pour simuler le décalage de CLDR entre le serveur
Node et le navigateur, on redéfinit `window.Intl.NumberFormat`/`DateTimeFormat` dans `beforeParse`
pour qu'ils renvoient U+00A0 là où Node renvoie U+202F — et là, sur le code d'origine :

```
Warning: Text content did not match. Server: "15 000,00 €" Client: "15 000,00 €"
Error: Text content does not match server-rendered HTML.
An error occurred during hydration. The server HTML was replaced with client content in <%s>.
→ 10 erreurs sur /fr
```

Après les correctifs (`lib/intl.ts` + formatteurs + retraits des bandages), le même scenario
donne `hydrationIssues: 0` sur `/fr`, `/en`, `/nl`, `/credit/simulator`, `/admin/dashboard`,
`/examples/i18n`, `/investments` — vérifié avec React en mode dev, `reactStrictMode: true`.
`node scripts/check-hydration.mjs` (règle `raw-intl-outside-lib`) empêche le formatage `Intl`
non normalisé de revenir dans `app/` et `components/`.
