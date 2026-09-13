/**
 * Valeurs volontairement identiques dans plusieurs langues.
 *
 * Les deux détecteurs de « copie laissée en français » (`i18n-metadata.spec.ts` sur les dictionnaires,
 * `i18n-keys-usage.spec.ts` sur les clés réellement appelées par le code) partagent cette liste: un
 * seul endroit, sinon on ajoute l'exception d'un côté et le autre job CI la refuse.
 */
export const VALEURS_PARTAGEES = new Set([
  "common:language.fr",   // endonyme: un locuteur néerlandais dit aussi « Français »
  "common:testimonials.a3", // toponyme: « Liège » s'écrit ainsi en anglais
]);

export const estPartagee = (cle: string) => VALEURS_PARTAGEES.has(cle) || VALEURS_PARTAGEES.has(`common:${cle}`);
