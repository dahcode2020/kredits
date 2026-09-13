"use client";
/**
 * « use client » : onglets, formulaires, session locale. Rendu serveur d'abord (onglet connexion,
 * champs vides) — identique au premier rendu client ; localStorage et WebCrypto uniquement dans
 * les handlers (contrat d'hydratation).
 *
 * Une seule page pour les trois profils (exigence produit) : CUSTOMER s'inscrit ou se connecte,
 * ADMIN / SUPER_ADMIN se connectent sur la même page. Sans backend, tout est local et l'écran le
 * dit (roles.demoNote) — aucun faux « traitement en cours ».
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Sparkles, UserRound, ShieldCheck } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { buttonClasses } from "@/components/ui/Button";
import { Locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ROLES, ageEnAnnees, comptePour, emailValide, enregistrerCompte, hacher, ouvrirSession,
  type ProfilInscription, type Role,
} from "@/lib/auth";
import { enregistrerBanque, ouvrirBanqueClient } from "@/lib/banque";
import { API, apiPost, type SessionApi } from "@/lib/api";
import { COMPTES_PORTE_DEMO } from "@/lib/serveur-demo";

const CLES_ROLE: Record<Role, string> = {
  CUSTOMER: "auth.role.customer",
  ADMIN: "auth.role.admin",
  SUPER_ADMIN: "auth.role.super",
};
const CLES_MARITAL: Record<string, string> = {
  single: "auth.marital.single", married: "auth.marital.married", cohabiting: "auth.marital.cohabiting",
  divorced: "auth.marital.divorced", widow: "auth.marital.widow",
};
const CLES_LOGEMENT: Record<string, string> = {
  owner: "auth.housing.owner", tenant: "auth.housing.tenant", free: "auth.housing.free",
};

const CLS_INPUT =
  "mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink bg-white focus:outline-none focus:border-primary";

const VIDE: ProfilInscription = {
  nom: "", prenom: "", naissance: "", nationalite: "Belgique", marital: "single",
  rue: "", numero: "", boite: "", codePostal: "", ville: "", pays: "Belgique", telephone: "",
  employeur: "", profession: "", anciennete: "", entreprise: "", tva: "", secteur: "",
  revenusNets: "", logement: "tenant", chargeLogement: "", iban: "", creditsExistants: "",
};

export default function AuthPage({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");

  // ——— connexion ———
  const [role, setRole] = useState<Role>("CUSTOMER");
  const [lEmail, setLEmail] = useState("");
  const [lMdp, setLMdp] = useState("");
  const [errLogin, setErrLogin] = useState("");

  // ——— inscription ———
  const [f, setF] = useState(VIDE);
  const [mdp, setMdp] = useState("");
  const [mdp2, setMdp2] = useState("");
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const maj = (k: keyof ProfilInscription) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  /** Connexion VÉRIFIÉE PAR LE SERVEUR (scrypt salé, session httpOnly) ; la session locale
   *  n'est qu'un miroir pour le portail démo. */
  const connecterServeur = async (email: string, mdpSaisi: string, r: Role): Promise<"ok" | "identifiants" | "reseau"> => {
    const reponse = await apiPost<SessionApi>(API.connexion, { email, motDePasse: mdpSaisi, role: r });
    if (reponse.statut === 0) return "reseau";
    if (!reponse.ok) return "identifiants";
    ouvrirSession({ email: reponse.corps.email, role: reponse.corps.role, nom: reponse.corps.nom, ouverteA: reponse.corps.ouverteA });
    return "ok";
  };

  const surConnexion = async () => {
    if (!emailValide(lEmail) || lMdp.length < 8) { setErrLogin("auth.errCredentials"); return; }
    const resultat = await connecterServeur(lEmail, lMdp, role);
    if (resultat === "reseau") { setErrLogin("auth.errServeur"); return; }
    if (resultat === "identifiants") { setErrLogin("auth.errCredentials"); return; }
    router.push(`/${locale}/account`);
  };

  const surDemo = async (r: Role) => {
    const porte = COMPTES_PORTE_DEMO.find((c) => c.role === r);
    if (!porte) return;
    const resultat = await connecterServeur(porte.email, porte.motDePasse, r);
    if (resultat === "reseau") { setErrLogin("auth.errServeur"); return; }
    if (resultat === "identifiants") { setErrLogin("auth.errCredentials"); return; }
    router.push(`/${locale}/account`);
  };

  const surInscription = async () => {
    const e: Record<string, string> = {};
    const requis: Array<[keyof ProfilInscription, string]> = [
      ["nom", "auth.errRequired"], ["prenom", "auth.errRequired"], ["rue", "auth.errRequired"],
      ["codePostal", "auth.errRequired"], ["ville", "auth.errRequired"], ["pays", "auth.errRequired"],
      ["telephone", "auth.errRequired"],
    ];
    for (const [champ, cle] of requis) if (!f[champ].trim()) e[champ] = cle;
    if (!f.naissance) e.naissance = "auth.errRequired";
    else if (ageEnAnnees(f.naissance, new Date()) < 18) e.naissance = "auth.errRequired";
    if (!emailValide(lEmail)) e.email = "application.errEmail";
    if (mdp.length < 8) e.mdp = "auth.errPassword";
    if (mdp2 !== mdp) e.mdp2 = "auth.errPasswordMatch";
    if (!consent) e.consent = "auth.errConsent";
    if (!terms) e.terms = "auth.errRequired";
    setErrs(e);
    if (Object.keys(e).length) return;
    if (comptePour(lEmail, "CUSTOMER")) {
      setErrs({ email: "auth.errExists" });
      return;
    }
    // Le compte est créé PAR LE SERVEUR (scrypt salé, session httpOnly). La copie locale qui
    // suit est le miroir démo du portail : profil affiché et banque locale ; l'authentification,
    // elle, fait foi côté serveur.
    const nomComplet = `${f.prenom.trim()} ${f.nom.trim()}`;
    const reponse = await apiPost<SessionApi>(API.inscription, {
      email: lEmail.trim(), motDePasse: mdp, nom: nomComplet, profil: f,
    });
    if (reponse.statut === 0) { setErrs({ email: "auth.errServeur" }); return; }
    if (!reponse.ok) {
      setErrs({ email: reponse.corps.erreur === "existant" ? "auth.errExists" : "auth.errRequired" });
      return;
    }
    const maintenant = new Date().toISOString();
    enregistrerCompte({
      email: lEmail.trim(), hash: await hacher(mdp), role: "CUSTOMER",
      nom: nomComplet, creeA: maintenant, profil: f,
    });
    // Ouverture de la banque locale (slice 8) : IBAN fictif déterministe + dotation démo.
    enregistrerBanque(lEmail.trim(), "CUSTOMER", ouvrirBanqueClient(lEmail.trim(), "CUSTOMER", maintenant));
    ouvrirSession({ email: lEmail.trim(), role: "CUSTOMER", nom: nomComplet, ouverteA: maintenant });
    router.push(`/${locale}/account`);
  };

  const erreur = (k: string) =>
    errs[k] ? <p role="alert" className="mt-1 text-[12px] font-semibold text-red-600">{tr(errs[k])}</p> : null;

  const titreSection = (cle: string) => (
    <h3 className="mt-8 mb-3 text-[11px] font-extrabold tracking-widest uppercase text-primary flex items-center gap-2">
      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {tr(cle)}
    </h3>
  );

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-[1280px] px-6 py-10 md:py-16 grid lg:grid-cols-[1fr_1.15fr] gap-8 items-stretch">
        {/* ——— Panneau gauche : ludique, et le crédit mis en avant ——— */}
        <Reveal as="div" variant="fade" className="relative rounded-[28px] overflow-hidden bg-ink shadow-card min-h-[420px] flex">
          <img src="/images/auth-panel.jpg" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10" aria-hidden="true" />
          <div className="relative p-8 md:p-10 flex flex-col justify-end w-full">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-widest uppercase font-bold text-white/90 backdrop-blur">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> BE • EUR • KYC/AML
            </div>
            <h2 className="mt-4 font-display font-extrabold text-white text-[30px] md:text-[36px] leading-[1.05] tracking-tight">
              KREDIT<span className="text-primary">.</span>
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/70 max-w-[420px]">{tr("cta.bannerSub")}</p>
            <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "lg", "gap-2 mt-6 self-start")}>
              {tr("auth.creditCta")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <p className="mt-4 text-[11px] text-white/45">{tr("roles.demoNote")}</p>
          </div>
        </Reveal>

        {/* ——— Panneau droit : connexion / inscription ——— */}
        <Reveal as="div" variant="left" retard={100} className="bg-white rounded-[28px] shadow-card border p-6 md:p-10">
          <div className="grid grid-cols-2 gap-2 rounded-full bg-surface border p-1" role="tablist" aria-label={tr("nav.login")}>
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m} type="button" role="tab" aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-10 rounded-full text-[12px] font-extrabold uppercase tracking-wider transition",
                  mode === m ? "bg-ink text-white" : "text-slate-500 hover:text-ink",
                )}
              >
                {tr(m === "login" ? "auth.loginTab" : "auth.signupTab")}
              </button>
            ))}
          </div>

          {mode === "login" ? (
            <div className="mt-8">
              <h1 className="font-display font-extrabold text-ink text-[28px] tracking-tight">{tr("auth.loginTitle")}</h1>
              <div className="mt-5">
                <span className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.roleLabel")}</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}
                      className={cn(
                        "h-10 rounded-full text-[11px] font-extrabold uppercase tracking-wide border transition",
                        role === r ? "bg-primary text-white border-primary" : "bg-white text-slate-500 border-slate-200 hover:border-ink/40",
                      )}
                    >
                      {tr(CLES_ROLE[r])}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <label htmlFor="auth-email" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("contact.email")}</label>
                <input id="auth-email" type="email" autoComplete="email" value={lEmail} onChange={(e) => setLEmail(e.target.value)} className={CLS_INPUT} />
              </div>
              <div className="mt-4">
                <label htmlFor="auth-mdp" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.password")}</label>
                <input id="auth-mdp" type="password" autoComplete="current-password" value={lMdp} onChange={(e) => setLMdp(e.target.value)} className={CLS_INPUT} />
              </div>
              {errLogin && <p role="alert" className="mt-2 text-[12px] font-semibold text-red-600">{tr(errLogin)}</p>}
              <button type="button" onClick={surConnexion} className={buttonClasses("primary", "lg", "w-full mt-6")}>
                <Lock className="w-4 h-4" aria-hidden="true" /> {tr("auth.loginCta")}
              </button>
              <p className="mt-6 text-[11px] text-slate-400">{tr("auth.staffNote")}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {ROLES.map((r) => (
                  <button key={r} type="button" onClick={() => surDemo(r)} className={buttonClasses("outline-light", "sm", "w-full")}>
                    {tr("shell.loginAsDemo", { role: tr(CLES_ROLE[r]) })}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-8">
              <h1 className="font-display font-extrabold text-ink text-[28px] tracking-tight">{tr("auth.signupTitle")}</h1>

              {titreSection("auth.sectionIdentity")}
              <div className="grid md:grid-cols-2 gap-x-4 gap-y-4">
                <div><label htmlFor="s-nom" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.lastName")}</label><input id="s-nom" autoComplete="family-name" value={f.nom} onChange={maj("nom")} className={CLS_INPUT} />{erreur("nom")}</div>
                <div><label htmlFor="s-prenom" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.firstName")}</label><input id="s-prenom" autoComplete="given-name" value={f.prenom} onChange={maj("prenom")} className={CLS_INPUT} />{erreur("prenom")}</div>
                <div><label htmlFor="s-naissance" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.birthDate")}</label><input id="s-naissance" type="date" value={f.naissance} onChange={maj("naissance")} className={CLS_INPUT} />{erreur("naissance")}</div>
                <div><label htmlFor="s-nationalite" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.nationality")}</label><input id="s-nationalite" value={f.nationalite} onChange={maj("nationalite")} className={CLS_INPUT} /></div>
                <div className="md:col-span-2"><label htmlFor="s-marital" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.maritalLabel")}</label><select id="s-marital" value={f.marital} onChange={maj("marital")} className={CLS_INPUT}>{Object.entries(CLES_MARITAL).map(([c, cle]) => <option key={c} value={c}>{tr(cle)}</option>)}</select></div>
              </div>

              {titreSection("auth.sectionAddress")}
              <div className="grid md:grid-cols-[1fr_110px_90px] gap-x-4 gap-y-4">
                <div><label htmlFor="s-rue" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.street")}</label><input id="s-rue" autoComplete="address-line1" value={f.rue} onChange={maj("rue")} className={CLS_INPUT} />{erreur("rue")}</div>
                <div><label htmlFor="s-numero" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.houseNumber")}</label><input id="s-numero" value={f.numero} onChange={maj("numero")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-boite" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.box")}</label><input id="s-boite" value={f.boite} onChange={maj("boite")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-cp" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.postalCode")}</label><input id="s-cp" autoComplete="postal-code" value={f.codePostal} onChange={maj("codePostal")} className={CLS_INPUT} />{erreur("codePostal")}</div>
                <div><label htmlFor="s-ville" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.city")}</label><input id="s-ville" autoComplete="address-level2" value={f.ville} onChange={maj("ville")} className={CLS_INPUT} />{erreur("ville")}</div>
                <div><label htmlFor="s-pays" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.country")}</label><input id="s-pays" autoComplete="country-name" value={f.pays} onChange={maj("pays")} className={CLS_INPUT} />{erreur("pays")}</div>
                <div><label htmlFor="s-tel" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.phoneMobile")}</label><input id="s-tel" type="tel" autoComplete="tel" value={f.telephone} onChange={maj("telephone")} className={CLS_INPUT} />{erreur("telephone")}</div>
                <div><label htmlFor="s-email" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("contact.email")}</label><input id="s-email" type="email" autoComplete="email" value={lEmail} onChange={(e) => setLEmail(e.target.value)} className={CLS_INPUT} />{erreur("email")}</div>
              </div>

              {titreSection("auth.sectionActivity")}
              <div className="grid md:grid-cols-2 gap-x-4 gap-y-4">
                <div><label htmlFor="s-employeur" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.employer")}</label><input id="s-employeur" autoComplete="organization" value={f.employeur} onChange={maj("employeur")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-profession" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.jobTitle")}</label><input id="s-profession" autoComplete="organization-title" value={f.profession} onChange={maj("profession")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-anciennete" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.seniority")}</label><input id="s-anciennete" type="number" min={0} value={f.anciennete} onChange={maj("anciennete")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-secteur" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.sector")}</label><input id="s-secteur" value={f.secteur} onChange={maj("secteur")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-entreprise" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.companyName")}</label><input id="s-entreprise" value={f.entreprise} onChange={maj("entreprise")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-tva" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.vatNumber")}</label><input id="s-tva" value={f.tva} onChange={maj("tva")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-revenus" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.monthlyIncomeNet")}</label><input id="s-revenus" type="number" min={0} step={50} value={f.revenusNets} onChange={maj("revenusNets")} className={CLS_INPUT} /></div>
              </div>

              {titreSection("auth.sectionFinance")}
              <div className="grid md:grid-cols-2 gap-x-4 gap-y-4">
                <div><label htmlFor="s-logement" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.housingLabel")}</label><select id="s-logement" value={f.logement} onChange={maj("logement")} className={CLS_INPUT}>{Object.entries(CLES_LOGEMENT).map(([c, cle]) => <option key={c} value={c}>{tr(cle)}</option>)}</select></div>
                <div><label htmlFor="s-charge" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.housingCost")}</label><input id="s-charge" type="number" min={0} step={50} value={f.chargeLogement} onChange={maj("chargeLogement")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-iban" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.iban")}</label><input id="s-iban" autoComplete="off" placeholder="BE··" value={f.iban} onChange={maj("iban")} className={CLS_INPUT} /></div>
                <div><label htmlFor="s-credits" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.existingDebts")}</label><input id="s-credits" type="number" min={0} step={50} value={f.creditsExistants} onChange={maj("creditsExistants")} className={CLS_INPUT} /></div>
              </div>

              <div className="mt-6 space-y-3">
                <label className="flex items-start gap-3 text-[13px] leading-5 text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary" />
                  <span>{tr("contact.consent")}</span>
                </label>
                {erreur("consent")}
                <label className="flex items-start gap-3 text-[13px] leading-5 text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary" />
                  <span>{tr("auth.consentTerms")}</span>
                </label>
                {erreur("terms")}
              </div>

              <div className="mt-6 grid md:grid-cols-2 gap-4">
                <div><label htmlFor="s-mdp" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.password")}</label><input id="s-mdp" type="password" autoComplete="new-password" value={mdp} onChange={(e) => setMdp(e.target.value)} className={CLS_INPUT} />{erreur("mdp")}</div>
                <div><label htmlFor="s-mdp2" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("auth.passwordConfirm")}</label><input id="s-mdp2" type="password" autoComplete="new-password" value={mdp2} onChange={(e) => setMdp2(e.target.value)} className={CLS_INPUT} />{erreur("mdp2")}</div>
              </div>

              <button type="button" onClick={surInscription} className={buttonClasses("primary", "lg", "w-full mt-6")}>
                <UserRound className="w-4 h-4" aria-hidden="true" /> {tr("auth.signupCta")}
              </button>
              <p className="mt-4 text-[11px] text-slate-400">{tr("roles.demoNote")} {tr("contact.noSensitive")}</p>
            </div>
          )}
        </Reveal>
      </div>
    </div>
  );
}
