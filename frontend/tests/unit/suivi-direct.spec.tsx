/**
 * @jest-environment jsdom
 */
/**
 * Verrou du suivi en direct (slice 22, demande : « la barre doit progresser en interactif sous
 * forme de notification push »). Le portail client sonde le serveur toutes les 4 s : ce test
 * simule deux sondages — le premier pose l'état connu (aucun toast), le second apporte deux
 * notifications neuves du pipeline (palier confirmé + arrêt exigeant le code) — et exige les
 * DEUX toasts push avec leurs variables résolues (nom du contrôle, motif du blocage), sans
 * qu'aucun niveau à venir ne soit jamais dévoilé.
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import BankPortal from "@/components/auth/BankPortal";
import { referentielEffectif, type BanqueCompte } from "@/lib/banque";
import type { NotificationServeur } from "@/lib/serveur";
import { t, type Locale } from "@/lib/i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

jest.useFakeTimers();

const COMPTE: BanqueCompte = {
  iban: "BE68539007547034", verifie: true, photo: null,
  transactions: [
    { id: "TX-1", sens: "entrant", montant: 4000, date: "2026-09-10T00:00:00.000Z", contrepartie: "Employeur", motifLibre: "banque.tx.demoSalary" },
  ],
  virements: [
    {
      id: "VIR-20260918-001", beneficiaireNom: "Fournisseur", beneficiaireIban: "BE71096123456769",
      montant: 2500, motif: "Facture", creeA: "2026-09-18T09:58:00.000Z", statut: "BLOQUE", niveau: 2,
      blocages: [{ code: "CERT_ASSURANCE", cout: 150, depuis: "2026-09-18T10:00:10.000Z", motif: "banque:defaut.CERT_ASSURANCE" }],
    },
  ],
};

const NOTIF_PALIER: NotificationServeur = {
  id: "NOTIF-PIPE-1", email: "client@demo.be", cle: "banque.vir.notify.level",
  vars: { nom: "banque:pipeline.CONFORMITE", pct: "30" }, creeA: "2026-09-18T10:00:00.000Z",
};
const NOTIF_ARRET: NotificationServeur = {
  id: "NOTIF-PIPE-2", email: "client@demo.be", cle: "banque.vir.notify.stop",
  vars: { motif: "banque:defaut.CERT_ASSURANCE" }, creeA: "2026-09-18T10:00:10.000Z",
};

const reponse = (corps: unknown) =>
  ({ ok: true, status: 200, json: async () => corps }) as unknown as Response;

let notificationsServees: NotificationServeur[] = [];

beforeEach(() => {
  notificationsServees = [];
  Element.prototype.scrollIntoView = jest.fn();
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/banque/chat")) return reponse({ messages: [] });
    if (u.startsWith("/api/banque")) return reponse({ compte: COMPTE, referentiel: referentielEffectif() });
    if (u.startsWith("/api/notifications")) return reponse({ notifications: notificationsServees });
    return reponse({});
  }) as jest.Mock;
});

let root: Root | null = null;
afterEach(() => { act(() => { root?.unmount(); }); root = null; });

it("chaque événement du pipeline arrive en toast push, variables résolues, niveaux à venir cachés", async () => {
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
  await act(async () => { await Promise.resolve(); });

  // Premier sondage : l'existant est mémorisé, AUCUN toast ne part.
  let txt = el.textContent ?? "";
  expect(txt).toContain(t("fr", "banque:vir.live.title")); // la barre de suivi en direct est là
  expect(txt).not.toContain(t("fr", "banque:vir.notify.levelTitle"));
  expect(txt).not.toContain(t("fr", "banque:vir.notify.stopTitle"));

  // Second sondage : deux notifications neuves → deux toasts push.
  notificationsServees = [NOTIF_PALIER, NOTIF_ARRET];
  await act(async () => { jest.advanceTimersByTime(4100); });
  await act(async () => { await Promise.resolve(); });

  txt = el.textContent ?? "";
  // Palier confirmé : titre + texte avec le nom du contrôle et le pct résolus.
  expect(txt).toContain(t("fr", "banque:vir.notify.levelTitle"));
  expect(txt).toContain(t("fr", "banque:vir.notify.level", { nom: t("fr", "banque:pipeline.CONFORMITE"), pct: "30" }));
  // Arrêt : titre + texte avec le motif du blocage résolu.
  expect(txt).toContain(t("fr", "banque:vir.notify.stopTitle"));
  expect(txt).toContain(t("fr", "banque:vir.notify.stop", { motif: t("fr", "banque:defaut.CERT_ASSURANCE") }));

  // Jamais les niveaux à venir (aucune légende des seuils dans le rendu client).
  expect(txt).not.toContain(t("fr", "banque:pipeline.CERTIFICATS"));
  expect(txt).not.toContain(t("fr", "banque:pipeline.EXECUTION"));
});
