"use client";
/**
 * Primitives de mouvement — la couche qui décide *quand* une animation joue, et jamais *à quel point*
 * elle est belle (ça, c'est `app/globals.css`, section « Motion »).
 *
 * Trois règles commandent tout le fichier, parce que ce site est rendu par le serveur en quatre langues :
 *
 * 1. **Rien au render.** Ni `matchMedia`, ni `IntersectionObserver`, ni `window` pendant le rendu.
 *    Le premier rendu client doit être identique au HTML servi, sinon React remplace l'arbre entier
 *    (et l'erreur d'hydratation masque la vraie panne, cf. docs/hydration.md). Donc : un état initial
 *    stable, et la mesure dans les effets.
 * 2. **Le texte final est toujours celui du HTML.** Une animation de nombre ne « produit » jamais le
 *    libellé : elle part du texte déjà affiché, joue, et **revient exactement à ce texte**. Aucun
 *    risque que l'animation finisse sur `8,400` là où le serveur a écrit `8 400+` — l'écart de
 *    formatage entre ICU serveur et navigateur est justement le sujet de `normalizeIntlSpaces`.
 * 3. **`prefers-reduced-motion` annule, il ne remplace pas.** Quand l'utilisateur demande moins de
 *    mouvement, les hooks ne rendent pas un état intermédiaire : ils rendent l'état final, tout de
 *    suite. Le CSS fait la même chose de son côté, pour que ça tienne même sans JavaScript.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Easing « sortie lente » — la courbe de presque tout le site. */
const EASE_OUT_EXPO = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Lecture *synchron*e de la préférence, à n'utiliser que dans un effet.
 *
 * Indispensable à côté de `usePrefersReducedMotion`: l'état du hook arrive un commit après le
 * démarrage de l'animation, donc la toute première frame jouerait quand même chez un utilisateur qui
 * a demandé moins de mouvement — le clignotement exact que la préférence doit supprimer. Un média
 * query se lit au moment de décider, pas au moment de re-render.
 */
function reduitMaintenant(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false; // matchMedia absent (vieux navigateurs, environnements tronqués): on animera, le CSS garde la main
  }
}

/** Préférence de mouvement. `false` au render ET au premier rendu client : la bascule se fait en effet. */
export function usePrefersReducedMotion(): boolean {
  const [reduit, setReduit] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduit(mq.matches);
    const sur = (e: MediaQueryListEvent) => setReduit(e.matches);
    // Safari < 14 n'a que addListener ; un seul chemin de souscription garde le code testable.
    if (mq.addEventListener) mq.addEventListener("change", sur);
    else mq.addListener(sur);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sur);
      else mq.removeListener(sur);
    };
  }, []);
  return reduit;
}

/**
 * Entrée dans le viewport. `uneFois` verrouille l'état : rejouer une apparition à chaque remontée de
 * scroll donne un effet de yo-yo sur une page de marketing, et fait disparaitre du contenu déjà lu.
 * Sans `IntersectionObserver` (navigateur ancien, jsdom), on considère que c'est visible — le contenu
 * n'est jamais la variable d'ajustement d'un effet de style.
 */
export function useInView<T extends Element>(opts: { seuil?: number; marge?: string; uneFois?: boolean } = {}) {
  const { seuil = 0.15, marge = "0px 0px -8% 0px", uneFois = true } = opts;
  const ref = useRef<T | null>(null);
  const [vu, setVu] = useState(false);
  // Ref en callback, en plus du ref objet: un composant qui doit aussi tenir son propre nœud (pour
  // y écrire un style) ne doit pas avoir à forcer le champ `.current` d'un ref d'emprunt.
  const setRef = useCallback((el: T | null) => {
    ref.current = el;
  }, []);

  useEffect(() => {
    const cible = ref.current;
    if (!cible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVu(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          if (e.isIntersecting) {
            setVu(true);
            if (uneFois) obs.disconnect();
          } else if (!uneFois) {
            setVu(false);
          }
        }
      },
      { threshold: seuil, rootMargin: marge },
    );
    obs.observe(cible);
    return () => obs.disconnect();
  }, [seuil, marge, uneFois]);

  return { ref, setRef, vu };
}

/**
 * Interpolation vers `cible`. `animer=false` => l'état est posé instantanément (reduced motion,
 * `IntersectionObserver` absent, première paint hors écran). L'appelant garde la main sur la valeur
 * *finale affichée* via `texteFinal` : la boucle ne fait que passer par les valeurs intermédiaires.
 */
export function useTween(
  cible: number,
  opts: { duree?: number; animer: boolean; demarre: boolean },
): { valeur: number; joue: boolean } {
  const { duree = 900, animer, demarre } = opts;
  const [valeur, setValeur] = useState(cible);
  const [joue, setJoue] = useState(false);
  const depuisRef = useRef(cible);
  const rafRef = useRef<number | null>(null);
  // « a joué » et « a été posé sans jouer » sont DEUX états distincts. Les confondre (un seul booléen)
  // faisait croire qu'un compteur jamais animé l'avait été: déclenché par le viewport, il restait
  // figé sur sa valeur finale. Trouvé par tests/unit/motion.spec.tsx, pas par la relecture.
  const aJoueRef = useRef(false);

  useEffect(() => {
    if (!animer || !demarre || reduitMaintenant()) {
      // On ne joue pas : on pose la cible, sans toucher à `aJoueRef` (voir ci-dessus).
      setJoue(false);
      setValeur(cible);
      depuisRef.current = cible;
      return;
    }
    // Une cible inchangée après une lecture complète ne rejoue pas — sinon basculer la préférence
    // système en cours de session relancerait toutes les animations depuis 0.
    if (aJoueRef.current && depuisRef.current === cible) return;
    const depuis = aJoueRef.current ? depuisRef.current : 0;
    aJoueRef.current = true;
    const t0 =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    setJoue(true);
    const pas = (maintenant: number) => {
      const p = Math.min(1, (maintenant - t0) / duree);
      const v = depuis + (cible - depuis) * EASE_OUT_EXPO(p);
      setValeur(v);
      depuisRef.current = v;
      if (p < 1) {
        rafRef.current = requestAnimationFrame(pas);
      } else {
        // On atterrit sur la cible numérique, mais c'est `joue=false` qui rend au texte final: la
        // valeur affichée n'est jamais celle d'un arrondi fait ici.
        setValeur(cible);
        depuisRef.current = cible;
        setJoue(false);
      }
    };
    rafRef.current = requestAnimationFrame(pas);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [cible, animer, demarre, duree]);

  return { valeur, joue };
}

/**
 * Défilement verticalement proportionnel, en `translate3d` uniquement (jamais `top`/`marginTop` :
 * ça touche la mise en page). Renvoi `0` tant que le mouvement est réduit, donc l'appelant n'a pas
 * à dupliquer la condition.
 *
 * Un seul écouteur `passive` pour toute la page, partagé par tous les `useParallax` : multiplier les
 * écouteurs de scroll sur six visuels est la façon la plus rapide de rendre un site moins fluide
 * qu'avant l'ajout d'animations.
 */
type EcouteurScroll = () => void;
const ecouteurs = new Set<EcouteurScroll>();
let boucle: number | null = null;
let dernierY = -1;

function notifier() {
  boucle = null;
  const y = typeof window !== "undefined" ? window.scrollY || 0 : 0;
  if (y === dernierY) return;
  dernierY = y;
  for (const f of ecouteurs) f();
}

function souscrire(f: EcouteurScroll) {
  ecouteurs.add(f);
  if (typeof window !== "undefined" && window.addEventListener) {
    if (boucle === null) window.addEventListener("scroll", () => {
      if (boucle === null) boucle = requestAnimationFrame(notifier);
    }, { passive: true });
    f();
  }
  return () => {
    ecouteurs.delete(f);
    if (!ecouteurs.size && boucle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(boucle);
      boucle = null;
    }
  };
}

export function useParallaxe(amplitude = 24): number {
  const reduit = usePrefersReducedMotion();
  const [y, setY] = useState(0);
  const cleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (reduit || typeof window === "undefined" || !window.addEventListener) {
      setY(0);
      return;
    }
    const maj = () => setY(Math.max(-amplitude, Math.min(amplitude, ((window.scrollY || 0) / 320) * amplitude)));
    cleRef.current = maj;
    const desinscrire = souscrire(maj);
    return () => {
      cleRef.current = null;
      desinscrire();
    };
  }, [amplitude, reduit]);

  return y;
}

/**
 * Suit le pointeur dans un conteneur et écrit `--mx`/`--my`. Ecrit directement sur le DOM : un état
 * React par `pointermove` re-rendrait toute la section soixante fois par seconde.
 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const reduit = usePrefersReducedMotion();

  useEffect(() => {
    const cible = ref.current;
    if (!cible || reduit || reduitMaintenant() || typeof window === "undefined" || !window.PointerEvent) return;
    let raf: number | null = null;
    let dernier: { x: number; y: number } | null = null;
    const peindre = () => {
      raf = null;
      if (!dernier || !ref.current) return;
      const s = ref.current.style;
      s.setProperty("--mx", dernier.x + "%");
      s.setProperty("--my", dernier.y + "%");
    };
    const sur = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      dernier = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
      if (raf === null) raf = requestAnimationFrame(peindre);
    };
    const sortie = () => {
      dernier = null;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      cible.style.removeProperty("--mx");
      cible.style.removeProperty("--my");
    };
    cible.addEventListener("pointermove", sur);
    cible.addEventListener("pointerleave", sortie);
    return () => {
      cible.removeEventListener("pointermove", sur);
      cible.removeEventListener("pointerleave", sortie);
      sortie();
    };
  }, [reduit]);

  return ref;
}

/** Vrai dès que la page a dépassé `seuil` px — pour l'élévation de l'en-tête. Un seul booléen, pas
 * une position : re-rendre un en-tête à chaque frame est le meilleur moyen de rendre le scroll moins
 * fluide qu'avant l'animation. */
export function useSeuilScroll(seuil = 8): boolean {
  const [depasse, setDepasse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return;
    const maj = () => setDepasse((window.scrollY || 0) > seuil);
    maj();
    return souscrire(maj);
  }, [seuil]);
  return depasse;
}

/** Progression verticale de la page, entre 0 et 1 — pour la barre de lecture. */
export function useProgression(): number {
  const reduit = usePrefersReducedMotion();
  const [p, setP] = useState(0);
  useEffect(() => {
    if (reduit) return;
    const maj = () => {
      const doc = typeof document !== "undefined" ? document.documentElement : null;
      if (!doc) return;
      const total = doc.scrollHeight - doc.clientHeight;
      setP(total > 0 ? Math.min(1, Math.max(0, (doc.scrollTop || window.scrollY || 0) / total)) : 0);
    };
    const desinscrire = souscrire(maj);
    maj();
    return desinscrire;
  }, [reduit]);
  return p;
}
