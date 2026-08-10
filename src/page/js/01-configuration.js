// ---------------------------------------------------------------------------
// L'ETAT DE LA PAGE
//
// Tout ce que le site garde en memoire pendant une visite. Un seul objet, un
// seul endroit : c'est ce qui evite les variables eparpillees dont on ne sait
// plus, six mois plus tard, laquelle fait foi.
//
// Une seule chose est ecrite dans le navigateur, et seulement apres une
// reservation : le rappel du rendez-vous pris (js/11-mon-rendez-vous.js). Ni
// cookie, ni mesure d'audience, ni identifiant de visite — la page de
// confidentialite dit exactement ce qui est gardé et pourquoi.
// ---------------------------------------------------------------------------

/** Les reglages du commerce, tels que /api/config les renvoie. */
let CONFIG = null;

/** Le rendez-vous en cours de prise. */
const RESERVATION = {
  etape: 1,
  prestation: null,   // l'objet prestation complet
  staffId: '',        // '' = peu importe
  date: '',           // 'AAAA-MM-JJ'
  creneau: null,      // { start, label }
  mois: null,         // le premier jour du mois affiche au calendrier
  confirmee: null,    // ce que le serveur a repondu, jeton d'annulation compris
  // LE MODE DEPLACEMENT. `null` = on prend un nouveau rendez-vous, le cas
  // normal. Rempli quand on arrive depuis /annuler avec un rendez-vous a
  // decaler : le tunnel garde alors la meme prestation, saute les coordonnees,
  // et enregistre par /api/rendez-vous/deplacer au lieu de creer une seconde
  // ligne. Voir js/07-tunnel.js.
  deplacement: null,  // { reference, telephone, jeton, ancien }
};

/** L'espace commercant. */
const ESPACE = {
  connecte: false,
  volet: 'agenda',
  vue: 'jour',        // 'jour' ou 'semaine'
  date: '',           // le jour affiche
  // Les reglages en cours de modification. `null` tant qu'on n'a rien touche :
  // c'est ce qui distingue « aucun brouillon » de « brouillon identique a
  // l'enregistre ».
  brouillon: null,
};

/** Le nombre de jours qu'un seul appel de disponibilites peut couvrir. */
const FENETRE_JOURS = 42;

// Les noms de jours et de mois sont dans js/00-libelles.js : la page
// d'annulation s'en sert aussi, et elle ne charge pas ce fichier-ci.

/**
 * L'ordre d'affichage de la semaine : lundi d'abord.
 *
 * JavaScript numerote les jours a partir de dimanche (0), ce qui n'est celui de
 * personne en France. Ce tableau traduit « la n-ieme colonne » en « ce jour-la »,
 * et il est employe partout ou une semaine s'affiche — calendrier du tunnel,
 * agenda, tableau des horaires. Sans lui, la correction se referait a la main a
 * chaque endroit, avec une chance sur deux de se tromper.
 */
const SEMAINE = [1, 2, 3, 4, 5, 6, 0];
