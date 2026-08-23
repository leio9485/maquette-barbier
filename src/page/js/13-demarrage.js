// ---------------------------------------------------------------------------
// LE DEMARRAGE
//
// ⚠️ CE FICHIER DOIT RESTER LE DERNIER : il appelle des fonctions definies dans
//    tous les precedents.
//
// L'ORDRE COMPTE, ET IL EST DELIBERE :
//
//   1. on branche tout ce qui ne demande aucune donnee (les surimpressions, la
//      navigation, le tunnel) — un visiteur qui clique pendant le chargement
//      doit deja obtenir quelque chose ;
//   2. on demande les reglages ;
//   3. on repeint la vitrine avec.
//
// Ce que le serveur a deja ecrit dans la page — l'en-tete, les prestations, les
// avis, le bandeau d'etat — est affiche AVANT que ce fichier ne s'execute. Le
// site est donc lisible et navigable meme si l'etape 2 echoue, et c'est pour
// cela qu'aucun message d'erreur n'apparait a l'ecran quand elle echoue.
// ---------------------------------------------------------------------------

async function demarrer() {
  brancherNavigation();
  brancherBandeau();
  brancherTunnel();
  // La liste tarifaire se replie par rayon sous 768 px et se redeploie au-dela :
  // franchir le seuil demande de la redessiner (js/04-contenu-statique.js).
  brancherPrestations();

  try {
    CONFIG = await lireConfig();
  } catch {
    // Les reglages n'arrivent pas. La page reste celle qu'a envoyee le serveur :
    // tarifs, horaires et coordonnees y sont deja, un peu figes mais justes.
    // Le tunnel, lui, ne pourra pas fonctionner — il demandera de toute facon
    // ses creneaux au serveur, et affichera son propre message a ce moment-la.
    return;
  }

  peindreVitrine(CONFIG);

  // Un deplacement demande depuis /annuler : le tunnel se rouvre a l'etape 2,
  // prestation et personne deja choisies (js/07-tunnel.js). Attendu, parce que
  // la suite ne doit pas repeindre par-dessus.
  await reprendreDeplacement();

  // Le rappel « votre rendez-vous », sous l'en-tete. Pas attendu : il interroge
  // le serveur, et rien de ce qui suit n'en depend. Il ne s'affiche que si le
  // rendez-vous garde en memoire existe encore (js/11-mon-rendez-vous.js).
  montrerMonRendezVous();

}

// `DOMContentLoaded` plutot qu'un appel direct : le script est en fin de body,
// mais rien ne garantit qu'il le restera, et un `$('#...')` sur un element pas
// encore analyse renverrait `null` sans rien dire.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer);
} else {
  demarrer();
}
