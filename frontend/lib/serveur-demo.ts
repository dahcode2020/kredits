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
  debloquerParCode, denouer, evolutionVirement, initierVirement, ouvrirBanqueClient,
  referentielEffectif, type BanqueCompte, type MessageChat, type Transaction,
} from "@/lib/banque";

/**
 * Compte client « vitrine » de la démo : vérifié (le virement sortant est donc possible), avec un
 * salaire fictif, un virement EXÉCUTÉ (barre allée à 100 % après deux déblocages), un virement
 * ARRÊTÉ à 30 % (code DEMO30) et un virement ARRÊTÉ à 60 % (code DEMO60) — chaque état du
 * pipeline est illustré, codes jouables côté client ou lisibles côté administration. Construit en
 * appliquant la machine à états pure : soldes et réserves restent cohérents. Les motifs et le chat
 * portent des CLÉS i18n (résolues par `tSiCle` à l'affichage), jamais de français codé ici.
 */
export function banqueDemoIllustrative(): { compte: BanqueCompte; chat: MessageChat[] } {
  const ref = referentielEffectif();
  let compte = ouvrirBanqueClient("client@kredit.be", "CUSTOMER", "2026-09-01T08:30:00.000Z");
  const salaire: Transaction = {
    id: "TX-DEMO-SALAIRE", sens: "entrant", montant: 1_850, date: "2026-09-05T06:00:00.000Z",
    contrepartie: "ACME SA", motifCle: "banque.tx.demoSalary",
  };
  compte = { ...compte, verifie: true, transactions: [...compte.transactions, salaire] };

  // 1) Virement exécuté : la barre évolue, s'arrête à 30 % puis 60 %, débloquée par codes, 100 %.
  compte = initierVirement(compte, "Régie des Ardennes", "BE68539007547034", 450, "banque.vir.demoMotifRent", "2026-09-06T09:00:00.000Z", { adresse: "Avenue Louise 12, 1050 Ixelles", bic: "GEBABEBB" }).compte;
  const id1 = compte.virements[0].id;
  compte = evolutionVirement(compte, id1, ref, "KRD30A", "2026-09-06T09:00:00.000Z");
  compte = debloquerParCode(compte, id1, "KRD30A", "2026-09-07T08:00:00.000Z").compte;
  compte = evolutionVirement(compte, id1, ref, "KRD60A", "2026-09-07T08:00:00.000Z");
  compte = debloquerParCode(compte, id1, "KRD60A", "2026-09-08T09:00:00.000Z").compte;
  compte = evolutionVirement(compte, id1, ref, "KRDFINA", "2026-09-08T09:00:00.000Z");
  compte = denouer(compte, id1, "2026-09-08T10:00:00.000Z");

  // 2) Virement arrêté à 30 % (justificatif de domicile) : code DEMO30, jouable en démo.
  compte = initierVirement(compte, "Énergie Bruxelles", "BE68539007547034", 300, "banque.vir.demoMotifEnergy", "2026-09-12T11:00:00.000Z", { adresse: "Boulevard de l'Impératrice 5, 1000 Bruxelles", bic: "BRUBBEBB" }).compte;
  const id2 = compte.virements[1].id;
  compte = evolutionVirement(compte, id2, ref, "DEMO30", "2026-09-12T11:00:00.000Z");

  // 3) Virement arrêté à 60 % (certificat d'assurance) : code DEMO60, jouable en démo.
  compte = initierVirement(compte, "Assurances Fanchon", "BE68539007547034", 750, "banque.vir.demoMotifInsurance", "2026-09-13T14:00:00.000Z", { adresse: "Place Saint-Lambert 8, 4000 Liège", bic: "BBRUBEBB" }).compte;
  const id3 = compte.virements[2].id;
  compte = evolutionVirement(compte, id3, ref, "TMP30B", "2026-09-13T14:00:00.000Z");
  compte = debloquerParCode(compte, id3, "TMP30B", "2026-09-13T15:00:00.000Z").compte;
  compte = evolutionVirement(compte, id3, ref, "DEMO60", "2026-09-13T16:00:00.000Z");

  const chat: MessageChat[] = [
    { id: "MSG-DEMO-1", de: "support", auteur: "Support KREDIT", texte: "banque.chat.demoWelcome", ts: "2026-09-05T09:10:00.000Z" },
    { id: "MSG-DEMO-2", de: "client", auteur: "Client KREDIT", texte: "banque.chat.demoQuestion", ts: "2026-09-13T16:20:00.000Z" },
    { id: "MSG-DEMO-3", de: "support", auteur: "Support KREDIT", texte: "banque.chat.demoAnswer", ts: "2026-09-13T17:05:00.000Z" },
    { id: "MSG-DEMO-4", de: "support", auteur: "Support KREDIT", texte: "banque.chat.demoCode", ts: "2026-09-13T17:40:00.000Z" },
  ];
  return { compte, chat };
}
