/**
 * @jest-environment jsdom
 */
/**
 * Verrou de l'interligne serré du titre du héro (demande explicite : « réduire l'interligne »).
 *
 * Régression attrapée en production : `leading-[0.95]` écrit AVANT les tailles `text-[42px]`
 * était supprimé silencieusement par tailwind-merge (conflit font-size / line-height dans `cn`),
 * et le titre retrouvait l'interligne par défaut, très aéré. Ce test rend le héro et exige que
 * la classe d'interligne serré survive sur le h1 — et que les CTA gardent leurs destinations
 * réelles (simulateur + ancre produits).
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import Hero from "@/components/home/Hero";
import { type Locale } from "@/lib/i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => { root?.unmount(); }); root = null; });

it("le h1 du héro garde son interligne serré (leading après les tailles) et ses CTA réels", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => { root!.render(<Hero locale={"fr" as Locale} />); });
  const h1 = el.querySelector("h1");
  expect(h1).not.toBeNull();
  expect(h1!.className).toContain("leading-[0.95]");
  expect(h1!.className).toContain("text-[42px]");
  // CTA : destination réelle (route du simulateur) + ancre de la page.
  const liens = [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  expect(liens).toContain("/fr/credit/simulator");
  expect(liens).toContain("#produits");
});
