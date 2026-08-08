// ---------------------------------------------------------------------------
// CE QUI OCCUPE L'AGENDA, ET CE QUI NE L'OCCUPE PLUS
//
// Quand un client annule depuis /annuler, la ligne n'est PAS supprimee : elle
// recoit une date dans `annuleLe`. Deux raisons, et la seconde compte autant
// que la premiere :
//
//   1. On peut alors repondre « ce rendez-vous a deja ete annule » plutot que
//      « introuvable ». Un client qui clique deux fois sur le lien de son
//      courriel merite mieux qu'un message qui laisse croire a une panne.
//   2. LE COMMERCANT DOIT LE VOIR. Un creneau s'est libere sans qu'il y soit
//      pour rien ; c'est une information qu'il utilise (rappeler quelqu'un sur
//      liste d'attente, reperer les annulations a repetition). Une ligne
//      effacee ne la lui donnerait jamais.
//
// Le commercant, lui, continue de SUPPRIMER pour de bon depuis son agenda :
// quand c'est lui qui retire une ligne, il n'a personne a prevenir, et une
// erreur de saisie n'a pas a laisser de trace.
//
// ⚠️ LE PIEGE. Une ligne annulee est encore en base, et toute requete qui sert
//    a calculer une disponibilite la verrait donc encore occuper son creneau —
//    lequel deviendrait invendable pour toujours. Ce fichier existe pour qu'il
//    n'y ait qu'UN seul endroit ou l'ecrire, et qu'un `where` copie ailleurs se
//    remarque.
// ---------------------------------------------------------------------------

/**
 * Le filtre a poser sur toute requete qui sert a calculer une disponibilite.
 *
 * A etaler dans le `where` :
 *
 *     prisma.booking.findMany({ where: { date, ...OCCUPENT } })
 *
 * `null` et non `undefined` : `annuleLe: undefined` serait silencieusement
 * ignore par Prisma, et la requete ramenerait les annules sans rien signaler.
 */
export const OCCUPENT = { annuleLe: null };

/** Le meme filtre, pour une liste deja chargee. */
export function occupent(reservations) {
  return reservations.filter((r) => !r.annuleLe);
}
