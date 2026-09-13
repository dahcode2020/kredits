# KREDIT — plateforme de crédit (Belgique, EUR) — FR / EN / NL / DE

Reprise propre du projet `dahcode2020/kredit` : même produit, mêmes règles, nouveau départ.
Le matériel de départ (brief, dictionnaires, gardes, primitives de mouvement, tests) vivait dans
`reprise/` de la branche `arena/01a08fd5-krit` ; ce dépôt en applique les règles **au premier
commit**, et n'en reprend pas les défauts (119 pages simulées, tokens fabriqués, statistiques
inventées, liens morts).

## Slice 1 — ce qui existe aujourd'hui

**Une page d'accueil, irréprochable, en 4 langues, animée, sans une seule donnée fausse à l'écran.**

- `/fr`, `/en`, `/nl`, `/de` : une même page rendue par le serveur dans la langue du segment ;
  la racine `/` détecte (cookie → Accept-Language → défaut `fr`) et redirige (`middleware.ts`).
- Tout le texte passe par les dictionnaires `frontend/i18n/{fr,en,nl,de}/*.json` : 11 namespaces,
  **715 clés alignées au caractère près dans les 4 langues** (le brief annonçait « 706 » ; le
  matériel fourni en aligne 715 — la parité est verrouillée par
  `tests/unit/i18n-parity.spec.ts`, pas par un chiffre rond).
- Tout **nombre** affiché sort d'une seule table : `frontend/lib/credit-engine.ts`
  (paliers 2,50 / 1,90 / 1,80 / 1,50 % par montant ; bornes et durées des quatre produits ;
  frais minimum). Grille commerciale BE arrêtée le 12/09/2026.
- Animations : primitives `Reveal`, `CountUp`, `ScrollProgress`, `Parallax` + feuille
  `app/globals.css` (courbes, durées, apparitions). `prefers-reduced-motion` annule **l'état**,
  pas seulement la durée ; `<noscript>` dans le `<head>` rend la page lisible sans JavaScript ;
  `@media print` et `@media (hover: none)` couvrent l'impression et le tactile.
- **Aucun CTA vers une route qui n'existe pas.** Le simulateur, le portail et le tableau de bord
  arriveront avec leurs slices ; la page d'accueil ne promet rien qu'elle ne tienne :
  ses boutons mènent à ses propres sections (`#produits`, `#taux`, `#apropos`, `#parcours`).
- Effet de bord assumé et **affiché** : sur 1 500 € / 12 mois, le TAEG est de 7,50 % (les 75 €
  de frais minimum pèsent 5 % sur un an) — le contre-exemple est calculé par le moteur et rendu
  dans la section taux. Un « dès 2,50 % » sans ce détail serait une promesse fausse.

### Ce que la page ne montre volontairement PAS

| Élément du dictionnaire | Pourquoi il n'est pas rendu |
| --- | --- |
| `stats.*`, `trust.*`, `hero.trust` (« 8 400+ clients », « 4 800 avis »…) | Statistiques marketing sans source réelle : les clés existent, elles resteront non rendues tant qu'aucune donnée réelle ne peut les porter. |
| `hero.cta1` / `cta.simulate` / `heroCard.cta` (« Simuler mon crédit ») | Le simulateur est la slice 2 ; un bouton sans destination est pire qu'un bouton absent. |
| `faq.q1` / `faq.a1` | Sa copie attend un nombre (« TAEG à partir de, … ») que seule la slice simulateur pourra fournir proprement ; l'information équivalente est déjà à l'écran (grille + contre-exemple). |
| sections `roles` / `auth`, formulaire `contact` | Écrans des slices 3 et suivantes ; un formulaire qui ne répond pas est un écran faux. |
| `testimonials.verified`, étoiles | Les témoignages rendus sont **explicitement illustratifs** (`testimonials.note` est affiché) ; un badge « client vérifié » sur un avis illustratif serait une donnée fausse. |

## Les six contraintes non négociables (posées au commit n°1)

1. **Une valeur = une table = un endroit.** `lib/credit-engine.ts` est la seule source des taux,
   bornes et frais ; les écrans la lisent (`ProductSection`, `HeroCard`), les identifiants de
   règle (`rate_BE_PERSONAL_1500_50000`) sortent du moteur. Verrou :
   `tests/unit/credit-tiers.spec.ts` (aucun pourcentage écrit à la main dans l'UI, descriptions
   de produits sans chiffre).
2. **Aucun texte en dur.** `check:copy` (budget décroissant, coquilles à zéro, axe strict sur
   `components/home` ajouté), `tests/unit/i18n-keys-usage.spec.ts` (toute clé appelée par le code
   se résout dans les 4 langues) et `tests/unit/i18n-parity.spec.ts` (les dictionnaires eux-mêmes).
   Les 4 clés legacy françaises de l'ancien dépôt (`fr/fr-BE.json`) sont **supprimées** — le brief
   disait « à traduire ou supprimer ».
3. **Les 4 échappatoires.** `prefers-reduced-motion`, `<noscript>`, `@media print`,
   `@media (hover: none)` — dans `app/globals.css` et le `<head>` de `app/layout.tsx`.
4. **Contrat d'hydratation.** Aucune API navigateur au render (état initial stable, mesures en
   effet) ; l'état caché vit dans le CSS (`[data-reveal]`) ; `Intl` normalisé
   (`lib/intl.ts`, U+202F → U+00A0) ; `CountUp` revient à la chaîne du serveur.
   Verrous : `check:hydration`, `check:dom-nesting`, `tests/unit/hydration.spec.ts`,
   `tests/unit/motion.spec.tsx`. Documentation : `docs/hydration.md`, `docs/motion.md`.
5. **Les 6 gardes + la CI.** `scripts/check-{hydration,dom-nesting,copy,routes,assets,state}.mjs`
   enchaînés par `npm run check` (statique) + `check:assets`/`check:state` (serveur lancé).
   Le workflow CI est fourni en `docs/ci.yml`, prêt à poser tel quel dans
   `.github/workflows/ci.yml` : la connexion GitHub de cette session n'a pas la permission
   `workflows` (le même mur que l'ancien dépôt, qui avait fini par livrer `ci.example.yml`).
   4 jobs : gardes → tests → build → assets/state, à chaque poussée dès qu'il est en place.
6. **Pas de CTA sans destination réelle.** `check:routes` croise chaque lien interne (code ET
   dictionnaires) avec les `page.tsx` réellement présents ; l'accueil n'affiche que des ancres
   réelles et le sélecteur de langue.

## Structure

```
├── package.json               relais de scripts (npm run check depuis la racine)
├── .github/workflows/ci.yml   les gardes et les tests, lancés par GitHub Actions
├── docs/                      hydration.md, motion.md, i18n.md (les patterns corrects)
└── frontend/
    ├── app/                   layout racine (noscript), [locale] (accueil, 404, erreur)
    ├── components/            layout/ motion/ ui/ home/ (sections de l'accueil)
    ├── i18n/                  11 namespaces × 4 langues, parité stricte
    ├── lib/                   i18n, intl, formatters, locale-detection, credit-engine, motion…
    ├── scripts/               les 6 gardes + fresh.mjs + copy.baseline.json ({})
    └── tests/unit/            parité, clés utilisées, hydratation/Intl, motion, grille
```

## Commandes

```bash
npm run dev                # serveur de dev (0.0.0.0:3000, compile dans .next-dev)
npm run build && npm run start
npm run check              # typecheck + hydration + copy + routes
npm run check:assets       # serveur lancé: chaque ressource du HTML des 4 locales est servie
npm run check:state        # l'état du poste (pull arrivé, .next cohérent, chunks = disque)
npm run test:unit          # les verrous jest
npm run fresh              # remise à zéro du dev (processus + .next-dev), sans taper 5 commandes
```

## Feuille de route (une passe = un écran visible)

1. **Accueil** ← vous êtes ici.
2. Simulateur (réglette logarithmique, verrous `credit-tiers` réactivés côté UI).
3. Demande pré-remplie.
4. Portail (connexion + inscription + second facteur) — les tests `auth-flow` du matériel arrivent là.
5. Tableau de bord client. Puis PWA (le service worker v8 et ses contrôles `check:state`
   retrouveront leur place entière), backend-miroir de la grille, etc.

## Ce que je n'ai pas vérifié

- **Mobile réel** : les échappatoires (`hover: none`, reduced-motion) et le menu/onglets sont
  testés par code et CSS, pas sur un appareil physique dans cette session.
- **Rendu visuel** : à regarder dans l'aperçu live (4 locales) ; l'œil juge, les gardes mesurent.
- **Polices** Raleway/Inter chargées depuis Google Fonts au runtime : hors réseau, repli
  system-ui (pas de casse, pas de blocage).
- **Formatage en-BE** : le choix `localeToIntl` (xx-BE pour les 4 marchés) vient du matériel
  d'origine ; les décimales à la belge (« 1,50 % » sur /en) en sont la conséquence voulue.
- L'avertissement inotify (`max_user_watches`) de `check:state` est un réglage du poste, pas du
  code (0 rouge).
