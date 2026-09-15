/**
 * @jest-environment node
 */
/**
 * Slice 21 — distribution réelle des notifications : verrous des transports gratuits.
 *
 * Ce qui est verrouillé : la configuration lue depuis l'environnement (un fournisseur absent =
 * canal « non configuré », jamais simulé), la normalisation du numéro WhatsApp, et les deux
 * transports — Resend pour l'e-mail, API Cloud de Meta pour WhatsApp — avec un fetch injecté
 * (aucun réseau réel dans les verrous) : réponse OK → « envoyé », erreur HTTP/réseau → « échec ».
 */
import {
  configNotifDepuisEnv, envoyerEmailResend, envoyerWhatsAppMeta, numeroInternational,
} from "@/lib/notifier";

describe("configuration depuis l'environnement", () => {
  it("un fournisseur n'est configuré que si TOUTES ses variables sont posées", () => {
    expect(configNotifDepuisEnv({})).toEqual({});
    expect(configNotifDepuisEnv({ KREDIT_RESEND_KEY: "k" })).toEqual({});
    expect(configNotifDepuisEnv({ KREDIT_RESEND_KEY: "k", KREDIT_EMAIL_FROM: "KREDIT <n@exemple.be>" }))
      .toEqual({ resend: { cle: "k", de: "KREDIT <n@exemple.be>" } });
    expect(configNotifDepuisEnv({ KREDIT_WHATSAPP_TOKEN: "t", KREDIT_WHATSAPP_PHONE_ID: "123" }))
      .toEqual({ whatsapp: { jeton: "t", idTelephone: "123" } });
  });
});

describe("normalisation du numéro WhatsApp", () => {
  it("« +32 470 12 34 56 » → « +32470123456 » ; l'invalidité est refusée", () => {
    expect(numeroInternational("+32 470 12 34 56")).toBe("+32470123456");
    expect(numeroInternational("+32 (0)470-12.34.56".replace("(0)", ""))).toBe("+32470123456");
    expect(numeroInternational("0470 12 34 56")).toBeNull(); // pas international
    expect(numeroInternational("+32")).toBeNull();          // trop court
    expect(numeroInternational("")).toBeNull();
  });
});

describe("e-mail via Resend (gratuit)", () => {
  it("sans configuration : « non configuré », aucun appel", async () => {
    let appels = 0;
    expect(await envoyerEmailResend(undefined, "c@exemple.be", "s", "t", async () => { appels += 1; return { ok: true, status: 200 }; })).toBe("non_configure");
    expect(appels).toBe(0);
  });
  it("réponse OK : « envoyé », avec Bearer et corps attendus", async () => {
    let url = ""; let corps = ""; let auth = "";
    const statut = await envoyerEmailResend(
      { cle: "re_cle", de: "KREDIT <n@exemple.be>" }, "c@exemple.be", "Sujet", "Texte",
      async (u, init) => { url = u; corps = init?.body ?? ""; auth = init?.headers?.Authorization ?? ""; return { ok: true, status: 200 }; },
    );
    expect(statut).toBe("envoye");
    expect(url).toBe("https://api.resend.com/emails");
    expect(auth).toBe("Bearer re_cle");
    expect(JSON.parse(corps)).toEqual({ from: "KREDIT <n@exemple.be>", to: ["c@exemple.be"], subject: "Sujet", text: "Texte" });
  });
  it("erreur HTTP ou réseau : « échec »", async () => {
    expect(await envoyerEmailResend({ cle: "k", de: "d" }, "c@x.be", "s", "t", async () => ({ ok: false, status: 401 }))).toBe("echec");
    expect(await envoyerEmailResend({ cle: "k", de: "d" }, "c@x.be", "s", "t", (async () => { throw new Error("réseau"); }) as never)).toBe("echec");
  });
});

describe("WhatsApp via l'API Cloud de Meta (gratuit)", () => {
  it("sans configuration : « non configuré », aucun appel", async () => {
    let appels = 0;
    expect(await envoyerWhatsAppMeta(undefined, "+32470123456", "t", async () => { appels += 1; return { ok: true, status: 200 }; })).toBe("non_configure");
    expect(appels).toBe(0);
  });
  it("réponse OK : « envoyé », message texte de service au bon numéro", async () => {
    let url = ""; let corps = "";
    const statut = await envoyerWhatsAppMeta(
      { jeton: "wa_cle", idTelephone: "123456789" }, "+32470123456", "Bonjour",
      async (u, init) => { url = u; corps = init?.body ?? ""; return { ok: true, status: 200 }; },
    );
    expect(statut).toBe("envoye");
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    const c = JSON.parse(corps);
    expect(c.messaging_product).toBe("whatsapp");
    expect(c.to).toBe("+32470123456");
    expect(c.text.body).toBe("Bonjour");
  });
  it("erreur HTTP : « échec »", async () => {
    expect(await envoyerWhatsAppMeta({ jeton: "k", idTelephone: "1" }, "+32470123456", "t", async () => ({ ok: false, status: 400 }))).toBe("echec");
  });
});
