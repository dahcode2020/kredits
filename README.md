# KREDIT — plateforme de crédit (Belgique, EUR) — FR / EN / NL / DE

Reprise propre du projet `dahcode2020/kredit` : même produit, mêmes règles, nouveau départ.
Le matériel de départ (brief, dictionnaires, gardes, primitives de mouvement, tests) vivait dans
`reprise/` de la branche `arena/01a08fd5-krit` ; ce dépôt en applique les règles **au premier
commit**, et n'en reprend pas les défauts (119 pages simulées, tokens fabriqués, statistiques
inventées, liens morts).

## Slices 1 & 2 — ce qui existe aujourd'hui

**Une page d'accueil irréprochable et un simulateur complet, en 4 langues, animés, sans une seule
donnée fausse à l'écran.**

- `/fr`, `/en`, `/nl`, `/de` : une même page rendue par le serveur dans la langue du segment ;
  la racine `/` détecte (cookie → Accept-Language → défaut `fr`) et redirige (`middleware.ts`).
- Tout le texte passe par les dictionnaires `frontend/i18n/{fr,en,nl,de}/*.json` : 11 namespaces,
  **728 clés alignées au caractère près dans les 4 langues** (le brief annonçait « 706 » ; le
  matériel fourni en alignait 715, les slices 2-3 en ajoutent 13 dans les 4 langues à la fois —
  la parité est verrouillée par
  `tests/unit/i18n-parity.spec.ts`, pas par un chiffre rond).
- Tout **nombre** affiché sort d'une seule table : `frontend/lib/credit-engine.ts`
  (paliers 2,50 / 1,90 / 1,80 / 1,50 % par montant ; bornes et durées des quatre produits ;
  frais minimum). Grille commerciale BE arrêtée le 12/09/2026.
- Animations : primitives `Reveal`, `CountUp`, `ScrollProgress`, `Parallax` + feuille
  `app/globals.css` (courbes, durées, apparitions). `prefers-reduced-motion` annule **l'état**,
  pas seulement la durée ; `<noscript>` dans le `<head>` rend la page lisible sans JavaScript ;
  `@media print` et `@media (hover: none)` couvrent l'impression et le tactile.
- **Aucun CTA vers une route qui n'existe pas.** Depuis la slice 2, « Simuler mon crédit » (hero),
  « Lancer le simulateur » (carte) et « Simulateur » (navigation) mènent à la route réelle ; le
  portail et le tableau de bord arriveront avec leurs slices. Le simulateur lui-même ne propose
  pas encore « Déposer ma demande » : la demande pré-remplie est la slice 3 et apparaîtra avec elle.
- Effet de bord assumé et **affiché** : sur 1 500 € / 12 mois, le TAEG est de 7,50 % (les 75 €
  de frais minimum pèsent 5 % sur un an) — le contre-exemple est calculé par le moteur et rendu
  dans la section taux. Un « dès 2,50 % » sans ce détail serait une promesse fausse.
- **Habillage visuel inspiré du template Dewi** et des captures de l'ancien site — sans en
  reprendre les défauts : photos de marque **générées** (`frontend/public/images/`, décoratives,
  `alt=""`, `aria-hidden`, jamais présentées comme l'équipe ou le siège réel) pour le hero, les
  quatre cartes produits (étiquette de catégorie posée sur la photo) et le panneau « à propos » ;
  bandeau de chiffres sous le hero qui compte les **plafonds contractuels** des quatre produits
  (lus dans `PRODUITS`, zéro clé i18n inventée) ; langues en pilules visibles sur desktop.
  Les fausses stats de l'ancien site (8 400+ clients, 4,8/5, « avis vérifiés ») et ses CTA morts
  (Watch demo, EXPLORE →) restent exclus. `<img>` préféré à `next/image` à dessein (conteneurs
  fixes, pas de CLS, pas de dépendance `sharp` pour le `next start` de la CI) — règle
  `@next/next/no-img-element` désactivée dans `frontend/.eslintrc.json`.

### Slice 2 — le simulateur (`/[locale]/credit/simulator`)

- **Rendu serveur d'abord** : le HTML porte la simulation par défaut (15 000 € / 48 mois, l'exemple
  du dictionnaire) — lisible sans JavaScript, indexable ; l'état initial est déterministe, serveur
  et client hydratent sans écart.
- Onglets produit, réglettes montant/durée (bornes et pas lus dans `PRODUITS`), revenus, charges,
  crédits existants, trois listes dont les options sortent des tableaux exportés du moteur
  (`INCOME_TYPES`, `EMPLOYMENT_STATUSES`, `LOAN_PURPOSES`) — un code sans clé de dictionnaire
  casse le type ET le test `credit-engine-copy`.
- Résultat : mensualité, TAEG, frais de dossier, coût total dont intérêts+frais, taux
  d'endettement, capacité, recommandation moteur + score détaillé, alertes et documents requis.
  Les `message` français du moteur (format log backend) ne sont **jamais** rendus : l'UI interpole
  `credit:simulator.warning.*` et `credit:documents.*` avec des valeurs reformatées par locale.
- **Échéancier sombre** (amortissement français, 12 premières lignes sur le total) — le panneau
  encre/maillage repris du hero. Verrous : `tests/unit/simulator-schedule.spec.ts` (mensualité
  constante, capital sommé au centime, solde final zéro, codes ⊆ tables × 4 langues).
- SEO par langue : titre, description, canonical et hreflang propres à chaque segment.

### Slice 3 — la demande pré-remplie (`/[locale]/credit/apply`)

- Le CTA « Déposer ma demande » du simulateur porte l'état complet dans la query ; la page est
  `force-dynamic` : le HTML rendu côté serveur est **déjà pré-rempli** (lisible sans JavaScript,
  partageable). `etatDepuisQuery` valide et borne tout — une URL bricolée reste dans la grille
  (verrou : `tests/unit/application-params.spec.ts`).
- Coordonnées + consentement RGPD obligatoires ; au dépôt, la demande (référence `KRD-…`, état,
  documents requis recalculés) est conservée **sur l'appareil** (localStorage) et l'écran le dit —
  démonstration sans backend, rien n'est « envoyé » en silence.
- `lib/application.ts` : le pont query ⇄ état, pur et testé en Node ; le localStorage ne vit que
  dans le composant.

### Ce que les pages ne montrent volontairement PAS

| Élément du dictionnaire | Pourquoi il n'est pas rendu |
| --- | --- |
| `stats.*`, `trust.*`, `hero.trust` (« 8 400+ clients », « 4 800 avis »…) | Statistiques marketing sans source réelle : les clés existent, elles resteront non rendues tant qu'aucune donnée réelle ne peut les porter. |
| `cta.simulate` (« Simuler maintenant ») | Variante du CTA simulateur, déjà rendu au hero, à la carte et à la navigation ; reste non rendue tant qu'aucun emplacement ne la réclame. |
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
   Le workflow CI est actif en `.github/workflows/ci.yml` : la permission `workflows`
   a été accordée au compte connecté (2026-09-13), il tourne à chaque poussée sans
   manipulation. (Dans l'ancien dépôt, cette permission manquante avait forcé à livrer
   un `ci.example.yml` inerte dans docs/.)
   4 jobs : gardes → tests → build → assets/state, à chaque poussée dès qu'il est en place.
6. **Pas de CTA sans destination réelle.** `check:routes` croise chaque lien interne (code ET
   dictionnaires) avec les `page.tsx` réellement présents ; l'accueil n'affiche que des ancres
   réelles et le sélecteur de langue.

## Structure

```
├── package.json               relais de scripts (npm run check depuis la racine)
├── .github/workflows/ci.yml   les gardes et les tests, lancés par GitHub Actions à chaque poussée
├── docs/                      hydration.md, motion.md, i18n.md (les patterns corrects)
└── frontend/
    ├── app/                   layout racine (noscript), [locale] (accueil, simulateur, demande, 404…)
    ├── components/            layout/ motion/ ui/ home/ (accueil) simulator/ (slice 2)
    ├── i18n/                  11 namespaces × 4 langues, parité stricte
    ├── lib/                   i18n, intl, formatters, locale-detection, credit-engine, motion…
    ├── scripts/               les 6 gardes + fresh.mjs + copy.baseline.json ({})
    └── tests/unit/            parité, clés utilisées, hydratation/Intl, motion, grille, échéancier
```

## Commandes

```bash
npm run dev                # serveur de dev (0.0.0.0:3000, compile dans .next-dev)
npm run build && npm run start
npm run check              # typecheck + hydration + copy + routes
npm run check:assets       # serveur lancé: chaque ressource du HTML (accueil + simulateur + demande × 4 locales) est servie
npm run check:state        # l'état du poste (pull arrivé, .next cohérent, chunks = disque)
npm run test:unit          # les verrous jest
npm run fresh              # remise à zéro du dev (processus + .next-dev), sans taper 5 commandes
```

## Feuille de route (une passe = un écran visible)

1. **Accueil** — fait (slice 1 + habillage Dewi).
2. **Simulateur** — fait (réglettes, score, échéancier ; verrous échéancier posés).
3. **Demande pré-remplie** — fait (query rendue côté serveur, persistance locale honnête).
4. Portail (connexion + inscription) ← en cours.
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
