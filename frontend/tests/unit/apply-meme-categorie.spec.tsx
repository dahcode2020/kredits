/**
 * @jest-environment jsdom
 */
/**
 * Règle métier (demande utilisateur) : un client ayant un prêt EN COURS dans une catégorie
 * ne peut pas déposer une seconde demande dans la même catégorie. Verrou jsdom : avec une
 * demande PERSONAL en cours, le dépôt d'une nouvelle demande PERSONAL est refusé (alerte
 * affichée, rien n'est ajouté au localStorage) ; une autre catégorie reste possible.
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import ApplyPage from "@/components/simulator/ApplyPage";
import { CLE_STOCKAGE, DEFAUT_SIM, type DemandeLocale } from "@/lib/application";
import { t, type Locale } from "@/lib/i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const enCours: DemandeLocale = {
  id: "KRD-2026-0001", createdAt: "2026-09-01T00:00:00.000Z", statut: "SUBMITTED",
  etat: { ...DEFAUT_SIM }, nom: "Nina", email: "nina@exemple.be", telephone: "",
};

let root: Root | null = null;
afterEach(() => { act(() => { root?.unmount(); }); root = null; window.localStorage.clear(); });

const rendre = (initial = { ...DEFAUT_SIM }) => {
  act(() => { root?.unmount(); });
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => { root!.render(<ApplyPage locale={"fr" as Locale} initial={initial} />); });
  return el;
};
const cliquerDeposer = (el: HTMLElement) => {
  const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(t("fr", "credit:application.submit")));
  act(() => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

it("une demande en cours dans la même catégorie bloque le dépôt (alerte, rien n'est ajouté)", () => {
  window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify([enCours]));
  const el = rendre();
  cliquerDeposer(el);
  expect(el.textContent).toContain(t("fr", "credit:application.errSameProduct"));
  expect(JSON.parse(window.localStorage.getItem(CLE_STOCKAGE) ?? "[]")).toHaveLength(1);
});

it("une autre catégorie reste possible malgré le prêt en cours", () => {
  window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify([enCours]));
  // L'état initial par défaut est PERSONAL (comme la demande en cours) ; MORTGAGE → libre
  // (bornes grille : 20 000–1 000 000 € / 60–300 mois).
  const el = rendre({ ...DEFAUT_SIM, product: "MORTGAGE", amount: 200_000, term: 240 });
  cliquerDeposer(el);
  expect(el.textContent).not.toContain(t("fr", "credit:application.errSameProduct"));
});
