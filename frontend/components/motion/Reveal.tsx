"use client";
/**
 * Apparition à l'entrée dans le viewport.
 *
 * Le nom de la variante va dans un attribut `data-reveal`, et la géométrie (translation, échelle,
 * flou) se décide dans `app/globals.css` — pas en JavaScript. Raison: la feuille de style est le seul
 * endroit où `prefers-reduced-motion` et le fallback sans JS peuvent annuler *la même* règle que
 * l'animation. Un `style={{ transform }}` calculé ici serait invisible du média query.
 *
 * Ce composant n'ajoute **aucun nœud** au-delà de la balise qu'il rend (`as`) : une div de plus autour
 * d'une carte casserait les grilles et ferait rugir `check:dom-nesting`.
 *
 * Deux choses sont volontairement écrites dans le HTML servi :
 * - `data-shown="false"` : le premier rendu client est identique au serveur, donc l'hydratation n'est
 *   pas perturbée ; ce n'est qu'ensuite que l'observateur bascule l'état ;
 * - l'état « caché » ne vit que dans le CSS, neutralisé sans JS (le `<noscript>` posé par
 *   `app/layout.tsx`) comme en mouvement réduit — un contenu qui dépendrait d'un effet pour être
 *   lisible n'est pas un contenu.
 */
import { type CSSProperties, type ElementType, type ReactNode } from "react";
import { useInView, useSpotlight } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type RevealVariant = "up" | "fade" | "left" | "right" | "scale" | "blur" | "rise";

export default function Reveal({
  children,
  as: Balise = "div" as ElementType,
  variant = "up",
  retard = 0,
  pas,
  seuil,
  uneFois = true,
  spotlight = false,
  className,
  ...reste
}: {
  children: ReactNode;
  as?: ElementType;
  variant?: RevealVariant;
  /** Décalage en ms — pour une rafale, le calculer (`i * 70`), ne pas l'écrire à la main. */
  retard?: number;
  /** Amplitude en px quand celle de la variante ne convient pas (gros blocs, pleines largeurs). */
  pas?: number;
  seuil?: number;
  uneFois?: boolean;
  /** Ajoute le halo qui suit le pointeur (`.spot`) sur le même nœud, sans wrapper. */
  spotlight?: boolean;
  className?: string;
  [cle: string]: unknown;
}) {
  const { setRef, vu } = useInView<HTMLElement>({ seuil, uneFois });
  const spot = useSpotlight<HTMLElement>();
  // Deux hooks, un seul nœud : les deux refs sont alimentées par la même callback. Sans ça, il faudrait
  // une div de plus — et dans une grille, une div de plus change la liste des items.
  const refComposée = (el: HTMLElement | null) => {
    setRef(el);
    spot.current = el;
  };
  const style: CSSProperties & Record<string, string> = {};
  if (retard) style["--reveal-delay"] = retard + "ms";
  if (pas !== undefined) style["--reveal-y"] = pas + "px";

  return (
    // `as` est choisi par l'appelant parmi des balises de conteneur ; le cast évite de genericiser
    // toute la chaîne de props pour un seul attribut de ref.
    <Balise
      ref={refComposée as never}
      data-reveal={variant}
      data-shown={vu ? "true" : "false"}
      style={Object.keys(style).length ? style : undefined}
      className={cn(spotlight && "spot", className)}
      {...reste}
    >
      {children}
    </Balise>
  );
}
