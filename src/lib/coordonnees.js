// ---------------------------------------------------------------------------
// LES COORDONNEES D'UN CLIENT — nom, telephone, courriel
//
// >>> TROIS SAISIES PASSAIENT, ET AUCUNE N'AURAIT DU. <<< Verifie en direct
// sur POST /api/bookings avant ce fichier :
//
//     telephone « abc »            -> 201, enregistre tel quel
//     courriel  « pasunemail »     -> 201, enregistre tel quel
//     nom de 5 000 caracteres      -> 201, coupe en silence a 120
//
// Le navigateur n'en verifiait pas davantage : deux controles de presence, et
// c'est tout. `<input type="tel">` NE VALIDE RIEN — c'est un clavier, pas une
// regle — et `<input type="email">` n'est verifie que par la soumission
// classique d'un formulaire, que ce site n'emploie pas (il envoie du JSON).
//
// CE QUE CA COUTE, CONCRETEMENT. Le telephone est le SEUL moyen de joindre un
// client : le commercant qui doit decaler sa journee appelle, et un numero qui
// n'en est pas est un rendez-vous perdu des deux cotes. Ce meme numero est
// aussi le second facteur de /annuler (« les quatre derniers chiffres ») : un
// numero fantaisiste rend le rendez-vous inannulable par son proprietaire.
//
// >>> LE CONTROLE EST ICI, C'EST-A-DIRE SUR LE SERVEUR. <<< Le navigateur en
// porte un miroir (js/07-tunnel.js) pour eviter un aller-retour et dire ou est
// le probleme, mais il ne fait pas foi : une requete peut arriver sans lui.
//
// ⚠️ CE FICHIER ET SON MIROIR DE PAGE DOIVENT DIRE LA MEME CHOSE. Meme regle
//    que pour le catalogue et les avis : si vous changez une regle ici,
//    changez-la dans js/07-tunnel.js. Un test verifie que les memes saisies
//    obtiennent le meme verdict des deux cotes.
// ---------------------------------------------------------------------------

/**
 * La longueur maximale d'un nom.
 *
 * Quatre-vingts, et c'est deja large : « Jean-Christophe Vandenbergh » en fait
 * vingt-sept. La valeur est la meme que le `maxlength` du champ de saisie —
 * les deux doivent bouger ensemble, sans quoi le navigateur laisse taper ce que
 * le serveur refusera.
 *
 * ⚠️ REFUSER, ET NON COUPER. Le serveur coupait a 120 caracteres sans rien
 *    dire. Un nom coupe est pire qu'un nom refuse : le client croit avoir
 *    reserve sous son nom, et le commercant appelle « Jean-Christophe
 *    Vandenb ». Un refus se corrige en trois secondes.
 */
export const NOM_MAX = 80;

/** Un courriel plus long que ca n'existe pas dans la vraie vie. */
export const COURRIEL_MAX = 160;

/**
 * Le nom sous lequel on reservera.
 *
 * Aucune regle sur le CONTENU : ni « au moins deux mots », ni « des lettres
 * seulement ». Un prenom seul est parfaitement valable au telephone comme au
 * fauteuil, et toute regle de forme sur un nom finit par refuser celui de
 * quelqu'un.
 */
export function validerNom(brut) {
  const propre = typeof brut === 'string' ? brut.trim() : '';

  if (!propre) return { erreur: 'Le nom est obligatoire.' };
  if (propre.length > NOM_MAX) {
    return { erreur: `Ce nom dépasse ${NOM_MAX} caractères. Le prénom suffit.` };
  }

  return { valeur: propre };
}

/**
 * Le numero de telephone, ramene a une seule ecriture.
 *
 * TROIS FORMES ENTRENT, UNE SEULE SORT :
 *
 *     « 0612345678 »          ┐
 *     « 06 12 34 56 78 »      ├─>  « 06 12 34 56 78 »
 *     « +33 6 12 34 56 78 »   ┘
 *     « 0033612345678 »       ┘
 *
 * La normalisation n'est pas cosmetique. Le meme numero tape de quatre facons
 * differentes remplissait quatre lignes differentes dans l'agenda, et l'export
 * « clients » comptait quatre personnes la ou il y en a une.
 *
 * ⚠️ LES NUMEROS ETRANGERS SONT ACCEPTES, ET CE N'EST PAS UN RELACHEMENT.
 *    Bavay est a huit kilometres de la frontiere belge et a vingt-cinq de Mons.
 *    Un barbier de cette rue-la a des clients belges, et leur refuser la
 *    reservation en ligne parce que leur numero commence par +32 serait une
 *    faute commerciale, pas une mesure de securite. Toute forme
 *    internationale — un `+` et huit a quinze chiffres, ce que dit la norme
 *    E.164 — passe donc telle quelle. Ce qui est refuse, c'est ce qui n'est
 *    pas un numero du tout : « abc », « 06 12 », « 1 ».
 */
export function normaliserTelephone(brut) {
  const propre = typeof brut === 'string' ? brut.trim() : '';
  if (!propre) return { erreur: 'Le téléphone est obligatoire.' };

  const MAUVAIS = 'Ce numéro de téléphone n\'a pas l\'air complet. Exemple : 06 12 34 56 78.';

  // Les separateurs que les gens ecrivent vraiment : espaces (y compris
  // insecables), points, tirets, barres obliques, parentheses.
  let compact = propre.replace(/[\s.\-/()  ]/g, '');

  // « 0033… » est la vieille ecriture de « +33… ». Les deux se rencontrent
  // encore sur les cartes de visite.
  if (compact.startsWith('00')) compact = '+' + compact.slice(2);

  // Un `+` ailleurs qu'en tete, ou n'importe quel autre caractere : ce n'est
  // pas un numero.
  if (!/^\+?\d+$/.test(compact)) return { erreur: MAUVAIS };

  // L'indicatif francais : on repasse a l'ecriture nationale, celle que le
  // commercant lira dans son agenda et composera sur son poste.
  if (compact.startsWith('+33')) {
    const reste = compact.slice(3);
    if (!/^[1-9]\d{8}$/.test(reste)) return { erreur: MAUVAIS };
    return { valeur: grouperParDeux('0' + reste) };
  }

  // Un autre indicatif : on garde la forme internationale. Huit chiffres au
  // minimum (le plus court plan de numerotation du monde), quinze au maximum
  // (le plafond de la norme E.164).
  if (compact.startsWith('+')) {
    const chiffres = compact.slice(1);
    if (!/^\d{8,15}$/.test(chiffres)) return { erreur: MAUVAIS };
    return { valeur: '+' + chiffres };
  }

  // L'ecriture nationale francaise : dix chiffres, le premier est un zero, le
  // second designe la zone (1 a 5 pour un fixe, 6 et 7 pour un mobile, 8 pour
  // un numero special, 9 pour une box).
  if (/^0[1-9]\d{8}$/.test(compact)) return { valeur: grouperParDeux(compact) };

  return { erreur: MAUVAIS };
}

/** « 0612345678 » -> « 06 12 34 56 78 ». */
function grouperParDeux(dixChiffres) {
  return dixChiffres.match(/\d{2}/g).join(' ');
}

/**
 * Le courriel, facultatif.
 *
 * ⚠️ FACULTATIF VEUT DIRE FACULTATIF : le vide n'est pas une erreur, il rend
 *    `{ valeur: null }`. Le site le dit au client (« pour recevoir le rappel,
 *    si vous voulez »), et un barbier joint ses clients au telephone.
 *
 * LA REGLE N'EST PAS CELLE DE LA NORME, DELIBEREMENT. La grammaire complete
 * d'une adresse (RFC 5322) accepte des choses que personne n'ecrit — des
 * commentaires entre parentheses, des guillemets, une adresse IP entre
 * crochets — et la reconnaitre demande une expression reguliere de plusieurs
 * centaines de caracteres que personne ne relira. Ce qu'on cherche ici est
 * plus modeste et plus utile : ecarter ce qui ne PEUT PAS etre une adresse,
 * pour que « pasunemail » ne parte pas en base. Une adresse valide mais
 * inexistante passera — seul un envoi le dirait, et on n'en fait pas.
 */
export function validerCourriel(brut) {
  const propre = typeof brut === 'string' ? brut.trim() : '';
  if (!propre) return { valeur: null };

  if (propre.length > COURRIEL_MAX) {
    return { erreur: 'Cette adresse e-mail est trop longue.' };
  }

  // Une partie locale, un @, un domaine d'au moins deux etiquettes, et pas
  // d'espace nulle part. L'etiquette finale fait au moins deux caracteres :
  // c'est vrai de toutes les extensions qui existent.
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.\d]{2,}$/.test(propre)) {
    return {
      erreur: 'Cette adresse e-mail n\'a pas l\'air valable. Exemple : prenom@exemple.fr. '
        + 'Vous pouvez aussi la laisser vide.',
    };
  }

  return { valeur: propre };
}
