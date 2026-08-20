// ---------------------------------------------------------------------------
// L'ETAT DE L'ESPACE COMMERCANT
//
// Ce que l'espace garde en memoire pendant qu'il est ouvert : le volet affiche,
// le jour de l'agenda, et le brouillon des reglages.
//
// >>> IL ETAIT DANS js/01-configuration.js, ET PARTAIT DONC DANS LA VITRINE. <<<
//
// Quelques centaines d'octets seulement, mais le principe compte : depuis le
// lot 4, la vitrine ne doit plus porter une seule ligne de l'espace. Un test
// cherche les chaines interdites dans la page publique, et c'est lui qui a
// trouve celle-ci.
// ---------------------------------------------------------------------------

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
  // Qui est connecte : identifiant, derniere connexion, autres appareils
  // ouverts. Lu une fois a l'ouverture de l'espace, relu apres un changement de
  // mot de passe. AUCUN MOT DE PASSE N'ENTRE ICI, jamais.
  compte: null,
  // Les numeros de telephone reveles a la main, le temps de la visite. Voir
  // `masquerLesTelephones()` ci-dessous : un clic sur une ligne masquee y
  // ajoute son identifiant, et une repeinte de l'agenda le retrouve.
  telephonesReveles: new Set(),
};

// --- LES NUMEROS DE TELEPHONE DANS L'AGENDA ---------------------------------
//
// >>> UN ECRAN D'AGENDA EST SOUVENT VISIBLE DEPUIS LA SALLE. <<< Les numeros
// complets s'affichaient sur chaque ligne : en arriere-boutique c'est ce qu'on
// veut, sur le comptoir c'est la donnee personnelle de trente clients exposee a
// tous ceux qui attendent. Masques par defaut, reveles au clic.
//
// ⚠️ C'EST UN REGLAGE D'APPAREIL, ET PAS DU COMMERCE. Le risque est physique —
//    un ecran tourne vers la salle — et il ne concerne donc pas les deux
//    machines de la meme facon : la tablette du comptoir doit masquer, le
//    portable de l'arriere-boutique n'a aucune raison de le faire. Un reglage
//    enregistre en base imposerait le meme choix aux deux, ce qui reviendrait a
//    faire trancher par le commerce une question qui appartient a la piece.
//
//    C'est aussi ce qui evite une colonne de plus dans la base d'un client qui
//    tourne, pour un booleen qui ne decide de rien cote serveur : le numero
//    part dans la reponse comme avant, et l'ecran choisit de l'ecrire ou non.
//    L'intitule le dit en toutes lettres — « sur cet appareil » — parce qu'un
//    reglage qui ne suit pas d'un ecran a l'autre sans le dire est un piege.
//
// ⚠️ CE N'EST PAS UNE MESURE DE SECURITE, et il ne faut pas le vendre comme
//    telle. Le numero est dans la reponse du serveur, dans la fiche a un clic,
//    et dans les exports. Ce que cela empeche est un regard par-dessus
//    l'epaule, ce qui est exactement le risque qu'on a.

const CLE_TELEPHONES = 'letabli.agenda.telephones';

/**
 * Faut-il masquer les numeros ?
 *
 * >>> MASQUE PAR DEFAUT. <<< L'absence de reglage vaut « masque », et pas
 * l'inverse : un commercant qui n'a rien decide est protege, et celui qui veut
 * ses numeros a l'ecran fait un geste explicite. C'est le sens que doit avoir
 * un defaut sur une donnee personnelle.
 *
 * Tout echec de lecture rend `true` pour la meme raison : navigation privee,
 * stockage refuse, valeur abimee — aucun de ces cas ne justifie de decouvrir
 * trente numeros.
 */
function masquerLesTelephones() {
  try {
    return localStorage.getItem(CLE_TELEPHONES) !== 'visibles';
  } catch {
    return true;
  }
}

/** Enregistre le choix, et oublie ce qui avait ete revele a la main. */
function poserMasquageTelephones(masquer) {
  try {
    if (masquer) localStorage.setItem(CLE_TELEPHONES, 'masques');
    else localStorage.setItem(CLE_TELEPHONES, 'visibles');
  } catch {
    // Stockage refuse : le choix ne survivra pas au rechargement, et c'est
    // tout. Rien a dire au commercant, qui n'a pas demande ce tiroir.
  }
  ESPACE.telephonesReveles = new Set();
}
