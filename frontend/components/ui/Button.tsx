import { cn } from "@/lib/utils";
import React from "react";
export type ButtonVariant = "primary"|"dark"|"ghost"|"outline"|"outline-light";
export type ButtonSize = "sm"|"md"|"lg";

// `sheen` (app/globals.css) = balayage de lumière au survol + enfoncement au clic. Posé sur la
// recette de classes, et non sur le seul <button> : les <Link> et <a> habillés de `buttonClasses`
// (presque tous les appels à l'action du site) le reçoivent aussi.
const base = "inline-flex items-center justify-center font-semibold tracking-wide transition duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 sheen";
const variants: Record<ButtonVariant,string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-card rounded-full",
  dark: "bg-ink text-white hover:bg-ink-light rounded-full",
  ghost: "bg-white/10 text-white hover:bg-white/20 rounded-full backdrop-blur",
  outline: "border border-white/20 text-white hover:bg-white hover:text-ink rounded-full",
  // Sur fond clair, un balayage blanc est invisible : `--sheen` passe à l'encre.
  "outline-light": "border border-slate-200 bg-white text-ink hover:bg-slate-50 rounded-full [--sheen:rgb(15_17_21/0.10)]",
};
const sizes: Record<ButtonSize,string> = { sm: "h-9 px-5 text-xs", md: "h-11 px-7 text-[13px]", lg: "h-[48px] px-8 text-sm" };

/**
 * Recette de classes seules — pour poser le style « bouton » sur un élément déjà sémantique
 * (<Link>, <a>) au lieu d'imbriquer un <button> dans un <a> (contenu interactif imbriqué :
 * HTML invalide, double focus clavier, et markup « réparé » par le navigateur).
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({ variant="primary", size="md", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}
export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full bg-primary-light text-primary text-[11px] font-bold tracking-widest px-3 py-1 uppercase", className)}>{children}</span>;
}
