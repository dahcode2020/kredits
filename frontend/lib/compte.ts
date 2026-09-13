/**
 * Tableau de bord client (slice 5) — données locales du compte.
 *
 * Rien d'inventé : tout ce que le dashboard affiche sort (a) des demandes réellement déposées sur
 * l'appareil (slice 3), recalculées dans le moteur, (b) de préférences que l'utilisateur règle
 * lui-même, (c) de projections étiquetées comme telles (`dashboard.projection`).
 *
 * Les accesseurs localStorage ne sont appelés que côté navigateur (handlers/effects) ; les trois
 * fonctions pures (`prochaineEcheance`, `moyenne`, `pointsCourbe`) sont verrouillées en Node.
 */
import { simulateCredit } from "./credit-engine";
import type { DemandeLocale } from "./application";

/** Forme d'une demande déposée (slice 3) — réexportée pour les vues du dashboard. */
export type DemandeLocaleShape = DemandeLocale;

/** Première journée du mois suivant — l'échéance « projetée » d'un crédit mensuel. */
export function prochaineEcheance(maintenant: Date): Date {
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
}

export function moyenne(ns: number[]): number | null {
  if (!ns.length) return null;
  return ns.reduce((s, n) => s + n, 0) / ns.length;
}

/** Points [mois, restant dû] d'un échéancier — l'entrée de la courbe SVG du dashboard. */
export function pointsCourbe(schedule: Array<{ month: number; balance: number }>): Array<[number, number]> {
  return schedule.map((l) => [l.month, l.balance] as [number, number]);
}

/* ——— préférences de notification (réglées par l'utilisateur, persistées) ——— */
export interface PrefsNotif {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
  whatsappConsent: boolean;
}
export const DEFAUT_PREFS: PrefsNotif = { email: true, sms: false, whatsapp: false, push: true, whatsappConsent: false };
export const CLE_PREFS = "kredit.prefs.v1";

export function lirePrefs(): PrefsNotif {
  try {
    const brut = window.localStorage.getItem(CLE_PREFS);
    return brut ? { ...DEFAUT_PREFS, ...(JSON.parse(brut) as Partial<PrefsNotif>) } : { ...DEFAUT_PREFS };
  } catch {
    return { ...DEFAUT_PREFS };
  }
}
export function enregistrerPrefs(p: PrefsNotif): void {
  try {
    window.localStorage.setItem(CLE_PREFS, JSON.stringify(p));
  } catch {
    // navigation privée : les réglages restent en mémoire pour la session.
  }
}

/* ——— documents marqués « fournis » localement, par demande et par code ——— */
export const CLE_DOCS = "kredit.docs.v1";
export const cleDoc = (demandeId: string, code: string) => `${demandeId}:${code}`;

export function lireDocsFournis(): string[] {
  try {
    const brut = window.localStorage.getItem(CLE_DOCS);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? (liste as string[]) : [];
  } catch {
    return [];
  }
}
export function marquerDocFourni(cle: string): string[] {
  const liste = [...new Set([...lireDocsFournis(), cle])];
  try {
    window.localStorage.setItem(CLE_DOCS, JSON.stringify(liste));
  } catch {
    // idem.
  }
  return liste;
}

/* ——— mensualité projetée d'une demande déposée : recalculée, jamais recopiée ——— */
export function mensualiteDe(d: DemandeLocaleShape): number {
  const e = d.etat;
  return simulateCredit({
    amount: e.amount, termMonths: e.term, monthlyIncome: e.income, monthlyCharges: e.charges,
    incomeType: e.incomeType, employmentStatus: e.employment, loanPurpose: e.purpose,
    existingCreditsMonthly: e.existing, country: "BE", productType: e.product,
  }).simulation.monthlyPayment;
}
