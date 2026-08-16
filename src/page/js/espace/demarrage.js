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
  brancherConfirmation();
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

  // >>> LES IDENTIFIANTS DE LA DEMONSTRATION NE SONT PLUS POSES ICI. <<<
  //
  // C'etaient quatre lignes : ecrire les deux identifiants, puis reveler le
  // bloc. Elles s'executaient APRES `lireConfig()`, donc apres un aller-retour
  // reseau, sur une boite centree verticalement — le formulaire de connexion
  // sautait de 299 px, et c'etait le seul CLS du site (0,219 sur l'instance
  // deployee, mesure le 12 aout 2026).
  //
  // Le serveur ecrit desormais le bloc entier dans la page. Il est la des la
  // premiere peinture, avec ses deux valeurs, et il n'y a plus rien a reveler.
  // Le motif complet est en tete de parties/espace-commercant.html.
  //
  // ⚠️ `CONFIG.demo` existe toujours dans /api/config, et c'est voulu : c'est
  //    ce qui dit au reste de l'espace qu'il est sur une demonstration — le
  //    bandeau « Remettre a zero maintenant » en depend.

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
