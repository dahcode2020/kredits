# Mouvement — la couche d'animation du frontend

Ce site était soigné mais **immobile** : les seules animations du dépôt étaient celles des
chargeurs (`animate-pulse`, `animate-spin`) et trois classes déclarées dans `tailwind.config.js`
étaient orphelines — dont `animate-count`, qui pointait un `@keyframes countUp` **inexistant** : la
classe ne faisait rien, et rien dans l'outil ne le disait. Le vocabulaire de mouvement vit maintenant
dans `app/globals.css` (section « Motion »), et le JavaScript ne décide que *quand* jouer.

## 1. Les trois règles qui commandent le fichier

Elles ne sont pas esthétiques, elles sont structurelles — chacune correspond à une panne déjà vue sur
ce dépôt (docs/hydration.md) :

1. **Rien au render.** Pas de `matchMedia`, pas d’`IntersectionObserver`, de `window.scrollY` ou de
   `Date.now()` pendant un rendu. Le premier rendu client doit être identique au HTML servi ; sinon
   React remplace l'arbre et l'erreur d'hydratation masque la vraie cause.
2. **L'état caché appartient au CSS.** `[data-reveal]` part à `opacity: 0` *dans la feuille de
   style*. Un `style={{ opacity: 0 }}` posé depuis un composant est hors de portée de
   `prefers-reduced-motion` et du `<noscript>` : le contenu disparaîtrait pour un crawler sans
   moteur, un bloqueur de scripts et l'impression.
3. **Un compteur finit sur le texte du serveur.** `CountUp` reçoit `final`, la chaîne littérale déjà
   rendue ; l'animation part de là, joue, et **revient à cette chaîne** — jamais à une valeur
   recomposée avec l'`Intl` du navigateur. C'est ce qui rend impossible l'écart `8 400` (espace fine
   U+202F, serveur) contre `8 400` (insécable U+00A0, navigateur).

## 2. Ce qui existe

| Pièce | Rôle |
| --- | --- |
| `lib/motion.ts` | `usePrefersReducedMotion`, `useInView`, `useTween`, `useParallaxe`, `useSpotlight`, `useSeuilScroll`, `useProgression`. Un seul écouteur de scroll partagé (`souscrire`), regroupé en `requestAnimationFrame`. |
| `components/motion/Reveal.tsx` | Apparition à l'entrée dans le viewport. `as` (la balise demandée **est** l'élément animé : aucun nœud ajouté), `variant`, `retard`, `pas`, `spotlight`. |
| `components/motion/CountUp.tsx` | Nombre qui monte. `final` = texte du HTML ; `declencheur="vue"` (par défaut) ou `"montage"` (valeur qui change, comme un résultat de simulateur) ; chiffres tabulaires. |
| `components/motion/ScrollProgress.tsx` | Barre de lecture sous l'en-tête, `scaleX(var(--p))`, écrite en effet sur le nœud. |
| `components/motion/Parallax.tsx` | Décalage vertical du visuel de tête, `translate3d` uniquement, amplitude faible par défaut (16 px). |
| `app/globals.css` § Motion | Les courbes (`--motion-ease`, `--motion-out`), les utilitaires (`.lift`, `.sheen`, `.spot`, `.parallax`, `.rule`, `.motion-float`, `.motion-breath`, `.motion-pop`, `.motion-menu`) et **toutes** les sorties de secours. |

Le halo suiveur (`useSpotlight`) et l'élévation de l'en-tête (`useSeuilScroll`) n'ont pas de
composant dédié : `Reveal` expose `spotlight` et le `Header` lit un booléen, parce qu'un wrapper pour
chaque effet dans une grille change la liste des items du grid.

## 3. Les quatre échappatoires, toutes dans le CSS

Un effet doit pouvoir s'éteindre sans que le composant ait à le savoir :

- `@media (prefers-reduced-motion: reduce)` annule **l'état** (`opacity: 1`, `transform: none`), pas
  seulement la durée — une transition instantanée depuis un état caché laisse un contenu invisible ;
- `<noscript>` dans le `<head>` de `app/layout.tsx` rend `[data-reveal]` opaque sans JavaScript ;
- `@media print` neutralise révélations et parallaxe ;
- `@media (hover: none)` désactive les états `:hover` qui resteraient collés au tactile (`.lift`,
  `.sheen`, `.spot`).

Sans JS ni CSS, les primitives ont aussi un repli : `useInView` considère que c'est visible quand
`IntersectionObserver` manque. Le contenu n'est jamais la variable d'ajustement d'un effet.

## 4. Ce qui est gardé, et comment

`npm run check:hydration` connaît quatre règles de plus :

| Règle | Attrape |
| --- | --- |
| `motion-reduced-motion` | un CSS avec `@keyframes` ou `[data-reveal]` sans bloc `prefers-reduced-motion` |
| `motion-keyframes-orphelin` | un `@keyframes` que aucune règle `animation:` du même fichier ne joue (la classe morte de `animate-count`) |
| `motion-client-composant` | un fichier de `components/motion` sans `"use client"` |
| `motion-cache-au-render` | un `style={{ … opacity: 0 }}` dans `app/`, `components/`, `features/` |

Chacune est prouvée par le rouge en réinstallant le défaut, pas en relisant le regex.

`tests/unit/motion.spec.tsx` (15 cas) verrouille les invariants d'exécution : les enfants sont dans le
DOM avant que l'observateur parle ; `data-shown` passe à `true` à l'entrée dans le viewport ; sans
`IntersectionObserver` c'est visible tout de suite ; `Reveal as="li"` n'ajoute pas de `div` ; un
compteur en mouvement réduit ne demande **aucune** frame ; et il revient à la chaîne du serveur même
si `format` ment volontairement de 0,1 % (le test le force).

Deux défauts réels sont sortis de ces tests, pas de la relecture :
`useTween` confondait « posé sans jouer » et « déjà joué », donc un compteur déclenché par le viewport
ne jouait jamais ; et la préférence système, lue via un état React, arrivait un commit trop tard — la
toute première frame jouait chez un utilisateur « moins de mouvement ». Le second a été corrigé en
lisant le média query **au moment de décider** (`reduitMaintenant()`), en plus de l'état du hook.

## 5. Poser du mouvement sur un bloc nouveau

```tsx
<Reveal as="div" retard={i * 80} variant="up" spotlight className="… ma carte …">
  <h3>{tr("section.titre")}</h3>
</Reveal>

<CountUp a={montant} final={eur(montant)} format={(n) => eur(n)} duree={520} declencheur="montage" />
```

Recettes et limites :

- **`transform` et `opacity`, point final.** Animer `width`/`height`/`top`/`margin` recalcule la mise
  en page à chaque frame ; la barre de lecture et les barres de progression sont en `scaleX` pour ça.
- Le décalage d'une rafale se **calcule** (`retard={i * 80}`), jamais au hasard : `Math.random()` ou
  `Date.now()` dans un render produit un HTML serveur et un HTML client différents, hydratation cassée.
- Durées : 0,4–0,7 s pour une entrée, ≤ 0,35 s pour un retour de clic, 1,1 s max pour un compteur.
  Au-delà, une page de formulaire a l'air lente — et un utilisateur qui rebondit entre deux onglets
  lit un site figé.
- Un état « survol » ne doit jamais être le seul indice d'un état actif (cf. `aria-current` du menu).
- Chiffres animés ⇒ `tabular-nums`, sinon la ligne saute entre `9 999` et `10 000`.

## 6. Volontairement absent

- **Pas de dépendance d'animation** (framer-motion & co) : la couche fait 20 452 octets de source
  TypeScript (commentaires compris) et 8 500 octets de CSS (app/globals.css passe de 1 572 à 10 072), pour **zéro paquet ajouté** au graphe — un
  gestionnaire de mouvement tiers est surtout un endroit où le `prefers-reduced-motion`, le repli sans
  JS et le contrat d'hydratation ne sont plus écrits au même endroit que le reste du site.
- **Pas de transition de route** (`experimental.viewTransition`) : pour l'instant, parce qu'un
  crossfade de navigation se paie en cycle de vie des composants (Focus, `ScrollAndFocusHandler`) et
  que ce dépôt a déjà assez de variabilité d'hydratation pour en ajouter une.
- **Pas de scroll-jacking, ni de parallaxe > 24 px.** Sur une image en `object-cover`, une amplitude
  plus grande découvre le bord de l'image : l'effet se voit comme un défaut, et le conteneur compense
  déjà par un overscan (`-inset-[4%]`).

## 7. Mesuré sur ce dépôt (aperçu, `/fr`)

37 éléments avec `data-reveal` (cinq variantes), 9 compteurs, 11 halos suiveurs, 1 parallaxe, 1 barre
de lecture, `data-shown="false"` partout au premier rendu (contrat d'hydratation tenu), zéro
`style="…opacity: 0"` dans le HTML, et les nombres du bandeau de stats présents **dans le HTML servi**
(une animation ne retire rien à un crawler). Six routes à 200, `check:assets` à 0 échec, build de
production 119/119.
