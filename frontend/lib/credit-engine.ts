// Frontend mirror of backend CreditEngine — 100% configurable via same rules (BE defaults)
import Decimal from "decimal.js";
// Les listes d'options sont exportées (et pas seulement les unions) : le simulateur construit ses
// <select> à partir de ces tableaux, donc un nouveau motif d'investissement ou un nouveau statut ne peut
// plus exister dans le moteur sans être réclamé dans les quatre dictionnaires — `tests/unit/
// credit-engine-copy.spec.ts` échoue si un code n'a pas sa clé. Une union TypeScript est transparente au
// runtime : sans ces tableaux, la liste dérivée vivrait en dur dans le composant (et c'est exactement
// comment « Sans emploi » se retrouvait français sur /nl).
export const INCOME_TYPES: readonly IncomeType[] = ["SALARY","SELF_EMPLOYED","PENSION","UNEMPLOYMENT","OTHER"];
export type IncomeType = "SALARY"|"SELF_EMPLOYED"|"PENSION"|"UNEMPLOYMENT"|"OTHER";
export const EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = ["CDI","CDD","INDEPENDENT","INTERIM","RETIRED","STUDENT","UNEMPLOYED"];
export type EmploymentStatus = "CDI"|"CDD"|"INDEPENDENT"|"INTERIM"|"RETIRED"|"STUDENT"|"UNEMPLOYED";
export const LOAN_PURPOSES: readonly LoanPurpose[] = ["VEHICLE","WORKS","CONSUMPTION","DEBT_CONSOLIDATION","MEDICAL","OTHER"];
export type LoanPurpose = "VEHICLE"|"WORKS"|"CONSUMPTION"|"DEBT_CONSOLIDATION"|"MEDICAL"|"OTHER";
/**
 * Grille de taux unique, par palier de montant — la même pour tous les produits (grille commerciale
 * arrêtée le 12/09/2026). Un palier est un intervalle **entier fermé** : les bornes se suivent à 1
 * unité près (50 000 / 50 001), donc un montant non entier ne tombe dans aucun palier — le simulateur
 * ne peut pas en produire, son curseur débite au pas du produit.
 *
 * Placée ici et non dans le composant : `findRateRule`, l`étiquette d'un onglet, la carte « dès x% »
 * de la page d'accueil et le backend doivent lire le MÊME tableau. C'est précisément ce qui avait
 * dérivé la dernière fois (trois copies, un seul endroit corrigé).
 */
export const PALIERS_TAUX = [
  { min: 1_500, max: 50_000, taux: 0.025 },
  { min: 50_001, max: 500_000, taux: 0.019 },
  { min: 500_001, max: 1_000_000, taux: 0.018 },
  { min: 1_000_001, max: Infinity, taux: 0.015 },
] as const;

/** Palier applicable à un montant, ou `null` hors grille (en dessous de 1 500 €). */
export function palierPour(montant: number) {
  return PALIERS_TAUX.find((p) => montant >= p.min && montant <= p.max) ?? null;
}
/** Taux nominal applicable à un montant (`null` = aucun palier). */
export function tauxPour(montant: number): number | null {
  const p = palierPour(montant);
  return p ? p.taux : null;
}

/**
 * Les quatre produits: bornes de montant, durée, pas du curseur et frais de dossier.
 * `pas` est une donnée d'interface (un curseur linéaire sur 30 M€ est inutilisable), les autres
 * champs sont contractuels: `simulateCredit`, les onglets et la carte d'accueil les lisent directement.
 */
export const PRODUITS = {
  PERSONAL:   { code: "PERSONAL",   min: 1_500,   max: 200_000,    minTerm: 12, maxTerm: 84,  pas: 250,   frais: { filePct: 0.01,  fileMin: 75,  fileMax: 400 } },
  MORTGAGE:   { code: "MORTGAGE",   min: 20_000,  max: 1_000_000,  minTerm: 60, maxTerm: 300, pas: 5_000, frais: { filePct: 0.005, fileMin: 200, fileMax: 1000 } },
  BUSINESS:   { code: "BUSINESS",   min: 20_000,  max: 3_000_000,  minTerm: 12, maxTerm: 120, pas: 10_000, frais: { filePct: 0.015, fileMin: 150, fileMax: 1500 } },
  INVESTMENT: { code: "INVESTMENT", min: 200_000, max: 30_000_000, minTerm: 24, maxTerm: 240, pas: 50_000, frais: { filePct: 0.01,  fileMin: 300, fileMax: 5000 } },
} as const;

export type ProductCode = keyof typeof PRODUITS;
/**
 * Date d'effet de la grille — la même des deux côtés (miroir de `EFFECTIF_DEPUIS` dans
 * `backend/src/credit/rules/grille.commerciale.ts`). Elle n'est pas décorative: la règle précédente
 * doit rester consultable (`effective_to = now - 1s` côté backend), et l'écran SUPER_ADMIN affiche
 * l'historique à partir de cette date. Un test (`credit-tiers.spec.ts`) compare les deux fichiers.
 */
export const EFFECTIF_DEPUIS = "2026-09-12";

/** Codes produits, utilisés par les onglets du simulateur (clé i18n = code). */
export const PRODUCT_TYPES: readonly ProductCode[] = Object.keys(PRODUITS) as ProductCode[];

/** Taux le plus bas applicable à un produit (celui de son dernier palier atteint) — pour un « dès x% ». */
export function tauxMiniProduit(code: ProductCode): number {
  const p = PRODUITS[code];
  const dans = PALIERS_TAUX.filter((b) => b.min <= p.max && (b.max === Infinity || b.max >= p.min));
  return Math.min(...dans.map((b) => b.taux));
}
/** Codes des alertes émises par `simulateCredit` (clé i18n = code). */
export const SIMULATION_WARNINGS = ["DEBT_RATIO_HIGH","OVER_INDEBTED","LOW_CAPACITY","AT_CEILING"] as const;
/** Codes des pièces demandées, tous produits confondus (clé i18n = `documents.<code>`). */
export const DOCUMENT_CODES = ["ID","INCOME_3M","PROOF_ADDRESS","PROPERTY_VALUATION","BANK_STATEMENTS_3M","TAX_RETURN_2Y","BUSINESS_PLAN"] as const;

export interface SimulateInput { amount: number; termMonths: number; monthlyIncome: number; monthlyCharges: number; incomeType: IncomeType; employmentStatus: EmploymentStatus; loanPurpose: LoanPurpose; existingCreditsMonthly?: number; country?: string; productType?: string; birthDate?: string; }
/**
 * Règles pays-produit-palier, GÉNÉRÉES de la croix `PRODUITS × PALIERS_TAUX`. Un produit qui change de
 * bornes change donc de grille tout seul — et il n'existe plus de règle de taux oubliée dans un
 * tableau parallèle. Les identifiants restent stables et explicites (`rate_BE_MORTGAGE_20000_50000`)
 * parce qu'ils sortent dans `meta.rateRuleId` et dans le journal d'audit.
 */
type Frais = { filePct: number; fileMin: number; fileMax: number };
export type RegleTaux = { id: string; country: string; product: ProductCode; minAmount: number; maxAmount: number; minTerm: number; maxTerm: number; baseRate: number; fees: Frais };

function genererReglesTaux(pays: string): RegleTaux[] {
  const regles: RegleTaux[] = [];
  for (const code of PRODUCT_TYPES) {
    const p = PRODUITS[code];
    for (const b of PALIERS_TAUX) {
      if (b.min > p.max) continue;
      const plafond = b.max === Infinity ? p.max : Math.min(b.max, p.max);
      if (plafond < p.min) continue;
      const plancher = Math.max(b.min, p.min);
      if (plancher > plafond) continue;
      regles.push({
        id: `rate_${pays}_${code}_${plancher}_${plafond}`, country: pays, product: code,
        minAmount: plancher, maxAmount: plafond, minTerm: p.minTerm, maxTerm: p.maxTerm,
        baseRate: b.taux, fees: { ...p.frais },
      });
    }
  }
  return regles;
}
const rateRules: RegleTaux[] = genererReglesTaux("BE");
export function findRateRule(country:string, product:string, amount:number, term:number){ const c = rateRules.filter(r=> r.country===country && r.product===product && amount>=r.minAmount && amount<=r.maxAmount && term>=r.minTerm && term<=r.maxTerm); if(!c.length) return null; return c[0]; }
export function simulateCredit(input: SimulateInput){
  const country = (input.country||'BE').toUpperCase();
  // Sans produit explicite: le premier dont la fourchette couvre le montant, sinon le produit de
  // base. L'ancien heuristic (>=50 000 -> MORTGAGE, >=25 000 -> BUSINESS) est tombé: les fourchettes
  // ont changé et il aurait fallu le re-coder à la main à chaque grille — il lisait la table.
  const demande = (input.productType || "") as ProductCode;
  const produit = (demande in PRODUITS ? demande : undefined) ?? PRODUCT_TYPES.find((c) => input.amount >= PRODUITS[c].min && input.amount <= PRODUITS[c].max) ?? "PERSONAL";
  const product = produit;
  const rule = findRateRule(country, product, input.amount, input.termMonths);
  if(!rule) throw new Error(`Aucune grille ${country} ${product} ${input.amount}€/${input.termMonths}m`);
  const P = new Decimal(input.amount);
  const n = input.termMonths;
  const annual = new Decimal(rule.baseRate);
  const r = annual.div(12);
  const monthly = r.isZero()? P.div(n) : P.mul(r).div(new Decimal(1).minus(new Decimal(1).plus(r).pow(-n)));
  const total = monthly.mul(n);
  const interest = total.minus(P);
  let fileFee = P.mul(rule.fees.filePct||0);
  if(fileFee.lt(rule.fees.fileMin||0)) fileFee = new Decimal(rule.fees.fileMin||0);
  if(fileFee.gt(rule.fees.fileMax||1e9)) fileFee = new Decimal(rule.fees.fileMax||1e9);
  if((rule.fees.filePct||0)===0 && (rule.fees.fileMin||0)===0) fileFee = new Decimal(0);
  const cappedFees = Decimal.min(fileFee, P.mul(0.1));
  const totalCost = total.plus(cappedFees);
  const taeg = annual.plus(cappedFees.div(P).div(n/12));
  const schedule: any[]=[]; let bal=P;
  for(let i=1;i<=n;i++){ const inter=bal.mul(r); const princ=Decimal.min(monthly.minus(inter), bal); bal=Decimal.max(new Decimal(0), bal.minus(princ)); schedule.push({month:i, payment:Number(monthly.toFixed(2)), interest:Number(inter.toFixed(2)), principal:Number(princ.toFixed(2)), balance:Number(bal.toFixed(2))}); }
  const monthlyPayment = Number(monthly.toFixed(2));
  const existing = input.existingCreditsMonthly||0;
  const debtRatio = input.monthlyIncome>0? (monthlyPayment+existing+input.monthlyCharges)/input.monthlyIncome : Infinity;
  const capacity = input.monthlyIncome - input.monthlyCharges - existing - monthlyPayment;
  const maxDebt = 0.33;
  const isOverDebt = debtRatio>maxDebt;
  const hardDebt = debtRatio>0.55;
  const limites = (PRODUITS as any)[product] ?? PRODUITS.PERSONAL;
  const maxAmount = limites.max as number;
  const hardExceed = input.amount>maxAmount;
  const isEligible = !hardExceed && !hardDebt && !(input.birthDate && (()=>{ const b=new Date(input.birthDate!); const now=new Date(); let a=now.getFullYear()-b.getFullYear(); const m=now.getMonth()-b.getMonth(); if(m<0||(m===0&&now.getDate()<b.getDate()))a--; return a<18; })());
  const weights={debtRatio:35, incomeStability:25, employment:20, purpose:10, term:10} as any;
  const debtScore = debtRatio<=0.33?weights.debtRatio: debtRatio<=0.40?Math.round(weights.debtRatio*0.57): debtRatio<=0.50?Math.round(weights.debtRatio*0.22):0;
  const incomeMap:any={SALARY:1, PENSION:0.8, SELF_EMPLOYED:0.6, OTHER:0.4, UNEMPLOYMENT:0.14};
  const empMap:any={CDI:1, RETIRED:0.8, INDEPENDENT:0.7, CDD:0.6, INTERIM:0.45, STUDENT:0.3, UNEMPLOYED:0};
  const purposeMap:any={VEHICLE:1, WORKS:1, CONSUMPTION:0.7, MEDICAL:0.7, OTHER:0.6, DEBT_CONSOLIDATION:0.3};
  const incomeStability = Math.round(weights.incomeStability*(incomeMap[input.incomeType]??0.4));
  const employment = Math.round(weights.employment*(empMap[input.employmentStatus]??0.3));
  const purpose = Math.round(weights.purpose*(purposeMap[input.loanPurpose]??0.6));
  const maxTerm = limites.maxTerm as number; // même table: plus de durée en dur dans le moteur
  const termRatio = n/maxTerm;
  const termScore = termRatio<=0.5?weights.term : termRatio<=0.8? Math.round(weights.term*0.5): Math.round(weights.term*0.2);
  const value = debtScore+incomeStability+employment+purpose+termScore;
  const grade = value>=80?'A': value>=65?'B': value>=45?'C': value>=25?'D':'E';
  let recommendation: 'APPROVE_RECOMMENDATION'|'REVIEW_RECOMMENDATION'|'REJECT_RECOMMENDATION' = 'REVIEW_RECOMMENDATION';
  if(!isEligible || hardDebt || hardExceed || grade==='E') recommendation='REJECT_RECOMMENDATION';
  else if((grade==='A'||grade==='B') && debtRatio<=0.33 && capacity>500) recommendation='APPROVE_RECOMMENDATION';
  else if(grade==='C'||grade==='D'|| isOverDebt) recommendation='REVIEW_RECOMMENDATION';
  const warnings: any[]=[];
  if(debtRatio>0.33) warnings.push({code:'DEBT_RATIO_HIGH', message:`Endettement ${(debtRatio*100).toFixed(1)}% >33%`, severity:'high'});
  if(debtRatio>0.50) warnings.push({code:'OVER_INDEBTED', message:'Surendettement >50%', severity:'high'});
  if(capacity<500) warnings.push({code:'LOW_CAPACITY', message:`Capacité ${capacity.toFixed(0)}€ <500€`, severity:'medium'});
  if(input.amount>0.9*maxAmount) warnings.push({code:'AT_CEILING', message:'Proche plafond', severity:'low'});
  const docsParProduit: Record<string, readonly string[]> = {
    MORTGAGE: ["ID","INCOME_3M","PROOF_ADDRESS","PROPERTY_VALUATION","BANK_STATEMENTS_3M"],
    BUSINESS: ["ID","INCOME_3M","PROOF_ADDRESS","TAX_RETURN_2Y","BUSINESS_PLAN"],
    // Un investissement s'appuie sur la capacité financière autant que sur le projet: les deux
    // justificatifs du professionnel, sans plan d'affaires.
    INVESTMENT: ["ID","INCOME_3M","PROOF_ADDRESS","BANK_STATEMENTS_3M","TAX_RETURN_2Y"],
  };
  const baseDocs = docsParProduit[product] ?? ["ID","INCOME_3M","PROOF_ADDRESS"];
  const requiredDocuments: any[] = baseDocs.map(code=> ({code, label: code, required:true}));
  if(input.amount>20000 && !baseDocs.includes('BANK_STATEMENTS_3M')) requiredDocuments.push({code:'BANK_STATEMENTS_3M', label:'Extraits 3 mois', required:true});
  if(input.incomeType==='SELF_EMPLOYED' && !baseDocs.includes('TAX_RETURN_2Y')) requiredDocuments.push({code:'TAX_RETURN_2Y', label:'Avertissements 2 ans', required:true});
  return {
    simulation:{ monthlyPayment, annualRate: rule.baseRate, taeg: Number(taeg.toFixed(4)), totalInterest: Number(interest.toFixed(2)), fees:{file:Number(fileFee.toFixed(2)), insurance:0, total:Number(cappedFees.toFixed(2))}, totalCost: Number(totalCost.toFixed(2)), schedule, disclaimer:"Simulation indicative — ne constitue pas une offre ferme. Décision humaine obligatoire.", meta:{country, product, rateRuleId: rule.id, generatedAt: new Date().toISOString()}},
    eligibility:{ isEligible, hardFailures: hardExceed?[{rule:'max_amount', message:`>${maxAmount}`}] : hardDebt?[{rule:'max_debt_hard'}]: [], softFailures: isOverDebt?[{rule:'max_debt_ratio'}]:[], debtRatio: Number(debtRatio.toFixed(4)), repaymentCapacity: Number(capacity.toFixed(2)), maxAllowedAmount: isOverDebt? Math.floor((input.monthlyIncome*0.33-input.monthlyCharges-existing)*input.termMonths*0.9): null },
    score:{ value, grade, breakdown:{debtRatio:debtScore, incomeStability, employment, purpose, term:termScore}, explanation:`Score ${value} grade ${grade}, dette ${(debtRatio*100).toFixed(1)}%` },
    recommendation, warnings, requiredDocuments,
  };
}
