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
  brancherAgenda();
  brancherReglages();
  brancherCompte();

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

  // Les identifiants de la demonstration, sur l'ecran de connexion. Ce bloc
  // n'existe que sur la vitrine de demonstration : chez un vrai client, le
  // serveur n'envoie pas ce champ et rien ne s'affiche.
  if (CONFIG.demo) {
    poserTexte($('#demoIdentifiant'), CONFIG.demo.username);
    poserTexte($('#demoMotDePasse'), CONFIG.demo.password);
    montrer($('#connexionDemo'), true);
  }

  ESPACE.date = aujourdhui();
}

// `DOMContentLoaded` plutot qu'un appel direct : le script est en fin de body,
// mais rien ne garantit qu'il le restera, et un `$('#...')` sur un element pas
// encore analyse renverrait `null` sans rien dire.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer);
} else {
  demarrer();
}
