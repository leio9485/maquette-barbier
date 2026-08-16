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
};
