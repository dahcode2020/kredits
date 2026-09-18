/**
 * @jest-environment jsdom
 */
/**
 * Verrou de confidentialité du pipeline de validation (slice 22, demande explicite) :
 * « Le client ne doit pas voir ou connaître les niveaux de validation au préalable. »
 *
 * La barre de pipeline (niveaux, seuils en %, légende) est RÉSERVÉE à l'administration
 * (OpsPortal) ; le client suit une barre CONTINUE sans noms ni seuils des niveaux à venir.
 * Ce test rend le portail bancaire client complet avec un virement bloqué et un virement
 * en cours, puis exige :
 *  - que le client voie toujours son statut opérationnel et de quoi lever l'arrêt
 *    (motif, montant à régler, champ code — slice 15) ;
 *  - que RIEN dans le rendu client ne révèle les niveaux (ni légende, ni « Arrêt au
 *    niveau X % », ni titre du pipeline).
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import BankPortal from "@/components/auth/BankPortal";
import { referentielEffectif, type BanqueCompte } from "@/lib/banque";
import { formatEUR2 } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const COMPTE: BanqueCompte = {
  iban: "BE68539007547034", verifie: true, photo: null,
  transactions: [
    { id: "TX-1", sens: "entrant", montant: 4000, date: "2026-09-10T00:00:00.000Z", contrepartie: "Employeur", motifLibre: "banque.tx.demoSalary" },
  ],
  virements: [
    {
      id: "VIR-20260914-001", beneficiaireNom: "Fournisseur", beneficiaireIban: "BE71096123456769",
      montant: 2500, motif: "Facture", creeA: "2026-09-14T09:00:00.000Z", statut: "BLOQUE", niveau: 1,
      blocages: [{ code: "CERT_ASSURANCE", cout: 120, depuis: "2026-09-15T09:00:00.000Z" }],
    },
    {
      id: "VIR-20260914-002", beneficiaireNom: "Autre", beneficiaireIban: "BE71096123456769",
      montant: 100, motif: "Divers", creeA: "2026-09-14T10:00:00.000Z", statut: "EN_COURS", niveau: 2, blocages: [],
    },
  ],
};

const reponse = (corps: unknown) =>
  ({ ok: true, status: 200, json: async () => corps }) as unknown as Response;

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/banque/chat")) return reponse({ messages: [] });
    if (u.startsWith("/api/banque")) return reponse({ compte: COMPTE, referentiel: referentielEffectif() });
    if (u.startsWith("/api/notifications")) return reponse({ notifications: [] });
    return reponse({});
  }) as jest.Mock;
});

let root: Root | null = null;
afterEach(() => { act(() => { root?.unmount(); }); root = null; });

it("le client voit statut + motif + montant + code, mais JAMAIS les niveaux de validation", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(
      <BankPortal
        locale={"fr" as Locale}
        session={{ email: "client@demo.be", role: "CUSTOMER", nom: "Cliente Démo", ouverteA: "2026-09-01T00:00:00.000Z" }}
      />,
    );
  });
  // Laisse les effets de chargement (fetch) se poser.
  await act(async () => { await Promise.resolve(); });

  const txt = el.textContent ?? "";

  // — Le nécessaire reste visible (statut opérationnel + moyens de lever l'arrêt, slice 15).
  expect(txt).toContain(t("fr", "banque:vir.BLOQUE"));
  expect(txt).toContain(t("fr", "banque:vir.EN_COURS"));
  expect(txt).toContain(t("fr", "banque:vir.stopTitleClient"));
  expect(txt).toContain(t("fr", "banque:defaut.CERT_ASSURANCE"));
  expect(txt).toContain(t("fr", "banque:vir.stopAmount", { montant: formatEUR2(120, "fr") }));

  // — Le SOLDE affiche le total RÉEL des fonds, jamais « 0,00 € » (régression du compteur animé
  // qui recevait la cible 0 au lieu du solde).
  await act(async () => { await new Promise((r) => window.setTimeout(r, 1050)); });
  expect(el.textContent ?? "").toContain(formatEUR2(4000, "fr"));

  // — Le suivi EN DIRECT (slice 22) est là : barre continue, jamais la légende des niveaux.
  expect(txt).toContain(t("fr", "banque:vir.live.title"));
  expect(txt).toContain(t("fr", "banque:vir.live.suspended"));

  // — Les niveaux de validation sont totalement cachés au client.
  for (const code of ["RECEPTION", "CONFORMITE", "CERTIFICATS", "EXECUTION"]) {
    expect(txt).not.toContain(t("fr", `banque:pipeline.${code}`));
  }
  expect(txt).not.toContain(t("fr", "banque:pipeline.title"));
  expect(txt).not.toContain("Arrêt au niveau");
  expect(txt).not.toContain("· 10 %");
  expect(txt).not.toContain("· 30 %");
  expect(txt).not.toContain("· 60 %");
});
