// ---------------------------------------------------------------------------
// L'ETAT DE LA PAGE
//
// Tout ce que le site garde en memoire pendant une visite. Un seul objet, un
// seul endroit : c'est ce qui evite les variables eparpillees dont on ne sait
// plus, six mois plus tard, laquelle fait foi.
//
// Rien n'est ecrit dans le navigateur (ni localStorage, ni cookie) : les
// donnees vivent sur le serveur, et une visite ne laisse aucune trace sur la
// machine du visiteur. C'est la page de confidentialite qui le promet, et c'est
// ici que la promesse se tient.
// ---------------------------------------------------------------------------

/** Les reglages du commerce, tels que /api/config les renvoie. */
let CONFIG = null;

/** Le rendez-vous en cours de prise. */
const RESERVATION = {
  etape: 1,
  prestation: null,   // l'objet prestation complet
  staffId: '',        // '' = peu importe
  // La personne demandee depuis la section Equipe (« Reserver avec X »), mise
  // de cote jusqu'a ce qu'on sache quelle prestation est choisie : c'est elle
  // qui determine qui peut la faire. Voir `reserverAvec()` et `peindreQui()`.
  attenteStaffId: '',
  date: '',           // 'AAAA-MM-JJ'
  creneau: null,      // { start, label, staff }
  mois: null,         // le premier jour du mois affiche au calendrier
  confirmee: null,    // ce que le serveur a repondu, jeton d'annulation compris
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

/** Les noms de jours et de mois, ecrits une fois. */
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

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
