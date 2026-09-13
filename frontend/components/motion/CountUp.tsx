"use client";
/**
 * Nombre qui monte jusqu'à sa valeur — le mouvement attendu d'un site de chiffres, et le plus
 * dangereux pour l'hydratation si on le fait mal.
 *
 * Le contrat qui rend ça sûr : `final` est **le texte que le serveur a rendu**, littéralement. Au
 * premier rendu client on affiche `final` (donc hydratation impossible à casser, quel que soit l'ICU
 * du navigateur), l'animation ne démarre qu'ensuite, et à la fin on revient *exactement* à `final` —
 * jamais à une valeur recomposée par `format`. Un `Intl` serveur qui écrit `8 400` avec une espace
 * insécable et un `Intl` client avec une espace fine normale ne peuvent donc pas se contredire : ils
 * ne s'occupent jamais du même rendu.
 *
 * `tabular-nums` n'est pas décoratif : sans lui, chaque changement de largeur de chiffre fait
 * bouger la ligne pendant la montée, et le bloc semble buggé au lieu d'animé.
 */
import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion, useTween } from "@/lib/motion";
import { cn } from "@/lib/utils";

export default function CountUp({
  a,
  final,
  format,
  duree,
  declencheur = "vue",
  className,
}: {
  /** Valeur cible de l'animation. */
  a: number;
  /** Le texte à lire une fois posé — celui du HTML servi. */
  final: string;
  /** Comment afficher les valeurs intermédiaires. Défaut : entier arrondi. */
  format?: (n: number) => string;
  duree?: number;
  /** `vue` attend l'entrée dans le viewport ; `montage` joue tout de suite (valeur qui change, comme un résultat de simulateur). */
  declencheur?: "vue" | "montage";
  className?: string;
}) {
  const reduit = usePrefersReducedMotion();
  const { setRef, vu } = useInView<HTMLSpanElement>({ seuil: 0.35 });
  const demarre = declencheur === "montage" || vu;
  const { valeur, joue } = useTween(a, { animer: !reduit, demarre, duree });
  const [txt, setTxt] = useState(final);

  // Une seule source de vérité pour le texte: `final` hors animation, l'intermédiaire pendant. La
  // dernière frame rend `final` par ce même chemin, donc le verrouillage est un `setState`, pas une
  // écriture DOM de rattrapage — un textContent posé à la main finirait écrasé au rendu suivant.
  useEffect(() => {
    setTxt(joue ? (format ? format(valeur) : String(Math.round(valeur))) : final);
  }, [joue, valeur, final, format]);

  return (
    <span ref={setRef} data-countup className={cn("tabular-nums", className)}>
      {txt}
    </span>
  );
}
