/**
 * @jest-environment node
 */
/**
 * Verrou tSiCle : les contenus stockés (chat, motifs de transaction) qui portent une CLÉ i18n —
 * forme pointée « banque.chat.x » OU forme « banque:x » — s'affichent TRADUITS dans les 4 langues ;
 * le texte libre saisi par un utilisateur passe tel quel. Régression réelle : le chat de la
 * vitrine affichait « banque.chat.demoQuestion » tel quel (lookup littéral dans la table plate).
 */
import { t, tSiCle, type Locale } from "@/lib/i18n";

const LOCALES: Locale[] = ["fr", "en", "nl", "de"];

it("résout la forme pointée comme la forme deux-points, dans les 4 langues", () => {
  for (const loc of LOCALES) {
    expect(tSiCle(loc, "banque.chat.demoQuestion")).toBe(t(loc, "banque:chat.demoQuestion"));
    expect(tSiCle(loc, "banque.chat.demoQuestion")).not.toBe("banque.chat.demoQuestion");
    expect(tSiCle(loc, "banque:chat.demoAnswer")).toBe(t(loc, "banque:chat.demoAnswer"));
    expect(tSiCle(loc, "banque.tx.demoSalary")).toBe(t(loc, "banque:tx.demoSalary"));
    expect(tSiCle(loc, "banque.chat.demoCode")).not.toBe("banque.chat.demoCode");
  }
});

it("le texte libre passe tel quel ; vide/null rendent vide", () => {
  expect(tSiCle("fr", "Bonjour, il me faut le code de déblocage.")).toBe("Bonjour, il me faut le code de déblocage.");
  expect(tSiCle("fr", "banque.inexistante.nullepart")).toBe("banque.inexistante.nullepart");
  expect(tSiCle("fr", "")).toBe("");
  expect(tSiCle("fr", null)).toBe("");
  expect(tSiCle("fr", undefined)).toBe("");
});
