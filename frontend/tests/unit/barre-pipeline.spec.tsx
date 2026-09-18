/**
 * @jest-environment jsdom
 */
/**
 * Verrou de rendu de la barre de pipeline — vue ADMINISTRATION (OpsPortal ; le client n'y a
 * plus accès depuis la slice 22, voir tests/unit/pipeline-cachee-client.spec.tsx).
 *
 * Régression attrapée en production (slice 13) : la barre recevait son référentiel sous le nom
 * `ref` — prop RÉSERVÉ par React, jamais transmise à un composant fonction — et l'écran plantait
 * sur `ref.pipeline` dès qu'un virement existait à afficher. Ce test rend la barre avec le prop
 * `referentiel` et exige les quatre niveaux du référentiel canonique à l'écran.
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { BarrePipeline } from "@/components/auth/BankPortal";
import { referentielEffectif, type Virement } from "@/lib/banque";
import { t, type Locale } from "@/lib/i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const V: Virement = {
  id: "VIR-20260914-001", beneficiaireNom: "X", beneficiaireIban: "BE68539007547034",
  montant: 100, motif: "m", creeA: "2026-09-14T00:00:00.000Z", statut: "EN_COURS", niveau: 2, blocages: [],
};

let root: Root | null = null;
afterEach(() => { act(() => { root?.unmount(); }); root = null; });

it("rend les 4 niveaux du référentiel sans planter (prop referentiel, jamais ref)", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  const tr = (k: string, vars?: Record<string, string | number>) => t("fr" as Locale, k, vars);
  act(() => { root!.render(<BarrePipeline v={V} referentiel={referentielEffectif()} tr={tr} />); });
  const txt = el.textContent ?? "";
  for (const code of ["RECEPTION", "CONFORMITE", "CERTIFICATS", "EXECUTION"]) {
    expect(txt).toContain(t("fr", `banque:pipeline.${code}`));
  }
  expect(txt).toContain("30 %"); // niveau 2 confirmé → progression 30 %
});
