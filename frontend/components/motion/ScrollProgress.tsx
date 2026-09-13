"use client";
/**
 * Barre de lecture collée sous l'en-tête : la proportion de page déjà parcourue.
 *
 * Écrit en `transform: scaleX()` sur un nœud hors flux, pas en `width` — animer une largeur
 * remettrait en page tout le document, frame après frame. Le style est posé par effet sur le nœud
 * (et non en prop React) : le composant ne rend qu'une fois, ce qui rend l'écouteur de scroll gratuit
 * pour le reste de l'arbre.
 *
 * `aria-hidden` parce que le pourcentage de scroll n'est une information pour personne au lecteur
 * d'écran, et qu'un rôle de « progressbar » y mentirait (il ne progresse vers rien).
 */
import { useEffect, useRef } from "react";
import { useProgression } from "@/lib/motion";

export default function ScrollProgress() {
  const p = useProgression();
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const n = ref.current;
    if (n) n.style.setProperty("--p", String(Math.round(p * 10000) / 10000));
  }, [p]);

  return <span ref={ref} data-scroll-progress aria-hidden="true" />;
}
