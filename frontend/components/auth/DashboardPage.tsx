"use client";
/**
 * « use client » : session, préférences et marques lus après montage ; premier rendu client =
 * HTML serveur (portail verrouillé), l'effet révèle le dashboard — pas de mismatch.
 *
 * Néo-banque, mais sans une donnée fausse :
 * - tout chiffre vient des demandes RÉELLEMENT déposées sur l'appareil, recalculées dans le moteur
 *   (mensualités, échéancier, courbe d'amortissement) — les projections sont étiquetées
 *   `dashboard.projection` ;
 * - préférences de notification et documents « fournis » : réglés par l'utilisateur, persistés ;
 * - la « carte membre » porte les vraies données du compte (nom, email, rôle, date), pas un PAN.
 */
import { useEffect, useMemo, useId, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft, ArrowRight, BadgeCheck, Bell, BellRing, CalendarClock, Camera, ChevronDown,
  CreditCard, FileText, Fingerprint, Landmark, LayoutDashboard, Lock, LogOut, Mail,
  MessageCircle, Receipt, ScrollText, ShieldAlert, Smartphone, UserRound, Wallet,
} from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import { buttonClasses } from "@/components/ui/Button";
import { formatDate, formatCurrency0, formatDateTime, formatPercent } from "@/lib/formatters";
import { formatEUR2 } from "@/lib/utils";
import { Locale, t, tSiCle } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  comptePour, fermerSession, lireSession,
  type Role, type Session,
} from "@/lib/auth";
import BankPortal from "@/components/auth/BankPortal";
import OpsPortal from "@/components/auth/OpsPortal";
import GrilleHistorique from "@/components/auth/GrilleHistorique";
import { API, apiGet, apiPost } from "@/lib/api";
import type { BanqueCompte } from "@/lib/banque";
import { lireDemandes, type DemandeLocale } from "@/lib/application";
import type { DemandeServeur, DocumentServeur, NotificationServeur, PaiementServeur } from "@/lib/serveur";
import { simulateCredit, DOCUMENT_CODES, type ProductCode } from "@/lib/credit-engine";
import {
  DEFAUT_PREFS, enregistrerPrefs, lirePrefs,
  mensualiteDe, moyenne, pointsCourbe, prochaineEcheance, type PrefsNotif,
} from "@/lib/compte";

type Onglet = "apercu" | "demandes" | "echeanciers" | "paiements" | "documents" | "notifications" | "profil" | "banque" | "operations" | "grille";

const CLES_MARITAL_PROFIL = ["single", "married", "cohabiting", "divorced", "widow"];
const CLES_LOGEMENT_PROFIL = ["owner", "tenant", "free"];

const CLES_ROLE: Record<Role, string> = {
  CUSTOMER: "auth.role.customer", ADMIN: "auth.role.admin", SUPER_ADMIN: "auth.role.super",
};
const CLES_PRODUIT: Record<ProductCode, string> = {
  PERSONAL: "credit:simulator.tab.PERSONAL", MORTGAGE: "credit:simulator.tab.MORTGAGE",
  BUSINESS: "credit:simulator.tab.BUSINESS", INVESTMENT: "credit:simulator.tab.INVESTMENT",
};
const CLES_DOC: Record<(typeof DOCUMENT_CODES)[number], string> = {
  ID: "credit:documents.ID", INCOME_3M: "credit:documents.INCOME_3M", PROOF_ADDRESS: "credit:documents.PROOF_ADDRESS",
  PROPERTY_VALUATION: "credit:documents.PROPERTY_VALUATION", BANK_STATEMENTS_3M: "credit:documents.BANK_STATEMENTS_3M",
  TAX_RETURN_2Y: "credit:documents.TAX_RETURN_2Y", BUSINESS_PLAN: "credit:documents.BUSINESS_PLAN",
};

const CLES_STATUT_ENVOI: Record<string, string> = {
  envoye: "notifications.statut.envoye", echec: "notifications.statut.echec",
  desactive: "notifications.statut.desactive", non_configure: "notifications.statut.nonConfigure",
};
/** Badge de distribution d'une notification : l'état RÉEL du canal (rien n'est simulé). */
function BadgeCanal({ libelle, statut, tr }: { libelle: string; statut: string; tr: (k: string) => string }) {
  const couleur = statut === "envoye" ? "bg-emerald-50 text-emerald-600"
    : statut === "echec" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full", couleur)}>
      {libelle} · {tr(CLES_STATUT_ENVOI[statut] ?? CLES_STATUT_ENVOI.non_configure)}
    </span>
  );
}

/* ——— Courbe d'amortissement SVG : le restant dû mois par mois, calculé, jamais décoratif. ——— */
function CourbeAmortissement({ points, formatY }: { points: Array<[number, number]>; formatY: (n: number) => string }) {
  const id = useId();
  const W = 560, H = 170, P = 10;
  const max = Math.max(...points.map((p) => p[1]), 1);
  const n = points.length;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, n - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const ligne = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const aire = `${ligne} L${x(n - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={formatY(max)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(255 74 23)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(255 74 23)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={aire} fill={`url(#${id})`} />
      <path d={ligne} fill="none" stroke="rgb(255 74 23)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(points[0][1])} r="4" fill="rgb(255 74 23)" />
      <circle cx={x(n - 1)} cy={y(points[n - 1][1])} r="4" fill="rgb(16 185 129)" />
      <text x={P} y={14} className="fill-white/50" fontSize="10">{formatY(max)}</text>
      <text x={W - P} y={H - 2} textAnchor="end" className="fill-white/50" fontSize="10">{points[n - 1][0]} m</text>
    </svg>
  );
}

export default function DashboardPage({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);
  const [demandesLocales, setDemandesLocales] = useState<DemandeLocale[]>([]);
  const [demandesServeur, setDemandesServeur] = useState<DemandeServeur[]>([]);
  const [paiements, setPaiements] = useState<PaiementServeur[]>([]);
  const [msgPaiement, setMsgPaiement] = useState(false);
  const [docsServeur, setDocsServeur] = useState<DocumentServeur[]>([]);
  const [notifs, setNotifs] = useState<NotificationServeur[]>([]);
  const [erreurDepot, setErreurDepot] = useState<string | null>(null);
  const [prefsReelles, setPrefsReelles] = useState<{ email: boolean; whatsapp: boolean; numeroWhatsapp: string | null } | null>(null);
  const [msgPrefsReelles, setMsgPrefsReelles] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>("apercu");
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [choisie, setChoisie] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PrefsNotif>(DEFAUT_PREFS);
  const [mdpActuel, setMdpActuel] = useState("");
  const [mdpNeuf, setMdpNeuf] = useState("");
  const [msgMdp, setMsgMdp] = useState<"ok" | "err" | null>(null);
  const [banqueProfil, setBanqueProfil] = useState<BanqueCompte | null>(null);
  const [profilServeur, setProfilServeur] = useState<Record<string, string> | null>(null);
  const [creeAServeur, setCreeAServeur] = useState<string | null>(null);
  const [formContact, setFormContact] = useState<Record<string, string> | null>(null);
  const [msgProfil, setMsgProfil] = useState<"ok" | "err" | null>(null);
  const [erreurPhoto, setErreurPhoto] = useState(false);

  useEffect(() => {
    const s = lireSession();
    setSession(s);
    if (s) {
      setDemandesLocales(lireDemandes().filter((d) => d.email.toLowerCase() === s.email.toLowerCase()));
      // Les demandes font foi côté serveur : l'aperçu du menu « Demandes » lit la table du
      // magasin (semée pour le client démo) — le miroir local ne sert que de secours hors ligne.
      if (s.role === "CUSTOMER") {
        apiGet<{ demandes: DemandeServeur[] }>(API.demandes).then((r) => {
          if (r.ok) setDemandesServeur(r.corps.demandes);
        });
        apiGet<{ paiements: PaiementServeur[] }>(API.paiements).then((r) => {
          if (r.ok) setPaiements(r.corps.paiements);
        });
        apiGet<{ documents: DocumentServeur[] }>(API.documents).then((r) => {
          if (r.ok) setDocsServeur(r.corps.documents);
        });
        apiGet<{ notifications: NotificationServeur[]; prefs?: { email: boolean; whatsapp: boolean; numeroWhatsapp: string | null } }>(API.notifications).then((r) => {
          if (r.ok) {
            setNotifs(r.corps.notifications);
            if (r.corps.prefs) setPrefsReelles(r.corps.prefs);
          }
        });
      }
      setPrefs(lirePrefs());
      if (s.role === "CUSTOMER") {
        // La banque vit côté serveur (slice 11) : photo, IBAN et vérification en viennent.
        apiGet<{ compte: BanqueCompte }>(API.banque).then((r) => {
          if (r.ok) setBanqueProfil(r.corps.compte);
        });
      }
      // Profil et date de création : le serveur fait foi (comptes démo semés inclus).
      // Réconciliation : un miroir local périmé (store remis à zéro, cookie orphelin) renvoie
      // vers l'authentification au lieu d'afficher un compte vide à €0.00.
      apiGet<{ session: { profil?: Record<string, string> | null; creeA?: string } | null }>(API.session).then((r) => {
        if (r.ok && !r.corps.session) { fermerSession(); setSession(null); return; }
        if (r.ok && r.corps.session) {
          const p = r.corps.session.profil ?? null;
          setProfilServeur(p);
          setCreeAServeur(r.corps.session.creeA ?? null);
          if (p) setFormContact((prev) => prev ?? { ...p });
        }
      });
    }
    setPret(true);
  }, []);

  /** Demandes affichées = demandes du serveur (source de vérité) + locales non encore déposées.
   *  Un id présent des deux côtés n'apparaît qu'une fois. Tri : les plus récentes d'abord. */
  const demandes = useMemo<DemandeLocale[]>(() => {
    const duServeur: DemandeLocale[] = demandesServeur.map((d) => ({
      id: d.id, createdAt: d.creeA, statut: d.statut, etat: d.etat, nom: d.nom, email: d.email, telephone: d.telephone,
    }));
    const ids = new Set(duServeur.map((d) => d.id));
    return [...duServeur, ...demandesLocales.filter((d) => !ids.has(d.id))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [demandesServeur, demandesLocales]);

  const sims = useMemo(() => {
    const m = new Map<string, ReturnType<typeof simulateCredit>>();
    for (const d of demandes) m.set(d.id, simulateCredit({
      amount: d.etat.amount, termMonths: d.etat.term, monthlyIncome: d.etat.income,
      monthlyCharges: d.etat.charges, incomeType: d.etat.incomeType, employmentStatus: d.etat.employment,
      loanPurpose: d.etat.purpose, existingCreditsMonthly: d.etat.existing, country: "BE", productType: d.etat.product,
    }));
    return m;
  }, [demandes]);

  if (!pret || !session) {
    return (
      <div className="bg-surface">
        <div className="mx-auto max-w-[1280px] px-6 py-16">
          <Reveal as="div" variant="fade" className="bg-white rounded-[24px] shadow-card border p-8 md:p-12 text-center max-w-xl mx-auto">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-primary-light text-primary grid place-items-center">
              <UserRound className="w-7 h-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-extrabold text-ink text-xl">{tr("shell.gateTitle")}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{tr("roles.demoNote")}</p>
            <Link href={`/${locale}/auth`} className={buttonClasses("primary", "lg", "mt-6")}>
              {tr("auth.loginCta")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
      </div>
    );
  }

  const mensualites = demandes.map((d) => mensualiteDe(d));
  const moy = moyenne(mensualites);
  const echeance = demandes.length ? prochaineEcheance(new Date()) : null;
  const demandeCourante = demandes.find((d) => d.id === (choisie ?? demandes[0]?.id)) ?? null;

  const changerMdp = async () => {
    setMsgMdp(null);
    if (mdpNeuf.length < 8) { setMsgMdp("err"); return; }
    // Le serveur fait foi : scrypt salé, ancien mot de passe exigé (POST /api/auth/mdp).
    const r = await apiPost<{ ok?: boolean }>(API.mdp, { actuel: mdpActuel, nouveau: mdpNeuf });
    if (r.ok) { setMsgMdp("ok"); setMdpActuel(""); setMdpNeuf(""); } else { setMsgMdp("err"); }
  };

  /** Menu Profil : adresse & téléphone éditables, enregistrés côté serveur (liste blanche). */
  const enregistrerProfil = async () => {
    if (!formContact) return;
    setMsgProfil(null);
    const r = await apiPost<{ profil?: Record<string, string> }>(API.profil, formContact);
    if (r.ok && r.corps.profil) {
      setProfilServeur(r.corps.profil);
      setFormContact({ ...r.corps.profil });
      setMsgProfil("ok");
    } else {
      setMsgProfil("err");
    }
  };

  /** Préférences de distribution RÉELLE (source : le serveur) — e-mail du compte, WhatsApp au
   *  numéro du profil. Les canaux non configurés côté serveur sont montrés comme tels. */
  const changerPrefReelle = async (k: "email" | "whatsapp", v: boolean) => {
    setPrefsReelles((p) => (p ? { ...p, [k]: v } : p));
    const r = await apiPost<{ prefs?: { email: boolean; whatsapp: boolean } }>(API.notifications, { action: "prefs", [k]: v });
    if (r.ok && r.corps.prefs) {
      setPrefsReelles((p) => (p ? { ...p, ...r.corps.prefs } : p));
      setMsgPrefsReelles(true);
    }
  };
  /** Une vraie notification de test part sur les canaux configurés — la preuve du câblage. */
  const envoyerNotifTest = async () => {
    const r = await apiPost<{ notification?: NotificationServeur }>(API.notifications, { action: "tester" });
    if (r.ok && r.corps.notification) setNotifs((prev) => [...prev, r.corps.notification!]);
  };

  /** Téléversement d'un justificatif : lu en dataURL, plafonné côté client ET côté serveur,
   *  déposé dans la table des documents — l'administration le lit et l'approuve ensuite. */
  const televerserDoc = (demandeId: string, code: string, fichier: File | null) => {
    setErreurDepot(null);
    if (!fichier) return;
    if (fichier.size > 5 * 1024 * 1024) { setErreurDepot("documents.tooBig"); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => {
      void apiPost<{ document?: DocumentServeur }>(API.documents, {
        action: "deposer", demandeId, code, nom: fichier.name,
        donnees: String(lecteur.result), taille: fichier.size,
      }).then((r) => {
        if (r.ok && r.corps.document) {
          const neuf = r.corps.document;
          setDocsServeur((prev) => {
            const sans = prev.filter((x) => !(x.demandeId === neuf.demandeId && x.code === neuf.code));
            return [...sans, neuf];
          });
        } else setErreurDepot("documents.tooBig");
      });
    };
    lecteur.readAsDataURL(fichier);
  };

  /** Le client règle une charge : le serveur la passe en « paiement déclaré » ; c'est la
   *  confirmation de l'administration qui la marquera payée (le serveur fait foi). */
  const reglerPaiementClient = async (paiementId: string) => {
    const r = await apiPost<{ paiement?: PaiementServeur }>(API.paiements, { action: "payer", paiementId });
    if (r.ok && r.corps.paiement) {
      const neuf = r.corps.paiement;
      setPaiements((prev) => prev.map((p) => (p.id === neuf.id ? neuf : p)));
      setMsgPaiement(true);
    }
  };

  /** Champ éditable du bloc « Adresse & téléphone » (menu Profil). */
  const champContact = (key: string, cleLabel: string) => (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr(cleLabel)}</span>
      <input
        value={formContact?.[key] ?? ""}
        onChange={(e) => setFormContact((p) => ({ ...(p ?? {}), [key]: e.target.value }))}
        className="mt-1 w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );

  const regle = (k: keyof PrefsNotif) => {
    const p = { ...prefs, [k]: !prefs[k] };
    if (k === "whatsapp" && p.whatsapp && !p.whatsappConsent) p.whatsappConsent = true;
    setPrefs(p); enregistrerPrefs(p);
  };

  /** Photo de profil : redimensionnée en 256×256 sur canvas avant stockage local (démo). */
  const choisirPhoto = (fichier: File | null) => {
    setErreurPhoto(false);
    if (!fichier || !session || !banqueProfil) return;
    if (fichier.size > 5 * 1024 * 1024) { setErreurPhoto(true); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const image = new Image();
      image.onload = () => {
        const taille = 256;
        const canvas = document.createElement("canvas");
        canvas.width = taille; canvas.height = taille;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const cote = Math.min(image.width, image.height);
        ctx.drawImage(image, (image.width - cote) / 2, (image.height - cote) / 2, cote, cote, 0, 0, taille, taille);
        const donnees = canvas.toDataURL("image/jpeg", 0.85);
        void apiPost<{ compte?: BanqueCompte }>(API.banque, { action: "photo", photo: donnees }).then((r) => {
          if (r.ok && r.corps.compte) setBanqueProfil(r.corps.compte);
        });
      };
      image.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  };

  const retirerPhoto = () => {
    if (!session || !banqueProfil) return;
    void apiPost<{ compte?: BanqueCompte }>(API.banque, { action: "photo", photo: null }).then((r) => {
      if (r.ok && r.corps.compte) setBanqueProfil(r.corps.compte);
    });
  };

  const ONGLETS: Array<{ id: Onglet; icone: typeof Wallet; cle: string }> = [
    { id: "apercu", icone: LayoutDashboard, cle: "dashboard.tab.overview" },
    ...(session.role === "CUSTOMER" ? [{ id: "banque" as Onglet, icone: Landmark, cle: "banque:tab" }] : []),
    ...(session.role !== "CUSTOMER" ? [{ id: "operations" as Onglet, icone: ShieldAlert, cle: "banque:opsTab" }] : []),
    ...(session.role === "SUPER_ADMIN" ? [{ id: "grille" as Onglet, icone: ScrollText, cle: "admin.grille.tab" }] : []),
    { id: "demandes", icone: FileText, cle: "dashboard.applications.title" },
    { id: "echeanciers", icone: CalendarClock, cle: "nav.repayments" },
    { id: "paiements", icone: Wallet, cle: "payments.title" },
    { id: "documents", icone: Fingerprint, cle: "documents.title" },
    { id: "notifications", icone: Bell, cle: "notifications.title" },
    { id: "profil", icone: UserRound, cle: "nav.profile" },
  ];

  return (
    <div className="bg-surface min-h-[70vh]">
      <div className="mx-auto max-w-[1280px] px-6 py-8 md:py-12 grid lg:grid-cols-[250px_1fr] gap-8 items-start">
        {/* ——— Rail de navigation ——— */}
        <nav className="lg:sticky lg:top-24 flex lg:flex-col gap-1.5 overflow-x-auto pb-2 lg:pb-0" aria-label={tr("account.title")}>
          <div className="hidden lg:flex items-center gap-3 px-3 pb-4">
            {banqueProfil?.photo
              ? // eslint-disable-next-line @next/next/no-img-element
                <img src={banqueProfil.photo} alt="" className="w-11 h-11 rounded-2xl object-cover border" />
              : (
                <span className="w-11 h-11 rounded-2xl bg-primary text-white grid place-items-center font-extrabold">
                  {session.nom.slice(0, 1).toUpperCase()}
                </span>
              )}
            <div>
              <div className="font-extrabold text-ink leading-tight">{session.nom}</div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-primary">{tr(CLES_ROLE[session.role])}</div>
            </div>
          </div>
          {ONGLETS.map((o) => (
            <button
              key={o.id} type="button" onClick={() => setOnglet(o.id)} aria-current={onglet === o.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 shrink-0 px-4 h-11 rounded-full text-[13px] font-bold transition",
                onglet === o.id ? "bg-ink text-white shadow-card" : "text-slate-500 hover:bg-white hover:text-ink",
              )}
            >
              <o.icone className="w-4 h-4" aria-hidden="true" /> {tr(o.cle)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { void apiPost(API.deconnexion, {}, { keepalive: true }); fermerSession(); window.location.assign(`/${locale}`); }}
            className="flex items-center gap-3 shrink-0 px-4 h-11 rounded-full text-[13px] font-bold text-red-600 hover:bg-red-50 transition"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> {tr("shell.logout")}
          </button>
        </nav>

        {/* ——— Contenu ——— */}
        <div className="space-y-6 min-w-0">
          {onglet === "apercu" && (
            <>
              <Reveal as="div" variant="fade" className="relative rounded-[28px] overflow-hidden bg-ink text-white p-6 md:p-8 shadow-card">
                <div className="maillage opacity-50" aria-hidden="true" />
                <div className="relative flex flex-wrap items-end justify-between gap-6">
                  <div>
                    <div className="text-[13px] tracking-[0.18em] font-bold uppercase text-primary">{tr("dashboard.greeting", { name: session.nom.split(" ")[0] })}</div>
                    <h1 className="mt-1 font-display font-extrabold text-[28px] md:text-[34px] tracking-tight">{tr("dashboard.subtitle")}</h1>
                    {/* Le statut KYC reflète la vérification faite par l'administration (serveur fait foi). */}
                    {session.role === "CUSTOMER" && (
                      <div className={cn(
                        "mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-bold tracking-widest uppercase",
                        banqueProfil?.verifie
                          ? "bg-emerald-400/15 border-emerald-300/30 text-emerald-300"
                          : "bg-amber-400/15 border-amber-300/30 text-amber-300",
                      )}>
                        <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" /> {tr(banqueProfil?.verifie ? "dashboard.kyc.verified" : "dashboard.kyc.pending")}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-white/50 max-w-[420px]">{tr(banqueProfil?.verifie ? "dashboard.kycHowVerified" : "dashboard.kycHow")}</p>
                  </div>
                  {/* Carte membre : les vraies données du compte, habillées néo-banque. */}
                  <div className="w-full max-w-[340px] rounded-[20px] p-5 bg-gradient-to-br from-primary/90 via-ink to-ink border border-white/15 shadow-card rotate-[-1.5deg] hover:rotate-0 transition-transform">
                    <div className="flex items-center justify-between">
                      <span className="font-display font-extrabold tracking-tight">KREDIT<span className="text-primary">.</span></span>
                      <CreditCard className="w-5 h-5 text-white/70" aria-hidden="true" />
                    </div>
                    <div className="mt-6 text-[11px] font-bold tracking-widest uppercase text-white/60">{tr("dashboard.card.member")}</div>
                    <div className="mt-1 font-extrabold text-[17px] tracking-wide uppercase">{session.nom}</div>
                    <div className="mt-4 flex items-center justify-between text-[11px] text-white/60 tabular-nums">
                      <span>{session.email}</span>
                      <span>{tr("dashboard.card.since")} {formatDate(creeAServeur ?? comptePour(session.email, session.role)?.creeA ?? session.ouverteA, locale)}</span>
                    </div>
                  </div>
                </div>
              </Reveal>

              <div className="grid sm:grid-cols-3 gap-4">
                <Reveal as="div" variant="rise" className="bg-white rounded-[20px] border shadow-soft p-5">
                  <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.stats.dossiers")}</div>
                  <div className="mt-1 font-display font-extrabold text-ink text-[32px] tabular-nums">
                    <CountUp a={demandes.length} final={String(demandes.length)} duree={700} />
                  </div>
                </Reveal>
                <Reveal as="div" variant="rise" retard={70} className="bg-white rounded-[20px] border shadow-soft p-5">
                  <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.stats.monthly")}</div>
                  <div className="mt-1 font-display font-extrabold text-ink text-[32px] tabular-nums">
                    {moy === null ? "—" : <CountUp a={Math.round(moy) * 100} final={formatEUR2(moy, locale)} duree={900} format={(n) => formatEUR2(n / 100, locale)} />}
                  </div>
                </Reveal>
                <Reveal as="div" variant="rise" retard={140} className="bg-white rounded-[20px] border shadow-soft p-5">
                  <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.stats.nextDue")}</div>
                  <div className="mt-1 font-display font-extrabold text-ink text-[26px] tabular-nums">
                    {echeance ? formatDate(echeance, locale) : "—"}
                  </div>
                  {echeance && <div className="text-[11px] text-slate-400">{tr("dashboard.projection")}</div>}
                </Reveal>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "md", "gap-2")}>
                  {tr("dashboard.quick.simulate")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                <button type="button" onClick={() => setOnglet("documents")} className={buttonClasses("outline-light", "md", "gap-2")}>
                  <FileText className="w-4 h-4" aria-hidden="true" /> {tr("dashboard.quick.documents")}
                </button>
                <button type="button" onClick={() => setOnglet("profil")} className={buttonClasses("outline-light", "md", "gap-2")}>
                  <UserRound className="w-4 h-4" aria-hidden="true" /> {tr("dashboard.quick.profile")}
                </button>
              </div>
            </>
          )}

          {onglet === "demandes" && (
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-extrabold text-ink text-lg">{tr("dashboard.applications.title")}</h2>
                <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "sm", "gap-2")}>
                  {tr("dashboard.applications.cta")}
                </Link>
              </div>
              <p className="mt-1 text-[12px] text-slate-400">{tr("dashboard.applications.hint")}</p>
              {demandes.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">{tr("dashboard.applications.empty")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {demandes.map((d) => {
                    const sim = sims.get(d.id)!;
                    const devis = ouverte === d.id;
                    return (
                      <li key={d.id} className="rounded-2xl border border-slate-100 bg-surface overflow-hidden">
                        <button type="button" onClick={() => setOuverte(devis ? null : d.id)} className="w-full flex flex-wrap items-center justify-between gap-3 p-4 text-left" aria-expanded={devis}>
                          <div>
                            <div className="font-bold text-ink tabular-nums">{d.id}</div>
                            <div className="text-[12px] text-slate-500 tabular-nums">
                              {tr(CLES_PRODUIT[d.etat.product])} · {formatCurrency0(d.etat.amount, locale)} · {formatEUR2(sim.simulation.monthlyPayment, locale)} {tr("credit:simulator.perMonth")} · {formatDate(d.createdAt, locale)}
                            </div>
                          </div>
                          <span className="flex items-center gap-3">
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase border bg-emerald-50 text-emerald-700 border-emerald-200">
                              {tr("credit:status.SUBMITTED")}
                            </span>
                            <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", devis && "rotate-180")} aria-hidden="true" />
                          </span>
                        </button>
                        {devis && (
                          <div className="px-4 pb-4 grid sm:grid-cols-4 gap-3 text-[12px]">
                            <div className="rounded-xl bg-white border p-3"><div className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">{tr("credit:simulator.taegIndicative")}</div><div className="font-extrabold text-ink mt-0.5 tabular-nums">{formatPercent(sim.simulation.taeg, locale, 2)}</div></div>
                            <div className="rounded-xl bg-white border p-3"><div className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">{tr("credit:simulator.total")}</div><div className="font-extrabold text-ink mt-0.5 tabular-nums">{formatCurrency0(sim.simulation.totalCost, locale)}</div></div>
                            <div className="rounded-xl bg-white border p-3"><div className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">{tr("credit:eligibility.debtRatio")}</div><div className="font-extrabold text-ink mt-0.5 tabular-nums">{Number.isFinite(sim.eligibility.debtRatio) ? formatPercent(sim.eligibility.debtRatio, locale, 1) : "∞"}</div></div>
                            <div className="rounded-xl bg-white border p-3"><div className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">{tr("credit:simulator.score")}</div><div className="font-extrabold text-ink mt-0.5 tabular-nums">{sim.score.value} · {sim.score.grade}</div></div>
                            <button type="button" onClick={() => { setChoisie(d.id); setOnglet("echeanciers"); }} className={buttonClasses("outline-light", "sm", "sm:col-span-4 gap-2")}>
                              <CalendarClock className="w-4 h-4" aria-hidden="true" /> {tr("nav.repayments")}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Reveal>
          )}

          {onglet === "echeanciers" && (
            <Reveal as="div" variant="fade" className="bg-ink text-white rounded-[24px] p-6 md:p-8 relative overflow-hidden shadow-card">
              <div className="maillage opacity-40" aria-hidden="true" />
              <div className="relative">
                <h2 className="font-extrabold text-lg">{tr("nav.repayments")}</h2>
                {!demandeCourante ? (
                  <p className="mt-3 text-sm text-white/60">{tr("dashboard.applications.empty")}</p>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {demandes.map((d) => (
                        <button
                          key={d.id} type="button" onClick={() => setChoisie(d.id)} aria-pressed={demandeCourante.id === d.id}
                          className={cn(
                            "h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wide border transition tabular-nums",
                            demandeCourante.id === d.id ? "bg-primary border-primary text-white" : "border-white/15 text-white/60 hover:text-white",
                          )}
                        >
                          {d.id.slice(-4)}
                        </button>
                      ))}
                    </div>
                    <div className="mt-5">
                      <CourbeAmortissement
                        points={pointsCourbe(sims.get(demandeCourante.id)!.simulation.schedule)}
                        formatY={(n) => formatCurrency0(n, locale)}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="rounded-2xl bg-white/5 border border-white/10 p-3"><div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{tr("credit:simulator.monthly")}</div><div className="font-extrabold mt-1 tabular-nums">{formatEUR2(sims.get(demandeCourante.id)!.simulation.monthlyPayment, locale)}</div></div>
                      <div className="rounded-2xl bg-white/5 border border-white/10 p-3"><div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{tr("credit:simulator.interests")}</div><div className="font-extrabold mt-1 tabular-nums">{formatCurrency0(sims.get(demandeCourante.id)!.simulation.totalInterest, locale)}</div></div>
                      <div className="rounded-2xl bg-white/5 border border-white/10 p-3"><div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{tr("credit:simulator.total")}</div><div className="font-extrabold mt-1 tabular-nums">{formatCurrency0(sims.get(demandeCourante.id)!.simulation.totalCost, locale)}</div></div>
                      <div className="rounded-2xl bg-white/5 border border-white/10 p-3"><div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{tr("credit:simulator.term")}</div><div className="font-extrabold mt-1 tabular-nums">{t(locale, "credit:simulator.months", { term: demandeCourante.etat.term })}</div></div>
                    </div>
                    <p className="mt-4 text-[11px] text-white/45">{tr("dashboard.projection")}</p>
                  </>
                )}
              </div>
            </Reveal>
          )}

          {onglet === "paiements" && (
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
              <h2 className="font-extrabold text-ink text-lg">{tr("payments.title")}</h2>
              <p className="mt-1 text-[12px] text-slate-400">{tr("payments.intro")}</p>
              {paiements.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">{tr("payments.empty")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {[...paiements].sort((a, b) => b.creeA.localeCompare(a.creeA)).map((p) => (
                    <li key={p.id} className="rounded-2xl border border-slate-100 bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={cn("w-10 h-10 rounded-xl grid place-items-center shrink-0",
                          p.type === "VIREMENT_ENTRANT" ? "bg-emerald-50 text-emerald-600" : p.type === "MENSUALITE" ? "bg-primary-light text-primary" : "bg-amber-50 text-amber-600")}>
                          {p.type === "VIREMENT_ENTRANT"
                            ? <ArrowDownLeft className="w-5 h-5" aria-hidden="true" />
                            : p.type === "MENSUALITE"
                              ? <CalendarClock className="w-5 h-5" aria-hidden="true" />
                              : <Receipt className="w-5 h-5" aria-hidden="true" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] font-extrabold text-ink">{tSiCle(locale, p.libelle)}</div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {tr(`payments.type.${p.type}`)} · {tr("payments.createdOn", { date: formatDate(p.creeA, locale) })}
                            {p.echeance ? ` · ${tr("payments.dueOn", { date: p.echeance })}` : ""}
                            {p.statut === "PAYE" && p.regleA ? ` · ${tr("payments.paidOn", { date: formatDate(p.regleA, locale) })}` : ""}
                          </div>
                        </div>
                        <div className="ml-auto text-right">
                          <div className={cn("font-extrabold tabular-nums", p.type === "VIREMENT_ENTRANT" ? "text-emerald-600" : "text-ink")}>
                            {p.type === "VIREMENT_ENTRANT" ? "+" : ""}{formatEUR2(p.montant, locale)}
                          </div>
                          <span className={cn("mt-1 inline-block text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                            p.statut === "PAYE" ? "bg-emerald-50 text-emerald-600" : p.statut === "DECLARE" ? "bg-primary-light text-primary" : "bg-amber-50 text-amber-600")}>
                            {tr(`payments.flow.${p.statut}`)}
                          </span>
                        </div>
                      </div>
                      {p.statut === "EN_ATTENTE" && (
                        <button type="button" onClick={() => void reglerPaiementClient(p.id)} className={buttonClasses("primary", "sm", "mt-3")}>
                          <Wallet className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("payments.payCta")}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {msgPaiement && <p role="status" className="mt-4 text-[13px] font-bold text-emerald-600">{tr("payments.payOk")}</p>}
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface border p-4 text-[13px] text-slate-500">
                <Wallet className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> {tr("payments.sepa.mandate")} — SEPA
              </div>
            </Reveal>
          )}

          {onglet === "documents" && (
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
              <h2 className="font-extrabold text-ink text-lg">{tr("documents.title")}</h2>
              {demandes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{tr("dashboard.applications.empty")}</p>
              ) : (
                demandes.map((d) => (
                  <div key={d.id} className="mt-5">
                    <div className="text-[11px] font-bold tracking-widest uppercase text-slate-400 tabular-nums">{d.id}</div>
                    <ul className="mt-2 grid md:grid-cols-2 gap-3">
                      {d.etat && sims.get(d.id)!.requiredDocuments.map((doc) => {
                        // Le serveur fait foi : une pièce APPROUVÉE porte la mention et sa date,
                        // une pièce SOUMISE est en vérification, sinon le client la téléverse.
                        const piece = docsServeur.find((x) => x.demandeId === d.id && x.code === doc.code);
                        return (
                          <li key={doc.code} className="rounded-2xl border border-slate-100 bg-surface p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold text-ink">{tr(CLES_DOC[doc.code as (typeof DOCUMENT_CODES)[number]])}</div>
                              <div className={cn("mt-0.5 text-[11px] font-bold tracking-widest uppercase",
                                piece?.statut === "APPROUVE" ? "text-emerald-600" : piece ? "text-amber-600" : "text-red-500")}>
                                {piece?.statut === "APPROUVE"
                                  ? tr("documents.status.APPROVED")
                                  : piece ? tr("documents.status.PENDING") : tr("documents.status.MISSING")}
                              </div>
                              {piece?.statut === "APPROUVE" && piece.approuveA && (
                                <div className="mt-0.5 text-[11px] text-slate-400">
                                  {tr("documents.approvedBy", { nom: piece.approuvePar ?? "", date: formatDate(piece.approuveA, locale) })}
                                </div>
                              )}
                              {piece?.statut === "SOUMIS" && (
                                <div className="mt-0.5 text-[11px] text-slate-400">{piece.nom} · {tr("documents.submittedNote")}</div>
                              )}
                            </div>
                            {(!piece || piece.statut === "SOUMIS") && (
                              <label className={buttonClasses("outline-light", "sm", "cursor-pointer shrink-0")}>
                                {tr("documents.upload.cta")}
                                <input
                                  type="file" className="sr-only"
                                  onChange={(e) => televerserDoc(d.id, doc.code, e.target.files?.[0] ?? null)}
                                />
                              </label>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
              {erreurDepot && <p role="alert" className="mt-4 text-[13px] font-bold text-red-600">{tr(erreurDepot)}</p>}
            </Reveal>
          )}

          {onglet === "notifications" && (
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
              {/* Messages de l'administration (ex. document approuvé) — le serveur les pose. */}
              <h2 className="font-extrabold text-ink text-lg flex items-center gap-2">
                <BellRing className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("documents.notifyTitle")}
              </h2>
              {notifs.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{tr("documents.notifyEmpty")}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {[...notifs].sort((a, b) => b.creeA.localeCompare(a.creeA)).map((n) => {
                    const varsResolues: Record<string, string> = {};
                    for (const [k, v] of Object.entries(n.vars ?? {})) varsResolues[k] = tSiCle(locale, v);
                    return (
                      <li key={n.id} className="rounded-2xl border border-slate-100 bg-surface p-4 flex items-start gap-3">
                        <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">{tr(n.cle, varsResolues)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(n.creeA, locale)}</div>
                          {/* Distribution honnête : le site toujours servi ; e-mail / WhatsApp
                              selon l'envoi RÉEL (envoyé, échec, non configuré, désactivé). */}
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <BadgeCanal libelle={tr("notifications.canal.site")} statut="envoye" tr={tr} />
                            <BadgeCanal libelle={tr("notifications.channel.email")} statut={n.canaux?.email ?? "non_configure"} tr={tr} />
                            <BadgeCanal libelle={tr("notifications.channel.whatsapp")} statut={n.canaux?.whatsapp ?? "non_configure"} tr={tr} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* ——— Distribution réelle : e-mail (Resend) + WhatsApp (API Cloud Meta) ——— */}
              {session.role === "CUSTOMER" && prefsReelles && (
                <div className="mt-6 rounded-2xl border p-5">
                  <h3 className="font-extrabold text-ink text-base flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" aria-hidden="true" /> {tr("notifications.real.title")}
                  </h3>
                  <ul className="mt-3 space-y-3">
                    <li className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-bold text-ink">{tr("notifications.real.email", { email: session.email })}</span>
                      <button
                        type="button" role="switch" aria-checked={prefsReelles.email} aria-label={tr("notifications.channel.email")}
                        onClick={() => void changerPrefReelle("email", !prefsReelles.email)}
                        className={cn("w-12 h-7 rounded-full transition relative shrink-0", prefsReelles.email ? "bg-primary" : "bg-slate-200")}
                      >
                        <span className={cn("absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all", prefsReelles.email ? "left-6" : "left-1")} />
                      </button>
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-bold text-ink">
                        <MessageCircle className="w-4 h-4 inline mr-1.5 -mt-0.5 text-primary" aria-hidden="true" />
                        {prefsReelles.numeroWhatsapp
                          ? tr("notifications.real.whatsapp", { numero: prefsReelles.numeroWhatsapp })
                          : tr("notifications.real.whatsappSansNumero")}
                      </span>
                      <button
                        type="button" role="switch" aria-checked={prefsReelles.whatsapp} aria-label={tr("notifications.channel.whatsapp")}
                        onClick={() => void changerPrefReelle("whatsapp", !prefsReelles.whatsapp)}
                        className={cn("w-12 h-7 rounded-full transition relative shrink-0", prefsReelles.whatsapp ? "bg-primary" : "bg-slate-200")}
                      >
                        <span className={cn("absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all", prefsReelles.whatsapp ? "left-6" : "left-1")} />
                      </button>
                    </li>
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void envoyerNotifTest()} className={buttonClasses("outline-light", "sm")}>
                      <BellRing className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("notifications.testCta")}</span>
                    </button>
                    {msgPrefsReelles && <p role="status" className="text-[12px] font-bold text-emerald-600">{tr("notifications.real.saved")}</p>}
                  </div>
                  <p className="mt-3 text-[11px] leading-4 text-slate-400">{tr("notifications.real.note")}</p>
                </div>
              )}

              <h2 className="mt-6 font-extrabold text-ink text-lg">{tr("notifications.preferences.title")}</h2>
              <ul className="mt-4 space-y-3">
                {([
                  ["sms", Smartphone, "notifications.channel.sms"],
                  ["push", BellRing, "notifications.channel.push"],
                ] as Array<[keyof PrefsNotif, typeof Mail, string]>).map(([k, Ic, cle]) => (
                  <li key={k} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-surface p-4">
                    <span className="flex items-center gap-3 text-sm font-bold text-ink"><Ic className="w-4 h-4 text-primary" aria-hidden="true" /> {tr(cle)}</span>
                    <button
                      type="button" role="switch" aria-checked={prefs[k]} aria-label={tr(cle)}
                      onClick={() => regle(k)}
                      className={cn("w-12 h-7 rounded-full transition relative", prefs[k] ? "bg-primary" : "bg-slate-200")}
                    >
                      <span className={cn("absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all", prefs[k] ? "left-6" : "left-1")} />
                    </button>
                  </li>
                ))}
              </ul>
              <label className="mt-4 flex items-start gap-3 text-[13px] leading-5 text-slate-600 cursor-pointer">
                <input
                  type="checkbox" checked={prefs.whatsappConsent}
                  onChange={() => { const p = { ...prefs, whatsappConsent: !prefs.whatsappConsent }; if (!p.whatsappConsent) p.whatsapp = false; setPrefs(p); enregistrerPrefs(p); }}
                  className="mt-0.5 w-4 h-4 accent-primary"
                />
                <span>{tr("notifications.preferences.whatsappConsent")}</span>
              </label>
            </Reveal>
          )}

          {onglet === "banque" && session.role === "CUSTOMER" && <BankPortal locale={locale} session={session} />}

          {onglet === "operations" && session.role !== "CUSTOMER" && <OpsPortal locale={locale} session={session} />}

          {onglet === "grille" && session.role === "SUPER_ADMIN" && <GrilleHistorique locale={locale} />}

          {onglet === "profil" && (
            <div className="grid lg:grid-cols-2 gap-6 items-start">
              {/* ——— Colonne gauche : identité + photo + infos personnelles ——— */}
              <div className="space-y-6">
                <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
                  <h2 className="font-extrabold text-ink text-lg">{tr("banque:profile.title")}</h2>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    {banqueProfil?.photo
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={banqueProfil.photo} alt={session.nom} className="w-20 h-20 rounded-2xl object-cover border" />
                      : <span className="w-20 h-20 rounded-2xl bg-primary-light text-primary grid place-items-center"><Camera className="w-9 h-9" aria-hidden="true" /></span>}
                    <div className="min-w-0">
                      <div className="font-extrabold text-ink text-lg leading-tight">{session.nom}</div>
                      <div className="text-[12px] text-slate-400">{tr("banque:profile.email")} : {session.email}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{tr("banque:profile.memberSince", { date: formatDate(creeAServeur ?? session.ouverteA, locale) })}</div>
                      {session.role === "CUSTOMER" && (
                        <span className={cn("mt-2 inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full", banqueProfil?.verifie ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                          {banqueProfil?.verifie ? <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                          {tr(banqueProfil?.verifie ? "banque:verified" : "banque:unverified")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className={buttonClasses("outline-light", "sm", "cursor-pointer")}>
                      {tr(banqueProfil?.photo ? "banque:photoChange" : "banque:photoAdd")}
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => choisirPhoto(e.target.files?.[0] ?? null)} />
                    </label>
                    {banqueProfil?.photo && (
                      <button type="button" onClick={retirerPhoto} className={buttonClasses("outline-light", "sm")}>{tr("banque:photoRemove")}</button>
                    )}
                    {erreurPhoto && <p role="alert" className="text-[11px] font-bold text-red-600">{tr("banque:photoTooBig")}</p>}
                  </div>
                  {banqueProfil && (
                    <div className="mt-4 rounded-2xl bg-ink text-white p-4">
                      <div className="text-[10px] font-bold tracking-widest uppercase text-white/40">{tr("banque:iban")} — {tr("banque:ibanNote")}</div>
                      <div className="mt-1 font-mono text-[15px] tracking-wider">{banqueProfil.iban}</div>
                    </div>
                  )}
                </Reveal>

                <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
                  <h3 className="font-extrabold text-ink text-base">{tr("banque:profile.personal")}</h3>
                  {profilServeur ? (
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      {([
                        ["auth.lastName", profilServeur.nom || "—"],
                        ["auth.firstName", profilServeur.prenom || "—"],
                        ["auth.birthDate", profilServeur.naissance ? formatDate(profilServeur.naissance, locale) : "—"],
                        ["auth.nationality", profilServeur.nationalite || "—"],
                        ["auth.maritalLabel", CLES_MARITAL_PROFIL.includes(profilServeur.marital) ? tr(`auth.marital.${profilServeur.marital}`) : "—"],
                      ] as Array<[string, string]>).map(([cle, val]) => (
                        <div key={cle}>
                          <dt className="text-[10px] font-bold tracking-widest uppercase text-slate-400">{tr(cle)}</dt>
                          <dd className="font-bold text-ink mt-0.5">{val}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">{tr("banque:profile.none")}</p>
                  )}
                </Reveal>
              </div>

              {/* ——— Colonne droite : contact éditable, prêt, sécurité ——— */}
              <div className="space-y-6">
                <Reveal as="div" variant="left" retard={80} className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
                  <h3 className="font-extrabold text-ink text-base">{tr("banque:profile.contact")}</h3>
                  {formContact ? (
                    <div className="mt-4 space-y-3">
                      {champContact("rue", "auth.street")}
                      <div className="grid grid-cols-2 gap-3">
                        {champContact("numero", "auth.houseNumber")}
                        {champContact("boite", "auth.box")}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {champContact("codePostal", "auth.postalCode")}
                        {champContact("ville", "auth.city")}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {champContact("pays", "auth.country")}
                        {champContact("telephone", "auth.phoneMobile")}
                      </div>
                      {msgProfil === "ok" && <p role="status" className="text-[12px] font-bold text-emerald-600">{tr("banque:profile.saved")}</p>}
                      {msgProfil === "err" && <p role="alert" className="text-[12px] font-bold text-red-600">{tr("banque:profile.saveErr")}</p>}
                      <button type="button" onClick={() => void enregistrerProfil()} className={buttonClasses("primary", "md", "w-full")}>
                        {tr("banque:profile.save")}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">{tr("banque:profile.none")}</p>
                  )}
                </Reveal>

                <Reveal as="div" variant="left" retard={120} className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
                  <h3 className="font-extrabold text-ink text-base">{tr("banque:profile.loans")}</h3>
                  {profilServeur ? (
                    <>
                      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {([
                          ["auth.employer", profilServeur.employeur || "—"],
                          ["auth.jobTitle", profilServeur.profession || "—"],
                          ["auth.seniority", profilServeur.anciennete || "—"],
                          ["auth.companyName", profilServeur.entreprise || "—"],
                          ["auth.vatNumber", profilServeur.tva || "—"],
                          ["auth.sector", profilServeur.secteur || "—"],
                          ["auth.monthlyIncomeNet", profilServeur.revenusNets ? `${profilServeur.revenusNets} €` : "—"],
                          ["auth.housingLabel", CLES_LOGEMENT_PROFIL.includes(profilServeur.logement) ? tr(`auth.housing.${profilServeur.logement}`) : "—"],
                          ["auth.housingCost", profilServeur.chargeLogement ? `${profilServeur.chargeLogement} €` : "—"],
                          ["auth.existingDebts", profilServeur.creditsExistants || "—"],
                        ] as Array<[string, string]>).map(([cle, val]) => (
                          <div key={cle}>
                            <dt className="text-[10px] font-bold tracking-widest uppercase text-slate-400">{tr(cle)}</dt>
                            <dd className="font-bold text-ink mt-0.5">{val}</dd>
                          </div>
                        ))}
                      </dl>
                      <button type="button" onClick={() => setOnglet("demandes")} className={buttonClasses("outline-light", "sm", "mt-4")}>
                        {tr("banque:profile.seeApplications")}
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">{tr("banque:profile.none")}</p>
                  )}
                </Reveal>

                <Reveal as="div" variant="left" retard={160} className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
                  <h2 className="font-extrabold text-ink text-lg flex items-center gap-2">
                    <Lock className="w-4 h-4 text-primary" aria-hidden="true" /> {tr("dashboard.tab.security")}
                  </h2>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="mdp-actuel" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.currentPassword")}</label>
                      <input id="mdp-actuel" type="password" value={mdpActuel} onChange={(e) => setMdpActuel(e.target.value)} className="mt-2 w-full h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold text-ink focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label htmlFor="mdp-neuf" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.newPassword")}</label>
                      <input id="mdp-neuf" type="password" value={mdpNeuf} onChange={(e) => setMdpNeuf(e.target.value)} className="mt-2 w-full h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold text-ink focus:outline-none focus:border-primary" />
                    </div>
                    {msgMdp === "ok" && <p role="status" className="text-[12px] font-semibold text-emerald-600">{tr("dashboard.passwordUpdated")}</p>}
                    {msgMdp === "err" && <p role="alert" className="text-[12px] font-semibold text-red-600">{tr("dashboard.errCurrent")}</p>}
                    <button type="button" onClick={() => void changerMdp()} className={buttonClasses("primary", "md", "w-full")}>
                      {tr("dashboard.changePassword")}
                    </button>
                    <p className="text-[11px] text-slate-400">{tr("account.demoBanner")}</p>
                  </div>
                </Reveal>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
