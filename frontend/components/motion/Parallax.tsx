"use client";
/**
 * Décalage vertical proportionnel au scroll — la profondeur du visuel de tête.
 *
 * `translate3d` uniquement, écrit sur le nœud en fin de frame (le bus de `lib/motion.ts` en regroupe
 * un seul par page, partagé par tous les `Parallax`) : pas de `top`, pas de `margin`, donc pas de
 * recalcul de mise en page. Amplitude faible par défaut — au-delà de ~30 px sur un visuel en
 * `object-cover`, le bord de l'image entre dans le cadre et l'effet se voit comme un défaut.
 */
import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { useParallaxe } from "@/lib/motion";
import { cn } from "@/lib/utils";

export default function Parallax({
  children,
  as: Balise = "div" as ElementType,
  amplitude = 18,
  className,
  ...reste
}: {
  children: ReactNode;
  as?: ElementType;
  /** Déplacement maximal en px, vers le haut comme vers le bas. */
  amplitude?: number;
  className?: string;
  [cle: string]: unknown;
}) {
  const y = useParallaxe(amplitude);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    // AUCUNE écriture à 0: un réglage système qui bascule en cours de session doit rendre le nœud
    // exactement comme avant l'animation, pas laisser un `--py: 0px` orphelin (et 0 px ne se peint pas).
    if (y === 0) n.style.removeProperty("--py");
    else n.style.setProperty("--py", Math.round(y * 100) / 100 + "px");
  }, [y]);

  return (
    <Balise ref={ref as never} data-parallax="" className={cn("parallax", className)} {...reste}>
      {children}
    </Balise>
  );
}
