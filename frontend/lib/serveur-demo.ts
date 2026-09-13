/**
 * Comptes du personnel pour la démo (semés côté serveur par lib/serveur.ts à la première
 * ouverture du magasin). Module isomorphe SANS import Node : le client en a besoin pour les
 * boutons « Admin » / « Super Admin », et lib/serveur.ts (scrypt, fs) ne doit jamais entrer dans
 * le bundle navigateur. Ce sont des identifiants de démonstration, affichés comme tels dans l'UI.
 */
export type RoleServeur = "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

export const COMPTES_PORTE_DEMO: ReadonlyArray<{ email: string; role: RoleServeur; nom: string; motDePasse: string }> = [
  { email: "client@kredit.be", role: "CUSTOMER", nom: "Client KREDIT", motDePasse: "client-demo-2026" },
  { email: "admin@kredit.be", role: "ADMIN", nom: "Admin KREDIT", motDePasse: "admin-demo-2026" },
  { email: "super@kredit.be", role: "SUPER_ADMIN", nom: "Super Admin KREDIT", motDePasse: "super-demo-2026" },
];
