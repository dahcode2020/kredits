/**
 * Pont simulateur → demande pré-remplie (slice 3), et persistance locale honnête.
 *
 * - L'état de simulation voyage dans l'URL (query lisible, partageable, rendue côté serveur) :
 *   `etatDepuisQuery` VALIDE et BORNE tout (produit inconnu → PERSONAL, montant arrondi au pas et
 *   clampé dans la table, énumérations rejetées vers leur défaut) — une URL bricolée ne peut donc
 *   pas produire de valeur hors grille ;
 * - `queryDepuisEtat` est l'exacte réciproque sur état valide (verrouillé par
 *   tests/unit/application-params.spec.ts) ;
 * - aucune API navigateur ici : pur et testable en Node ; le localStorage vit dans le composant.
 */
import {
  EMPLOYMENT_STATUSES, INCOME_TYPES, LOAN_PURPOSES, PRODUITS, PRODUCT_TYPES,
  type EmploymentStatus, type IncomeType, type LoanPurpose, type ProductCode,
} from "./credit-engine";

export interface EtatSimulation {
  product: ProductCode;
  amount: number;
  term: number;
  income: number;
  charges: number;
  existing: number;
  incomeType: IncomeType;
  employment: EmploymentStatus;
  purpose: LoanPurpose;
}

/** L'exemple du dictionnaire (heroCard.example) : 15 000 € / 48 mois — défaut déterministe. */
export const DEFAUT_SIM: EtatSimulation = {
  product: "PERSONAL",
  amount: 15_000,
  term: 48,
  income: 3_200,
  charges: 600,
  existing: 0,
  incomeType: "SALARY",
  employment: "CDI",
  purpose: "CONSUMPTION",
};

export function borne(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** Arrondit au pas du produit puis clampé dans ses bornes — comme la réglette du simulateur. */
export function montantValide(brut: number, code: ProductCode): number {
  const p = PRODUITS[code];
  const arrondi = Math.round(brut / p.pas) * p.pas;
  return borne(arrondi || p.min, p.min, p.max);
}

const CLE = {
  product: "p", amount: "a", term: "t", income: "inc", charges: "chg",
  existing: "ex", incomeType: "it", employment: "em", purpose: "lp",
} as const;

function num(sp: Record<string, string | undefined>, cle: string, defaut: number): number {
  const v = Number(sp[cle]);
  return sp[cle] !== undefined && Number.isFinite(v) ? v : defaut;
}

/** Une query (potentiellement bricolée) → état valide, toujours dans la grille. */
export function etatDepuisQuery(sp: Record<string, string | undefined>): EtatSimulation {
  const produit = PRODUCT_TYPES.includes(sp[CLE.product] as ProductCode)
    ? (sp[CLE.product] as ProductCode)
    : DEFAUT_SIM.product;
  const p = PRODUITS[produit];
  return {
    product: produit,
    amount: montantValide(num(sp, CLE.amount, DEFAUT_SIM.amount), produit),
    term: Math.round(borne(num(sp, CLE.term, DEFAUT_SIM.term), p.minTerm, p.maxTerm)),
    income: Math.max(0, Math.round(num(sp, CLE.income, DEFAUT_SIM.income))),
    charges: Math.max(0, Math.round(num(sp, CLE.charges, DEFAUT_SIM.charges))),
    existing: Math.max(0, Math.round(num(sp, CLE.existing, DEFAUT_SIM.existing))),
    incomeType: (INCOME_TYPES as readonly string[]).includes(sp[CLE.incomeType] ?? "")
      ? (sp[CLE.incomeType] as IncomeType) : DEFAUT_SIM.incomeType,
    employment: (EMPLOYMENT_STATUSES as readonly string[]).includes(sp[CLE.employment] ?? "")
      ? (sp[CLE.employment] as EmploymentStatus) : DEFAUT_SIM.employment,
    purpose: (LOAN_PURPOSES as readonly string[]).includes(sp[CLE.purpose] ?? "")
      ? (sp[CLE.purpose] as LoanPurpose) : DEFAUT_SIM.purpose,
  };
}

/** État valide → query compacte, clé dans un ordre stable (URL lisibles et comparables). */
export function queryDepuisEtat(e: EtatSimulation): string {
  const s = new URLSearchParams();
  s.set(CLE.product, e.product);
  s.set(CLE.amount, String(e.amount));
  s.set(CLE.term, String(e.term));
  s.set(CLE.income, String(e.income));
  s.set(CLE.charges, String(e.charges));
  s.set(CLE.existing, String(e.existing));
  s.set(CLE.incomeType, e.incomeType);
  s.set(CLE.employment, e.employment);
  s.set(CLE.purpose, e.purpose);
  return s.toString();
}

/** Référence locale de démonstration : préfixe stable + année + empreinte base36 du temps. */
export function nouvelleReference(d: Date): string {
  return `KRD-${d.getUTCFullYear()}-${d.getTime().toString(36).toUpperCase()}`;
}

export interface DemandeLocale {
  id: string;
  createdAt: string;
  statut: "SUBMITTED";
  etat: EtatSimulation;
  nom: string;
  email: string;
  telephone: string;
}

export const CLE_STOCKAGE = "kredit.demandes.v1";

export function lireDemandes(): DemandeLocale[] {
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return [];
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? (liste as DemandeLocale[]) : [];
  } catch {
    return [];
  }
}

export function ajouterDemande(d: DemandeLocale): DemandeLocale[] {
  const liste = [...lireDemandes(), d];
  try {
    window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(liste));
  } catch {
    // stockage refusé (navigation privée…) : la confirmation reste affichée en mémoire.
  }
  return liste;
}
