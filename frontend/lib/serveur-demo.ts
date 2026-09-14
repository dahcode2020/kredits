/**
 * Comptes du personnel pour la démo (semés côté serveur par lib/serveur.ts à la première
 * ouverture du magasin). Module isomorphe SANS import Node : le client en a besoin pour les
 * boutons « Admin » / « Super Admin », et lib/serveur.ts (scrypt, fs) ne doit jamais entrer dans
 * le bundle navigateur. Ce sont des identifiants de démonstration, affichés comme tels dans l'UI.
 */
export type RoleServeur = "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

export const COMPTES_PORTE_DEMO: ReadonlyArray<{ email: string; role: RoleServeur; nom: string; motDePasse: string; profil?: Record<string, string> }> = [
  {
    email: "client@kredit.be", role: "CUSTOMER", nom: "Client KREDIT", motDePasse: "client-demo-2026",
    // Profil de démonstration (affiché tel quel dans l'onglet Profil — données fictives).
    profil: {
      nom: "KREDIT", prenom: "Client", naissance: "1988-06-15", nationalite: "Belgique", marital: "married",
      rue: "Rue des Bruyères", numero: "42", boite: "b3", codePostal: "1050", ville: "Ixelles",
      pays: "Belgique", telephone: "+32 470 12 34 56", employeur: "ACME SA",
      profession: "Gestionnaire de projets", anciennete: "6", entreprise: "ACME SA",
      tva: "BE 0123.456.789", secteur: "Services", revenusNets: "2800", logement: "tenant",
      chargeLogement: "950", iban: "", creditsExistants: "0",
    },
  },
  { email: "admin@kredit.be", role: "ADMIN", nom: "Admin KREDIT", motDePasse: "admin-demo-2026" },
  { email: "super@kredit.be", role: "SUPER_ADMIN", nom: "Super Admin KREDIT", motDePasse: "super-demo-2026" },
];

import {
  bloquerVirement, confirmerNiveau, denouer, initierVirement, ouvrirBanqueClient,
  referentielEffectif, type BanqueCompte, type MessageChat, type Transaction,
} from "@/lib/banque";

/**
 * Compte client « vitrine » de la démo : vérifié (le virement sortant est donc possible), avec un
 * salaire fictif, un virement EXÉCUTÉ, un virement EN COURS (niveau 2/4) et un virement BLOQUÉ
 * pour défaut du référentiel — chaque état du pipeline est illustré. Construit en appliquant la
 * machine à états pure : soldes et réserves restent cohérents. Les motifs et le chat portent des
 * CLÉS i18n (résolues par `tSiCle` à l'affichage), jamais de français codé ici.
 */
export function banqueDemoIllustrative(): { compte: BanqueCompte; chat: MessageChat[] } {
  const ref = referentielEffectif();
  let compte = ouvrirBanqueClient("client@kredit.be", "CUSTOMER", "2026-09-01T08:30:00.000Z");
  const salaire: Transaction = {
    id: "TX-DEMO-SALAIRE", sens: "entrant", montant: 1_850, date: "2026-09-05T06:00:00.000Z",
    contrepartie: "ACME SA", motifCle: "banque.tx.demoSalary",
  };
  compte = { ...compte, verifie: true, transactions: [...compte.transactions, salaire] };

  // 1) Virement exécuté : 4 niveaux confirmés puis dénouement (le solde est débité).
  compte = initierVirement(compte, "Régie des Ardennes", "BE68539007547034", 450, "banque.vir.demoMotifRent", "2026-09-06T09:00:00.000Z").compte;
  const id1 = compte.virements[0].id;
  for (let i = 0; i < ref.pipeline.length; i += 1) compte = confirmerNiveau(compte, id1, ref);
  compte = denouer(compte, id1, "2026-09-08T10:00:00.000Z");

  // 2) Virement en cours, niveau 2/4 (barre de progression à 30 %).
  compte = initierVirement(compte, "Énergie Bruxelles", "BE68539007547034", 300, "banque.vir.demoMotifEnergy", "2026-09-12T11:00:00.000Z").compte;
  const id2 = compte.virements[1].id;
  compte = confirmerNiveau(compte, id2, ref);
  compte = confirmerNiveau(compte, id2, ref);

  // 3) Virement bloqué au niveau atteint pour défaut CERT_ASSURANCE (coût en réserve).
  compte = initierVirement(compte, "Assurances Fanchon", "BE68539007547034", 750, "banque.vir.demoMotifInsurance", "2026-09-13T14:00:00.000Z").compte;
  const id3 = compte.virements[2].id;
  compte = confirmerNiveau(compte, id3, ref);
  compte = bloquerVirement(compte, id3, "CERT_ASSURANCE", ref, "2026-09-13T16:00:00.000Z");

  const chat: MessageChat[] = [
    { id: "MSG-DEMO-1", de: "support", auteur: "Support KREDIT", texte: "banque.chat.demoWelcome", ts: "2026-09-05T09:10:00.000Z" },
    { id: "MSG-DEMO-2", de: "client", auteur: "Client KREDIT", texte: "banque.chat.demoQuestion", ts: "2026-09-13T16:20:00.000Z" },
    { id: "MSG-DEMO-3", de: "support", auteur: "Support KREDIT", texte: "banque.chat.demoAnswer", ts: "2026-09-13T17:05:00.000Z" },
  ];
  return { compte, chat };
}
