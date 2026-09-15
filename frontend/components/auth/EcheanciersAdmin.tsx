"use client";
/**
 * Slice 23 — Échéanciers par client (réservé ADMIN / SUPER_ADMIN).
 *
 * L'œil du suivi : pour chaque client, les échéanciers de ses demandes (calculés par LE moteur)
 * et de ses contrats (mensualité serveur), avec la DATE DE RÈGLEMENT de chaque mois, le capital
 * restant dû et le statut échu / à venir ; en dessous, les règlements réellement déclarés
 * (table paiements). Aucune valeur en dur : tout vient du serveur ou du moteur.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, FileSignature, FileText, Wallet } from "lucide-react";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { API, apiGet } from "@/lib/api";
import { simulateCredit } from "@/lib/credit-engine";
import type { ContratServeur, DemandeServeur, PaiementServeur } from "@/lib/serveur";

interface ClientOps { id: string; email: string; nom: string }
interface Ligne { mois: number; date: string; paiement: number; solde: number }

/** Date du i-ème règlement : un mois après la date d'origine, de mois en mois (UTC). */
function echeanceDe(origineISO: string, i: number): string {
  const d = new Date(origineISO);
  d.setUTCMonth(d.getUTCMonth() + i);
  return d.toISOString();
}
/** Amortissement annuité constante (miroir d'affichage de la formule serveur) : les lignes de
 *  l'échéancier d'un contrat. Le serveur reste la source de vérité des montants. */
function lignesContrat(c: ContratServeur): Ligne[] {
  const r = c.tauxAnnuel / 100 / 12;
  const lignes: Ligne[] = [];
  let solde = c.montant;
  for (let i = 1; i <= c.dureeMois; i++) {
    const interets = solde * r;
    const capital = Math.min(c.mensualite - interets, solde);
    solde = Math.max(0, solde - capital);
    lignes.push({ mois: i, date: echeanceDe(c.creeA, i), paiement: c.mensualite, solde: Math.round(solde * 100) / 100 });
  }
  return lignes;
}

export default function EcheanciersAdmin({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [clients, setClients] = useState<ClientOps[]>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [demandes, setDemandes] = useState<DemandeServeur[]>([]);
  const [contrats, setContrats] = useState<ContratServeur[]>([]);
  const [paiements, setPaiements] = useState<PaiementServeur[]>([]);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    apiGet<{ clients: ClientOps[] }>(API.banqueComptes).then((r) => {
      if (r.ok) {
        setClients(r.corps.clients);
        setChoisi((prev) => prev ?? r.corps.clients[0]?.id ?? null);
      }
      setPret(true);
    });
  }, []);
  useEffect(() => {
    if (!choisi) return;
    const email = choisi.split("::")[0];
    void apiGet<{ demandes: DemandeServeur[] }>(`${API.demandes}?compte=${encodeURIComponent(email)}`).then((r) => setDemandes(r.ok ? r.corps.demandes : []));
    void apiGet<{ contrats: ContratServeur[] }>(`${API.contrats}?compte=${encodeURIComponent(email)}`).then((r) => setContrats(r.ok ? r.corps.contrats : []));
    void apiGet<{ paiements: PaiementServeur[] }>(`${API.paiements}?compte=${encodeURIComponent(email)}`).then((r) => setPaiements(r.ok ? r.corps.paiements : []));
  }, [choisi]);

  const maintenant = useMemo(() => Date.now(), []);
  const mensDepuisDemande = (d: DemandeServeur): Ligne[] => {
    const sim = simulateCredit({
      amount: d.etat.amount, termMonths: d.etat.term, monthlyIncome: d.etat.income,
      monthlyCharges: d.etat.charges, incomeType: d.etat.incomeType,
      employmentStatus: d.etat.employment, loanPurpose: d.etat.purpose,
      existingCreditsMonthly: d.etat.existing, country: "BE", productType: d.etat.product,
    });
    return sim.simulation.schedule.map((l: { month: number; payment: number; balance: number }) => ({
      mois: l.month, date: echeanceDe(d.creeA, l.month), paiement: l.payment, solde: l.balance,
    }));
  };
  const reglements = paiements.filter((p) => p.type === "MENSUALITE");
  const cible = clients.find((c) => c.id === choisi);

  if (!pret) return null;
  const badgeStatut = (statut: PaiementServeur["statut"]) => (
    <span className={cn("text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
      statut === "PAYE" ? "bg-emerald-50 text-emerald-600" : statut === "DECLARE" ? "bg-primary-light text-primary" : "bg-amber-50 text-amber-600")}>
      {tr(`payments.flow.${statut}`)}
    </span>
  );

  const BlocEcheancier = ({ titre, Ic, lignes, pied }: { titre: string; Ic: typeof FileText; lignes: Ligne[]; pied: string }) => {
    const prochaine = lignes.find((l) => Date.parse(l.date) > maintenant);
    return (
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><Ic className="w-5 h-5 text-primary" aria-hidden="true" /> {titre}</h4>
          {prochaine && (
            <span className="ml-auto inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-primary bg-primary-light px-3 py-1.5 rounded-full tabular-nums">
              <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /> {tr("dashboard.ech.nextDue")} : {formatDate(prochaine.date, locale)}
            </span>
          )}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="pb-2 pr-3">{tr("dashboard.ech.month")}</th>
                <th className="pb-2 pr-3">{tr("dashboard.ech.dueDate")}</th>
                <th className="pb-2 pr-3 text-right">{tr("dashboard.ech.payment")}</th>
                <th className="pb-2 pr-3 text-right">{tr("dashboard.ech.balance")}</th>
                <th className="pb-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lignes.map((l) => {
                const echu = Date.parse(l.date) <= maintenant;
                return (
                  <tr key={l.mois}>
                    <td className="py-2 pr-3 tabular-nums">{l.mois}</td>
                    <td className="py-2 pr-3 tabular-nums font-bold text-ink">{formatDate(l.date, locale)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatEUR2(l.paiement, locale)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{formatEUR2(l.solde, locale)}</td>
                    <td className="py-2 text-right">
                      <span className={cn("text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full", echu ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400")}>
                        {tr(echu ? "dashboard.ech.overdue" : "dashboard.ech.upcoming")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">{pied}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h3 className="font-display font-extrabold text-ink flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("dashboard.ech.title")}
        </h3>
        <p className="mt-1 text-[12px] text-slate-400">{tr("dashboard.ech.intro")}</p>
        <label className="mt-4 block max-w-md">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.ech.selectClient")}</span>
          <select value={choisi ?? ""} onChange={(e) => setChoisi(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30">
            {clients.map((c) => <option key={c.id} value={c.id}>{c.nom} — {c.email}</option>)}
          </select>
        </label>
      </div>

      {cible && demandes.length === 0 && contrats.length === 0 && (
        <div className="bg-white rounded-[24px] shadow-card border p-6"><p className="text-[13px] text-slate-500">{tr("dashboard.ech.noData")}</p></div>
      )}

      {demandes.map((d) => (
        <BlocEcheancier
          key={d.id}
          titre={`${tr("dashboard.ech.demande")} ${d.id}`}
          Ic={FileText}
          lignes={mensDepuisDemande(d)}
          pied={`${formatEUR2(d.etat.amount, locale)} · ${tr("dashboard.contracts.docMonths", { n: d.etat.term })}`}
        />
      ))}
      {contrats.map((c) => (
        <BlocEcheancier
          key={c.id}
          titre={`${tr("dashboard.ech.contrat")} ${c.id}`}
          Ic={FileSignature}
          lignes={lignesContrat(c)}
          pied={`${formatEUR2(c.montant, locale)} · ${tr("dashboard.contracts.docMonths", { n: c.dureeMois })} · ${formatEUR2(c.mensualite, locale)}/m`}
        />
      ))}

      {/* Règlements réellement déclarés : la table paiements fait foi. */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("dashboard.ech.reglements")}</h4>
        {reglements.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{tr("dashboard.ech.noReglements")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {[...reglements].sort((a, b) => (a.echeance ?? a.creeA).localeCompare(b.echeance ?? b.creeA)).map((p) => (
              <li key={p.id} className="rounded-2xl border p-3 flex flex-wrap items-center gap-3 text-[12px]">
                <span className="font-extrabold text-ink tabular-nums">{formatEUR2(p.montant, locale)}</span>
                <span className="text-slate-400 tabular-nums">{tr("payments.dueOn", { date: formatDate(p.echeance ?? p.creeA, locale) })}</span>
                {p.demandeId && <span className="text-slate-400 font-mono">{p.demandeId}</span>}
                <span className="ml-auto">{badgeStatut(p.statut)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
