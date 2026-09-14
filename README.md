# KREDIT — plateforme de crédit (Belgique, EUR) — FR / EN / NL / DE

Reprise propre du projet `dahcode2020/kredit` : même produit, mêmes règles, nouveau départ.
Le matériel de départ (brief, dictionnaires, gardes, primitives de mouvement, tests) vivait dans
`reprise/` de la branche `arena/01a08fd5-krit` ; ce dépôt en applique les règles **au premier
commit**, et n'en reprend pas les défauts (119 pages simulées, tokens fabriqués, statistiques
inventées, liens morts).

## Slices 1 à 15 — ce qui existe aujourd'hui

**Une page d'accueil irréprochable, un simulateur complet, une demande pré-remplie, un portail
d'authentification, un tableau de bord client façon néo-banque, une PWA installable avec
hors-ligne sécurisé, la grille de taux en table unique partagée avec le futur backend, la banque
du compte client (solde, IBAN, virements avec pipeline de validation, chat support), l'écran
SUPER_ADMIN de l'historique des grilles, un vrai serveur d'API avec authentification qui lit
ces mêmes tables canoniques — et maintenant la banque elle-même, dont le serveur est la seule
autorité — en 4 langues, animés, sans une seule donnée fausse à l'écran.**

- `/fr`, `/en`, `/nl`, `/de` : une même page rendue par le serveur dans la langue du segment ;
  la racine `/` détecte (cookie → Accept-Language → défaut `fr`) et redirige (`middleware.ts`).
- Tout le texte passe par les dictionnaires `frontend/i18n/{fr,en,nl,de}/*.json` : 12 namespaces,
  **983 clés alignées au caractère près dans les 4 langues** (le brief annonçait « 706 » ; le
  matériel fourni en alignait 715, les slices 2-12 en ajoutent dans les 4 langues à la fois —
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

### Slice 4 — l'espace client (`/[locale]/auth`, `/[locale]/account`)

- Bouton **« Espace client »** dans l'en-tête (desktop + mobile) ; une session locale le remplace
  par la pilule du compte (lue après montage, HTML serveur déterministe).
- **Une seule page d'authentification** pour se connecter OU s'inscrire, et pour les trois profils
  (CUSTOMER / ADMIN / SUPER_ADMIN) : l'inscription est réservée au profil client — les comptes
  staff sont « fournis par l'organisation », en démo via trois boutons explicites.
- **Inscription exhaustive** en quatre sections : identité (nom, prénom, naissance avec contrôle
  de majorité, nationalité, état civil), adresse & coordonnées (rue/numéro/boîte, code postal,
  ville, pays, mobile), situation & activités (employeur, profession, ancienneté, secteur,
  entreprise, TVA, revenus nets), informations financières (logement, charge, IBAN, crédits
  existants) — plus double consentement RGPD + conditions.
- Sans backend, tout est local et dit : comptes en localStorage avec **empreinte SHA-256** du mot
  de passe (jamais en clair), session locale, bannière « aucune donnée envoyée ». Verrous purs :
  `tests/unit/auth-local.spec.ts` (email, majorité au jour près).
- Le crédit reste mis en avant : le panneau ludique de la page auth porte le CTA
  « Faire une demande de crédit » vers le simulateur.
- `/account` : espace connecté (profil, demandes locales de la slice 3, déconnexion) ; sans
  session, le portail renvoie vers l'authentification.

### Slice 5 — le tableau de bord client (`/account` connecté)

Néo-banque, mais sans une donnée fausse — tout chiffre sort des demandes réellement déposées sur
l'appareil, recalculées dans le moteur, ou de réglages faits par l'utilisateur :

- **Aperçu** : salutation, statut KYC « en attente » avec explication, carte membre habillée
  néo-banque qui porte les *vraies* données du compte (nom, email, rôle, date — pas un PAN),
  tuiles animées (dossiers, mensualité moyenne, prochaine échéance projetée étiquetée
  `dashboard.projection`), actions rapides.
- **Mes demandes** : cartes dépliables (TAEG, coût total, ratio, score) renvoyant vers
  l'échéancier ; **Échéanciers** : courbe SVG du restant dû (calculée, pas décorative), totaux
  intérêts/coût, sur fond encre ; **Paiements** : état vide honnête (« apparaîtront après
  approbation ») + rappel mandat SEPA.
- **Documents** : checklist par demande dérivée du moteur, marquée « fournie » localement
  (statut passe à « en attente », l'écran précise qu'aucun fichier n'est envoyé).
- **Notifications** : préférences email/SMS/WhatsApp/push persistées, consentement WhatsApp lié.
- **Profil & sécurité** : les données d'inscription relues du compte, changement de mot de passe
  (contrôle de l'empreinte actuelle, nouvelle empreinte SHA-256), déconnexion.
- Verrous : `tests/unit/compte.spec.ts` (échéance projetée, moyenne, courbe) ; `lib/compte.ts`
  pur pour le calcul, localStorage seulement côté navigateur.

### Slice 6 — PWA installable, hors-ligne sécurisé

- `public/sw.js` (kredit-v9) : precache = assets immuables **+ les 4 pages `/offline` seulement**
  (jamais de HTML de page en precache) ; chunks `/_next/` mis en cache **uniquement s'ils portent
  leur hash de build** (`assetHache`) ; tout `cache.put` gardé par `reponseCacheable`
  (no-store/no-cache exclus) ; un seul `respondWith`, via le helper qui force une `Response` —
  une panne réseau ne doit jamais devenir une page blanche.
- **Hors-ligne sûr** : navigations en réseau-d'abord, repli sur la dernière visite publique ou la
  page `/offline` de la langue demandée ; `/account` (données personnelles) **jamais** écrit dans
  le worker ; les données financières ne vivent que dans le localStorage de l'appareil.
- `components/pwa/SWRegister.tsx` : enregistrement **prod uniquement** (en dev, purge des workers
  hérités), toast « mise à jour disponible » → SKIP_WAITING, bannière hors-ligne, prompt
  d'installation — copie `pwa.*` ×4, aucun état navigateur au render.
- `public/manifest.webmanifest` : `start_url: "/"` — c'est le middleware qui redirige selon la
  langue (le piège de l'ancien dépôt : un manifeste qui faisait atterrir un utilisateur nl sur /fr).
- `app/layout.tsx` rend le script d'auto-réparation `kredit-dev-sw-heal` (désenregistrement +
  purge si `/sw.js` disparaît de l'arbre servi) ; `app/[locale]/offline/page.tsx` : page de
  secours traduite, sans lien exigeant le réseau.
- Les quatre gardes dédiées (précaché HTML, chunks non hachés, `respondWith`, enregistrement en
  dev) tournent dans `check:hydration` ; `check:state` vérifie version ≥ v8 + heal-script.

### Slice 7 — miroir backend de la grille

- **Une table, un endroit** : `rate_be/grille.json` porte tout — paliers de taux, bornes/durées/pas
  et frais par produit, et l'historique complet. Le moteur (`lib/credit-engine.ts`) l'importe et
  n'en dérive que des constantes (`PALIERS_TAUX`, `PRODUITS`, `EFFECTIF_DEPUIS`, `GRILLE_VERSION`) ;
  le futur backend lira le même fichier. Plus jamais « trois copies, un seul endroit corrigé ».
- **Historique hash-chaîné** : chaque entrée scelle la précédente (sha256 canonique) ; une grille
  modifiée sans re-scellement est détectée. Une seule entrée ouverte (`effectif_au: null`), la
  dernière = la grille effective. `grilleValideA(date)` date l'audit d'une simulation.
- **Identifiants `rate_BE_…` partagés** : dérivés de la table (`rate_BE_MORTGAGE_20000_50000`…),
  uniques et stables, sortis dans `meta.rateRuleId` et `meta.grilleVersion` — ce sont eux qui
  alimenteront le journal d'audit côté backend.
- **Garde `check:regles`** (dans `npm run check`) : invariants de la table (paliers entiers
  contigus, taux ∈ (0,1), bornes cohérentes, périodes continues), chaîne de hashes, unicité des
  identifiants, et le miroir — le moteur importe la table (pas de paliers recodés), aucune UI
  n'écrit d'identifiant `rate_…` en dur. `--stamp` pour sceller une nouvelle grille.
- **Verrous jest** : `tests/unit/credit-tiers.spec.ts` compare chaque export du moteur à l'entrée
  ouverte de la table, valide la chaîne de hashes et date les simulations (108 tests verts).

### Slice 8 — la banque du compte client (démo locale, sans backend)

- **Compte** : à l'inscription, IBAN belge fictif mais **formellement valide** (checksum ISO 7064
  mod 97, déterministe par compte) + dotation de démonstration étiquetée telle quelle ; solde,
  disponible et réservé ; profil enrichi (toutes les données d'inscription) et photo de profil
  (redimensionnée en 256×256 sur canvas avant stockage local).
- **Virements sortants** (client vérifié uniquement) : la machine à états suit le référentiel
  canonique `operations/virements.json` — niveaux RECEPTION 10 % → CONFORMITE 30 % →
  CERTIFICATS 60 % → EXECUTION 100 %, confirmés un à un par l'administration ; un défaut du
  référentiel (ex. certificat d'assurance manquant, coût 150 €) **arrête le virement exactement au
  niveau atteint**, la barre de progression passe en rouge, le blocage se lève ou le virement est
  refusé/annulé ; le débit (montant + frais des défauts) n'a lieu qu'au dénouement.
- **Opérations (ADMIN / SUPER_ADMIN)** : vérifier un compte, le créditer (virement entrant),
  confirmer/bloquer/lever/refuser, répondre au chat, ajuster coûts et activation des défauts —
  ces surcharges ne touchent que l'appareil (démo), la table canonique reste `operations/virements.json`.
- **Messagerie** client ⇄ support par compte, persistée localement.
- `lib/banque.ts` est pur et verrouillé (`tests/unit/banque.spec.ts`, 120 tests au total) ;
  `check:regles` valide aussi le référentiel (pct croissants vers 100, codes, coûts, libellés ×4).

### Slice 9 — écran SUPER_ADMIN de l'historique des grilles

- Onglet réservé SUPER_ADMIN : chaque version de `rate_be/grille.json` en carte — période d'effet,
  note, **sceaux** (hash de l'entrée + hash précédent, copiables) avec badge « Chaînon valide »,
  paliers, table produits, et les règles `rate_BE_…` dérivées en dépliable.
- Les règles affichées sortent de `reglesDeEntree` — la MÊME fonction que le simulateur pour la
  grille effective ; l'écran et le moteur ne peuvent plus diverger (verrou jest).
- **Sonde d'audit daté** : une date en entrée → la version de grille applicable ce jour-là.

### Slice 10 — backend réel : API + authentification serveur

- **Route Handlers Node** (`frontend/app/api/…`) : `/api/auth/inscription|connexion|deconnexion|
  session|mdp`, `/api/grille`, `/api/grille/sonde?date=`, `/api/simuler` — toutes `force-dynamic`,
  JSON strict, validations d'entrée, codes d'erreur honnêtes (400/401/409/422).
- **Authentification réelle** : mots de passe **scrypt salés** (jamais de clair, jamais de simple
  SHA-256 côté serveur), jetons de session aléatoires conservés côté serveur avec expiration 7 j,
  cookie `kredit_session_v1` httpOnly + SameSite=Lax ; comptes du personnel semés à la première
  ouverture du magasin (identifiants de démonstration, affichés comme tels).
- **Le miroir devient réel** : `/api/grille` sert la table canonique lue par le serveur (versions,
  chaînons validés, règles effectives dérivées par le même moteur) ; `/api/simuler` répond avec les
  mêmes mensualités/règles/version que le frontend ; l'écran SUPER_ADMIN affiche un badge « API
  serveur : le backend lit la même table » vérifié à chaque ouverture (rouge si l'API diverge ou
  est injoignable — honnêtement).
- La page d'authentification se connecte au serveur (boutons démo compris) ; le portail garde son
  miroir local pour le profil et la banque — l'authentification, elle, fait foi côté serveur.
- Domaine serveur pur et testable sans HTTP (`lib/serveur.ts`, dossier de stockage injectable) ;
  `tests/unit/serveur.spec.ts` verrouille scrypt, sessions, semis, et l'égalité du miroir
  (132 tests au total).

### Slice 11 — la banque sur l'API (le serveur est la seule autorité)

La banque de la slice 8 vivait en localStorage : chaque appareil calculait l'état. Ça suffisait
en démo, mais rien n'empêchait un navigateur de forger un solde ou de sauter un niveau de
validation. La slice 11 retire le localStorage bancaire : **l'UI n'applique plus jamais une
transition — elle envoie une intention, le serveur applique la machine à états pure et renvoie
l'état**. Personne ne peut tricher, et tous les postes voient le même compte.

- **Cinq Route Handlers de plus** (`frontend/app/api/banque/…`) : `/api/banque` (GET = son compte
  + le référentiel effectif ; POST = intentions client : virement, annuler, chat, photo),
  `/api/banque/comptes` (vue ADMIN : tous les comptes clients), `/api/banque/operations`
  (POST staff : verifier/crediter/confirmer/bloquer/lever/refuser/chat), `/api/banque/chat`
  (GET par compte) et `/api/banque/referentiel` (GET ; POST surcharges, staff uniquement).
  Mêmes exigences que la slice 10 : `force-dynamic`, JSON strict, codes d'erreur honnêtes.
- **Même machine à états, appliquée côté serveur** : `lib/serveur-banque.ts` appelle les fonctions
  pures de `lib/banque.ts` (la MÊME que la démo locale) sur le magasin. Le client n'envoie que
  des intentions ; un compte non vérifié se voit refuser le virement (`non_verifie`), le pipeline
  confirme niveau par niveau jusqu'à EXECUTION puis dénoue le solde, un défaut du référentiel
  bloque exactement au niveau atteint et son coût entre dans la réserve. La photo de profil est
  plafonnée (413 au-delà de 5 Mo).
- **Autorisations** : CUSTOMER n'agit que sur SON compte (403 sur tout le reste), ADMIN /
  SUPER_ADMIN agissent sur tous les comptes. Le chat reste isolé par compte. Les surcharges du
  référentiel (coût/activation des défauts) sont réservées au staff et vivent dans le magasin
  serveur — la table canonique `operations/virements.json` reste la source.
- **L'inscription ouvre la banque** côté serveur (IBAN BE fictif mais formellement valide +
  dotation démo) ; le tableau de bord client et le portail opérations lisent IBAN, photo et état
  via l'API. `lib/banque.ts` perd toute sa persistance navigateur (il ne reste que la logique pure
  + `cleBanque` + `MessageChat`).
- **Si l'API est injoignable, l'UI le dit** (`banque.apiDown` ×4) au lieu d'inventer un état —
  pas de donnée fausse, pas de faux « tout va bien ».
- `tests/unit/serveur-banque.spec.ts` verrouille l'autorité serveur : ouverture idempotente,
  refus `non_verifie`, pipeline ×4 → EXECUTE + débit au dénouement, blocage/réserve/coût,
  lever/refuser/annuler, autorisations 403, photo 413, surcharges réservées au staff, table
  canonique intacte (143 tests au total).

### Slice 12 — espaces Admin / Super Admin activés : KYC, dossiers, journal ; démo « vitrine »

Deux constats des captures utilisateurs corrigés d'un coup : le namespace `banque` n'était pas
monté dans le bundle i18n (des clés s'affichaient telles quelles) et des appels historiques
`tr("ns.cle")` (point au lieu de deux-points) ne résolvaient jamais. `lib/i18n.ts` monte
`banque` ×4 et `t()` tolère désormais la forme pointée ; plus une clé ne peut s'afficher crue
sans que la parité/usage ne casse en CI.

- **Espace opérations restructuré en quatre sections** : « Clients & KYC » (table de tous les
  comptes : état KYC, solde, virements à traiter, **validation/révocation KYC** en un bouton,
  ouverture du dossier), « Dossier client » (profil complet servi par le serveur — identité,
  adresse, activité, revenus —, banque : IBAN/solde/disponible/réservé, crédit, **tous les
  virements** avec pipeline et blocages, chat), « Transactions » (**journal de toutes les
  transactions, tous clients**, daté, signé, motifs résolus) et « Référentiel » (surcharges).
- **Le serveur fait foi pour le profil** : `/api/auth/session` renvoie `profil` et `creeA` du
  compte serveur ; l'onglet Profil client les affiche (plus de « profil vide » pour les comptes
  démo ou inscrits).
- **Compte démo « vitrine »** : `client@kredit.be` arrive **vérifié** (le virement sortant est
  possible immédiatement) avec un salaire fictif, un virement EXÉCUTÉ, un EN COURS (niveau 2/4),
  un BLOQUÉ (défaut CERT_ASSURANCE) et un échange de chat — chaque état du pipeline est illustré.
  Construit en appliquant la machine pure (soldes/réserves cohérents, verrou jest) ; les motifs
  et le chat portent des **clés i18n** résolues à l'affichage par `tSiCle` (le contenu libre saisi
  par un vrai utilisateur passe tel quel). Un nouvel inscrit repart vierge.
- Bannière de sécurité honnête : « Compte de démonstration — authentification et banque servies
  par l'API (session httpOnly) » ×4 (l'ancienne disait « rien n'est envoyé », faux depuis la
  slice 10).

### Slice 13 — ordre de virement complet : adresse, BIC/SWIFT, aperçu avant envoi ; solde métier ; KYC vivant

Corrections et compléments demandés sur captures, appliqués UI + serveur + verrous :

- **Solde affiché = total des fonds − virements en cours ou bloqués** : le grand chiffre du
  portail client est désormais le disponible (définition métier posée par l'utilisateur) ; le
  détail « total des fonds / réservé » reste affiché dessous (`banque:funds` ×4).
- **KYC vivant côté client** : la pastille de l'aperçu passe de « en attente » (ambre) à
  « KYC vérifié » (émeraude) dès que l'administration valide — l'état vient du serveur
  (`dashboard.kyc.verified` / `kycHowVerified` ×4). Un miroir local périmé (cookie orphelin après
  reset du store) renvoie désormais vers l'authentification au lieu d'afficher un compte à 0 €.
- **Ordre de virement complet** : champs « Adresse du bénéficiaire » et « BIC / SWIFT » au
  formulaire ; le serveur **exige** l'adresse et un BIC ISO 9362 valide (`bicValide`, 8 ou 11
  caractères, insensible à la casse) — 400 `adresse_manquante` / `bic_invalide` sinon ; l'ordre
  stocke adresse + BIC et les écrans client/ops les montrent.
- **Aperçu avant initiation** : « Confirmer » passe d'abord par un panneau récapitulatif
  (bénéficiaire, adresse, IBAN, BIC, motif, montant) avec « Confirmer l'ordre » / « Modifier » ;
  rien n'est envoyé avant la confirmation explicite.
- Verrous : `tests/unit/serveur-banque.spec.ts` (ordre incomplet refusé, BIC/adresse conservés,
  formes BIC valides/invalides) — 146 tests au total.

### Slice 14 — un vrai menu Profil : adresse & téléphone éditables côté serveur, sécurité serveur

Le menu Profil était surtout de la lecture. La slice 14 en fait un vrai menu profil : on peut y
**modifier son adresse et son téléphone, enregistré côté serveur** ; le changement de mot de passe
devient entièrement serveur.

- **`POST /api/auth/profil`** : session requise, et **liste blanche** — seuls les champs éditables
  par le client lui-même passent (rue/numéro/boîte, code postal, ville, pays, téléphone, situation
  professionnelle, revenus, IBAN, crédits existants) ; les champs d'identité et les énumérations
  admin (état civil, logement) sont **ignorés**, valeurs bornées à 200 caractères. Verrou :
  `tests/unit/serveur.spec.ts` (le pirate ne change ni prénom ni nom ni naissance).
- **Contact éditable** : bloc « Adresse & téléphone » (rue, numéro, boîte, code postal, ville,
  pays, mobile) avec « Enregistrer » → API, confirmation visuelle, rechargement du miroir local.
- **Profil complet** : identité (photo + nom, email, KYC, IBAN), informations personnelles en
  lecture (naissance, nationalité, état civil, situation pro, logement, revenus), informations
  liées au prêt (IBAN, prêts existants) avec lien vers les demandes.
- **Changement de mot de passe serveur** : la carte Sécurité envoie `{actuel, nouveau}` à
  `/api/auth/mdp` (contrôle scrypt du mot actuel) — plus aucune empreinte calculée côté client.
- 4 clés `banque:profile.*` ajoutées ×4 pour la parité (973 clés au total).

### Slice 15 — barre de progression interactive : évolution automatique, arrêt motivé, déblocage par code

La barre de validation d'un virement devient **vivante et interactive** : après l'initiation elle
**évolue d'elle-même** (animée, `prefers-reduced-motion` respecté) et **s'arrête au niveau
paramétré par l'administration** — chaque défaut actif du référentiel porte désormais son niveau
d'arrêt (`pct` dans `operations/virements.json`, surcharges admin inchangées).

- **À l'arrêt**, la barre pulse en rouge et le panneau d'arrêt affiche : le **motif** (défaut),
  les **explications** (`banque:defaut.<CODE>.explain` ×4), le **montant à régler** (somme des
  coûts des défauts du niveau) et **une case code de déblocage**.
- **Sans le bon code, la barre reste figée à ce niveau.** Le code (6 caractères) est émis par le
  serveur à chaque arrêt ; l'administration le lit dans le dossier client (« à communiquer après
  règlement du montant ») ; le client le renseigne et la barre **repart** jusqu'au prochain arrêt
  ou jusqu'à 100 % (exécution + dénouement, frais des défauts inclus). Mauvais code → 400, rien
  ne bouge. Codes **jamais servis au client** (vue dédiée `vueClientCompte`).
- L'administration garde : référentiel (activer/désactiver un défaut = ajouter/retirer un arrêt,
  coûts), **lever** sans code (geste commercial — la machine repart au prochain arrêt), refuser,
  KYC, crédits, chat. Les confirmations manuelles niveau par niveau sont remplacées par
  l'évolution automatique.
- Verrous : `tests/unit/banque.spec.ts` (arrêts 30/60, mauvais/bon code insensible à la casse,
  exécution au dernier déblocage, référentiel libéré → exécution directe, lever) et
  `tests/unit/serveur-banque.spec.ts` (code masqué côté client, lu côté admin, déblocages
  successifs → EXECUTE + dénouement) — 150 verrous au total.

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
├── rate_be/grille.json        LA table de la grille BE : paliers, produits, frais, historique hash-chaîné
├── operations/virements.json  LE référentiel des virements : niveaux de validation, défauts, coûts
└── frontend/
    ├── app/                   layout racine, [locale] (accueil, simulateur, demande, auth, offline…), api/ (auth, grille, simuler, banque)
    ├── components/            layout/ motion/ ui/ home/ simulator/ auth/ pwa/
    ├── i18n/                  12 namespaces × 4 langues, parité stricte
    ├── lib/                   i18n, intl, formatters, locale-detection, credit-engine, banque (pure), serveur, serveur-banque, api, motion…
    ├── scripts/               les gardes (dont check-regles : grille + référentiel) + fresh.mjs
    └── tests/unit/            parité, clés, hydratation/Intl, motion, grille, échéancier, banque, serveur, serveur-banque (150 verrous)
```

## Commandes

```bash
npm run dev                # serveur de dev (0.0.0.0:3000, compile dans .next-dev)
npm run build && npm run start
npm run check              # typecheck + hydration + copy + routes + règles (grille partagée)
npm run check:assets       # serveur lancé: chaque ressource du HTML (accueil + simulateur + demande × 4 locales) est servie
npm run check:state        # l'état du poste (pull arrivé, .next cohérent, chunks = disque)
npm run test:unit          # les verrous jest
npm run fresh              # remise à zéro du dev (processus + .next-dev), sans taper 5 commandes
```

## Feuille de route (une passe = un écran visible)

1. **Accueil** — fait (slice 1 + habillage Dewi).
2. **Simulateur** — fait (réglettes, score, échéancier ; verrous échéancier posés).
3. **Demande pré-remplie** — fait (query rendue côté serveur, persistance locale honnête).
4. **Portail** — fait (auth 3 profils + inscription exhaustive + espace connecté local).
5. **Tableau de bord client** — fait (aperçu néo-banque, demandes, échéanciers projetés, documents,
   notifications, profil & sécurité).
6. **PWA** — fait (worker v9, hors-ligne sécurisé, installation, pages offline ×4).
7. **Miroir backend de la grille** — fait (`rate_be/grille.json` : paliers, bornes produits, frais
   et historique hash-chaîné ; le moteur frontend la lit, le futur backend lira le même fichier ;
   identifiants `rate_BE_…` dérivés de la table ; garde `check:regles`).
8. **Banque du compte client** — fait (solde + réservé, IBAN fictif mais formellement valide,
   mouvements, virements sortants avec pipeline de validation par niveaux et blocages pour défaut,
   chat client ⇄ support, opérations admin ; référentiel canonique `operations/virements.json`).
9. **Écran SUPER_ADMIN de l'historique des grilles** — fait (versions scellées, chaînons validés,
   paliers/produits/règles dérivées par version, sonde d'audit daté).
10. **Backend réel : API + authentification serveur** — fait (Route Handlers Node : inscription,
    connexion/déconnexion/session, changement de mot de passe, `/api/grille`, sonde datée,
    `/api/simuler` ; scrypt salé, sessions httpOnly ; le serveur lit les mêmes tables canoniques).
11. **Banque sur l'API** — fait (le localStorage bancaire prend sa retraite : l'UI envoie des
    intentions, le serveur applique la machine à états pure ; virements/pipeline/chat/surcharges
    côté serveur, autorisations CUSTOMER/staff, photo plafonnée, état honnête si l'API tombe).
12. **Espaces Admin/Super Admin activés + démo vitrine** — fait (sections Clients & KYC avec
    validation/révocation et dossier complet par client, journal des transactions tous clients,
    profil servi par le serveur, compte démo vérifié avec historique illustratif ; namespace
    `banque` monté ×4 et tolérance `ns.cle` dans `t()`).
13. **Ordre de virement complet** — fait (adresse bénéficiaire + BIC/SWIFT exigés et validés côté
    serveur, aperçu de l'ordre avant initiation, solde affiché = fonds − encours/bloqués, pastille
    KYC client pilotée par la validation admin, miroir local périmé renvoyé vers l'auth).
14. **Vrai menu Profil** — fait (adresse & téléphone éditables persistés serveur via liste blanche,
    identité / situation / logement en lecture, sécurité : changement de mot de passe serveur).
15. **Barre de progression interactive** — fait (évolution automatique après initiation, arrêt au
    niveau paramétré par l'admin avec motif + explications + montant à régler, déblocage par code
    émis côté admin, barre figée sans code, rejusqu'à 100 %).
    Prochaine passe : e2e Playwright sur /api, durcissement (rate-limit, rotation de sessions).
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
