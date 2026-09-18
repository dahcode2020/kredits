/**
 * @jest-environment jsdom
 */
/**
 * Menu Contact (bas de page) — verrous.
 *
 * Le site n'avait nulle part où écrire : les clés `contact.*` existaient depuis la slice 1 et
 * restaient non rendues. Ce fichier verrouille la chaîne complète :
 *  1. le DOMÉAINE : `deposerMessageContact` borne chaque champ, exige le consentement RGPD
 *     (jamais de case implicite), enregistre dans le magasin et `traiterMessageContact` fait
 *     exactement la transition NOUVEAU → TRAITE (une seule fois) ;
 *  2. la SECTION : le formulaire rend les champs avec leurs bornes, l'action native
 *     (`/api/contact`) fonctionne sans JavaScript, et le consentement n'est JAMAIS pré-coché ;
 *  3. le PIED DE PAGE : la colonne Contact existe et son lien mène à la section réelle.
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import Footer from "@/components/layout/Footer";
import ContactSection from "@/components/home/ContactSection";
import {
  CONTACT_MESSAGE_MAX, CONTACT_MESSAGE_MIN, CONTACT_NOM_MAX, CONTACT_SUJET_MAX,
  deposerMessageContact, lireMagasin, messagesContact, traiterMessageContact,
} from "@/lib/serveur";
import { t } from "@/lib/i18n";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* ——— 1. Le domaine ——— */
describe("dépôt d'un message de contact", () => {
  let dossier: string;
  beforeEach(() => { dossier = mkdtempSync(join(tmpdir(), "kredit-contact-")); });
  afterEach(() => { rmSync(dossier, { recursive: true, force: true }); });

  const base = {
    nom: "Marie Dubois", email: "Marie@Exemple.Be ", sujet: "Question TAEG",
    message: "Bonjour, quel TAEG pour 15 000 € sur 48 mois ?", consentement: true,
    locale: "fr", maintenant: "2026-09-18T14:00:00.000Z",
  };

  it("accepte un message complet, normalise l'e-mail et le rend NOUVEAU", () => {
    const magasin = lireMagasin(dossier);
    const r = deposerMessageContact(magasin, base);
    expect(r.erreur).toBeUndefined();
    expect(r.message?.email).toBe("marie@exemple.be");
    expect(r.message?.statut).toBe("NOUVEAU");
    // Le dépôt s'ajoute au message de démonstration semé : +1, pas « la » seule entrée.
    expect(messagesContact(magasin).some((m) => m.id === r.message!.id)).toBe(true);
  });

  it("refuse champ par champ : nom, e-mail, sujet, message trop court, consentement absent", () => {
    const magasin = lireMagasin(dossier);
    expect(deposerMessageContact(magasin, { ...base, nom: "M" }).erreur).toBe("nom_invalide");
    expect(deposerMessageContact(magasin, { ...base, email: "pas-un-email" }).erreur).toBe("email_invalide");
    expect(deposerMessageContact(magasin, { ...base, sujet: "x" }).erreur).toBe("sujet_invalide");
    expect(deposerMessageContact(magasin, { ...base, message: "trop cour" }).erreur).toBe("message_invalide"); // 9 caractères < minimum
    expect(deposerMessageContact(magasin, { ...base, consentement: false }).erreur).toBe("consentement_requis");
    // Rien n'a été enregistré au passage.
    expect(messagesContact(magasin).filter((m) => m.email === "marie@exemple.be")).toHaveLength(0);
  });

  it("borne la longueur de chaque champ aux constantes partagées", () => {
    const magasin = lireMagasin(dossier);
    expect(deposerMessageContact(magasin, { ...base, nom: "x".repeat(CONTACT_NOM_MAX + 1) }).erreur).toBe("nom_invalide");
    expect(deposerMessageContact(magasin, { ...base, sujet: "x".repeat(CONTACT_SUJET_MAX + 1) }).erreur).toBe("sujet_invalide");
    expect(deposerMessageContact(magasin, { ...base, message: "x".repeat(CONTACT_MESSAGE_MAX + 1) }).erreur).toBe("message_invalide");
    expect(CONTACT_MESSAGE_MIN).toBe(10);
  });

  it("traite un message exactement une fois (NOUVEAU → TRAITE, puis refus)", () => {
    const magasin = lireMagasin(dossier);
    const r = deposerMessageContact(magasin, base);
    expect(r.message).toBeDefined();
    const t1 = traiterMessageContact(magasin, r.message!.id, "Admin KREDIT", "2026-09-18T15:00:00.000Z");
    expect(t1.message?.statut).toBe("TRAITE");
    expect(t1.message?.traitePar).toBe("Admin KREDIT");
    expect(traiterMessageContact(magasin, r.message!.id, "Admin KREDIT", "2026-09-18T15:01:00.000Z").erreur).toBe("etat_inchange");
    expect(traiterMessageContact(magasin, "MSG-INCONNU", "Admin KREDIT", "2026-09-18T15:01:00.000Z").erreur).toBe("introuvable");
  });

  it("sème un message de démonstration NON traité (clés i18n, jamais de copie serveur)", () => {
    const msgs = messagesContact(lireMagasin(dossier));
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.statut === "NOUVEAU")).toBe(true);
    // Le corps semé est une clé qui se résout dans les quatre langues, pas du texte en dur.
    expect(t("fr", "contact.demoSubject")).not.toBe("contact.demoSubject");
    expect(t("de", "contact.demoSubject")).not.toBe("contact.demoSubject");
  });
});

/* ——— 2. La section formulaire ——— */
describe("section Contact (rendu)", () => {
  let root: Root | null = null;
  const conteneur = () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  };
  afterEach(() => { act(() => { root?.unmount(); }); root = null; document.body.innerHTML = ""; });

  it("rend le formulaire : action native sans JS, bornes, consentement non pré-coché", () => {
    const el = conteneur();
    root = createRoot(el);
    act(() => { root!.render(<ContactSection locale="fr" />); });
    const form = el.querySelector("form");
    expect(form).not.toBeNull();
    // Échappatoire noscript : le POST part même sans JavaScript.
    expect(form!.getAttribute("action")).toBe("/api/contact");
    expect(form!.getAttribute("method")).toBe("post");
    // Bornes du domaine, annoncées au navigateur (maxLength/minLength).
    expect(el.querySelector<HTMLTextAreaElement>("#contact-message")!.maxLength).toBe(CONTACT_MESSAGE_MAX);
    expect(el.querySelector<HTMLTextAreaElement>("#contact-message")!.minLength).toBe(CONTACT_MESSAGE_MIN);
    // Consentement RGPD : jamais pré-coché — l'accord est un geste explicite.
    const case_ = form!.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(case_!.checked).toBe(false);
  });

  it("affiche l'erreur du serveur via la table partagée, puis la référence au succès", async () => {
    const el = conteneur();
    root = createRoot(el);
    act(() => { root!.render(<ContactSection locale="fr" />); });
    // Soumission sans consentement : le serveur répond consentement_requis → message traduit.
    (globalThis as Record<string, unknown>).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ erreur: "consentement_requis" }),
    });
    const form = el.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const alerte = el.querySelector('[role="alert"]');
    expect(alerte?.textContent).toBe(t("fr", "contact.err.consentement"));
    // Puis un dépôt réussi : la référence du message s'affiche.
    (globalThis as Record<string, unknown>).fetch = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ message: { id: "MSG-20260918-TEST01", creeA: "2026-09-18T14:00:00.000Z" } }),
    });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(el.textContent).toContain("MSG-20260918-TEST01");
    expect(el.textContent).toContain(t("fr", "contact.sent"));
  });
});

/* ——— 3. Le pied de page ——— */
describe("pied de page : la colonne Contact", () => {
  let root: Root | null = null;
  afterEach(() => { act(() => { root?.unmount(); }); root = null; document.body.innerHTML = ""; });

  it("affiche les coordonnées et un lien vers la section réelle du formulaire", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => { root!.render(<Footer locale="fr" />); });
    const txt = el.textContent ?? "";
    expect(txt).toContain(t("fr", "contact.address"));
    expect(txt).toContain(t("fr", "contact.hours"));
    expect(txt).toContain(t("fr", "contact.emailNote"));
    expect(txt).toContain(t("fr", "contact.whatsappNote"));
    // Le lien mène à la section #contact de l'accueil — une destination réelle, pas « # ».
    const liens = [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(liens).toContain("/fr#contact");
  });
});
