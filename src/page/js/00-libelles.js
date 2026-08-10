// ---------------------------------------------------------------------------
// LES NOMS DE JOURS ET DE MOIS
//
// Ecrits une seule fois, et dans un fichier a eux parce que DEUX DOCUMENTS s'en
// servent : la vitrine (src/page/index.html) et la page d'annulation
// (src/page/annuler.html). Ils vivaient dans js/01-configuration.js, qui porte
// l'etat d'une visite de la vitrine — un etat dont la page d'annulation n'a que
// faire.
//
// Les recopier dans le second document aurait suffi, et c'est exactement ce
// qu'il ne faut pas faire : deux listes de mois finissent toujours par diverger.
// ---------------------------------------------------------------------------

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
