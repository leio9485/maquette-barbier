// ---------------------------------------------------------------------------
// L'ETAT DE LA PAGE
//
// Tout ce que le site garde en memoire pendant une visite. Un seul objet, un
// seul endroit : c'est ce qui evite les variables eparpillees dont on ne sait
// plus, six mois plus tard, laquelle fait foi.
//
// Une seule chose est ecrite dans le navigateur, et seulement apres une
// reservation : le rappel du rendez-vous pris (js/12-mon-rendez-vous.js). Ni
// cookie, ni mesure d'audience, ni identifiant de visite — la page de
// confidentialite dit exactement ce qui est gardé et pourquoi.
//
// ⚠️ CE FICHIER EST CHARGE PAR LA VITRINE ET PAR L'ESPACE COMMERCANT : il ne
//    doit contenir que ce que les deux partagent. L'etat d'une reservation est
//    parti dans js/07-tunnel.js, celui de l'espace dans js/espace/etat.js — le
//    premier n'a rien a faire dans l'espace, le second n'avait rien a faire
//    dans la vitrine, ou il partait chez chaque visiteur (lot 4).
// ---------------------------------------------------------------------------

/** Les reglages du commerce, tels que /api/config les renvoie. */
let CONFIG = null;

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
