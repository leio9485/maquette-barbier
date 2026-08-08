// ---------------------------------------------------------------------------
// LA REFERENCE D'UN RENDEZ-VOUS
//
// Six caracteres, « MQJYBK », remis au client a la fin de sa reservation. C'est
// ce qu'il note, ce qu'il retrouve dans son courriel, et ce qu'il ressaisit sur
// /annuler.
//
// ELLE ETAIT AUTREFOIS UN MORCEAU DU JETON D'ANNULATION, et ne pouvait pas le
// rester. Le site en prenait les six premiers caracteres alphanumeriques et les
// mettait en capitales — or cette capitalisation perd de l'information :
// « FVLJ8U » peut provenir de fVLj8U, FvLJ8u, fvlj8u… soit trente-deux jetons
// distincts. Aucune requete ne pouvait donc partir de la reference, et la
// phrase affichee au client (« notez la reference : elle suffit a annuler »)
// n'etait tenable par aucun code.
//
// Elle est desormais tiree ici, ecrite en base dans sa propre colonne indexee,
// et le jeton reste ce qu'il a toujours ete : le secret du lien direct.
// ---------------------------------------------------------------------------

import { randomInt } from 'node:crypto';

/**
 * L'alphabet de Douglas Crockford, celui de son encodage en base 32.
 *
 * Il ecarte I, L, O et U. Les trois premiers parce qu'ils se confondent avec 1,
 * 1 et 0 — et cette reference se DICTE : un client la lit au telephone a
 * quelqu'un qui la tape. Le U parce qu'il permet de former des mots
 * malencontreux ; ce n'est pas une plaisanterie de sa part, un tirage sur
 * quelques milliers finit par produire ce qu'il faut eviter d'afficher.
 *
 * Trente-deux caracteres, six positions : 32^6, soit exactement 30 bits. C'est
 * autant que ce que produisait l'ancienne derivation (30,7 bits, non uniformes),
 * avec en plus une regle de lecture claire.
 *
 * ⚠️ NE PAS Y AJOUTER DE CARACTERE : les six positions valent 30 bits parce que
 *    l'alphabet en compte trente-deux. Et ne pas en retirer non plus sans
 *    reprendre `normaliser()`, dont la table de correspondance en depend.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Longueur de la reference. Six : assez court pour se dicter, assez long pour 30 bits. */
export const LONGUEUR_REFERENCE = 6;

/**
 * Ce qu'un humain tape a la place de ce qu'il a lu.
 *
 * Le pendant de l'alphabet ci-dessus : puisque I, L et O n'y figurent JAMAIS,
 * quelqu'un qui les saisit s'est trompe de jumeau, et on sait lequel il visait.
 * C'est la regle de decodage de Crockford, reprise telle quelle.
 */
const JUMEAUX = { I: '1', L: '1', O: '0' };

/**
 * Une reference tiree au hasard.
 *
 * `randomInt` plutot qu'un `Math.random()` : le premier est le generateur
 * cryptographique du systeme, et il tire dans l'intervalle demande SANS BIAIS —
 * un `% 32` sur des octets bruts favoriserait les premiers caracteres de
 * l'alphabet. Ici l'alphabet fait justement trente-deux caracteres, donc le
 * biais serait nul, mais la regle ne doit pas dependre d'une coincidence : en
 * retirer un seul la reintroduirait sans que rien ne le signale.
 */
export function tirerReference() {
  let sortie = '';
  for (let i = 0; i < LONGUEUR_REFERENCE; i++) sortie += ALPHABET[randomInt(ALPHABET.length)];
  return sortie;
}

/**
 * Ce qu'a saisi un client, ramene a la forme ecrite en base.
 *
 * Tolerant sur la forme, strict sur le fond : on accepte les minuscules, les
 * espaces, les tirets (« mqj-ybk »), et les trois confusions de lecture. On
 * refuse tout le reste — et notamment une longueur differente de six, plutot
 * que de chercher a deviner.
 *
 * Renvoie `null` quand la saisie ne peut pas etre une reference. L'appelant en
 * fait le meme refus que pour une reference inconnue : dire « ce n'est pas le
 * bon format » apprendrait a un curieux quelles formes sont valides.
 */
export function normaliserReference(saisie) {
  if (typeof saisie !== 'string') return null;

  let propre = '';
  for (const caractere of saisie.toUpperCase()) {
    const corrige = JUMEAUX[caractere] ?? caractere;
    if (ALPHABET.includes(corrige)) propre += corrige;
  }

  return propre.length === LONGUEUR_REFERENCE ? propre : null;
}

/**
 * Une reference qui n'est prise par personne.
 *
 * Une collision sur 30 bits est rare — pour un barbier a trois mille
 * rendez-vous par an gardes douze mois, la probabilite qu'il en existe une est
 * de l'ordre de 10^-5 — mais « rare » n'est pas « impossible », et la colonne
 * est `@unique` : sans ce controle, la reservation echouerait sur une erreur
 * d'ecriture incomprehensible, une fois tous les quelques annees.
 *
 * `client` est passe par l'appelant pour que la verification puisse se faire
 * DANS la transaction d'enregistrement, avec le meme client que l'ecriture.
 *
 * Au-dela de quelques essais, on renonce : a ce stade ce n'est plus une
 * collision, c'est une base en panne, et boucler ne ferait que le cacher.
 */
export async function referenceLibre(client, essais = 5) {
  for (let i = 0; i < essais; i++) {
    const candidate = tirerReference();
    const prise = await client.booking.findUnique({
      where: { reference: candidate },
      select: { id: true },
    });
    if (!prise) return candidate;
  }
  throw new Error('Aucune reference libre trouvee apres plusieurs tirages.');
}
