// ---------------------------------------------------------------------------
// LE DEMARRAGE DE L'ESPACE COMMERCANT.
//
// ⚠️ DERNIER FICHIER DU DOCUMENT : il appelle des fonctions definies dans tous
//    les precedents.
//
// L'ordre est le meme que celui de la vitrine, pour la meme raison : on branche
// d'abord ce qui ne demande aucune donnee, on demande ensuite.
//
// ⚠️ IL NE REMPLACE PAS js/13-demarrage.js, il en est le pendant. Les deux
//    documents ont chacun le leur : la vitrine n'a pas d'agenda a ouvrir, et
//    l'espace n'a ni tunnel, ni bandeau d'etat, ni photos a poser.
// ---------------------------------------------------------------------------

async function demarrerEspace() {
  brancherNavigation();
  brancherAgenda();
  brancherReglages();
  brancherCompte();

  ESPACE.date = aujourdhui();

  try {
    CONFIG = await lireConfig();
  } catch {
    // Les reglages n'arrivent pas. L'ecran de connexion s'affiche quand meme —
    // il ne depend d'aucune donnee — et tout ce qui suit dira son propre
    // message quand il echouera a son tour.
  }

  // Les identifiants de la demonstration, sur l'ecran de connexion. Chez un
  // vrai client, le serveur n'envoie pas ce champ et rien ne s'affiche.
  if (CONFIG?.demo) {
    poserTexte($('#demoIdentifiant'), CONFIG.demo.username);
    poserTexte($('#demoMotDePasse'), CONFIG.demo.password);
    montrer($('#connexionDemo'), true);
  }

  // Une session encore valide ouvre directement l'agenda ; sinon, la connexion.
  //
  // >>> C'EST CE QUI FAIT QUE LE COMMERCANT NE RESAISIT PRESQUE JAMAIS SON MOT
  //     DE PASSE. <<< Il pose l'adresse en raccourci sur son ecran d'accueil,
  //     et la session se renouvelle a l'usage. C'est ce qui rend acceptable le
  //     retrait du bouton public : il n'a plus a passer par la vitrine.
  await verifierSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrerEspace);
} else {
  demarrerEspace();
}
