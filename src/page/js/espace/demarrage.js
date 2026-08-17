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

/**
 * La hauteur des barres collees en haut, publiee en jetons CSS.
 *
 * >>> POURQUOI C'EST MESURE ET NON ECRIT DANS LES JETONS. <<<
 *
 * La vitrine peut se permettre `--h-entete: 64px` : son en-tete a une hauteur
 * decidee, sur une seule ligne. La barre de l'espace, non — elle porte le nom
 * du commerce, trois onglets et deux actions, et elle PASSE A LA LIGNE selon la
 * largeur. Une valeur ecrite a la main serait fausse a une largeur sur deux, et
 * elle le deviendrait pour de bon le jour ou un onglet s'ajoute.
 *
 * Ce qui en depend :
 *   - `--h-barre`    : le `top` de l'en-tete de journee et du sommaire ;
 *   - `--h-sommaire` : le retrait des ancres, pour qu'un titre de section
 *                      atterrisse SOUS le sommaire et non derriere.
 *
 * ⚠️ APPELEE AUX MOMENTS OU LA MISE EN PAGE CHANGE, ET NON PAR UN
 *    `ResizeObserver`.
 *
 *    C'etait un observateur, et c'est plus elegant sur le papier : il voit le
 *    passage a la ligne, la revelation d'un element masque, tout. Mais ses
 *    rappels sont livres pendant les etapes de rendu — un onglet qui ne rend
 *    pas ne les recoit jamais. Constate, pas suppose : dans un navigateur
 *    pilote dont le panneau n'est pas affiche, PAS UN SEUL rappel n'arrive, pas
 *    meme l'observation initiale, et les jetons restaient vides.
 *
 *    Les trois moments qui comptent sont connus et peu nombreux : l'ouverture
 *    de l'espace, le changement de volet, le redimensionnement de la fenetre.
 *    Les mesurer la est moins malin, et ca marche partout.
 */
function mesurerLesBarresCollees() {
  const racine = document.documentElement;

  const mesurer = (selecteur, jeton) => {
    const element = $(selecteur);
    if (!element) return;

    const hauteur = Math.round(element.getBoundingClientRect().height);
    // Zero veut dire « masque », pas « plus rien a decaler » : on garde alors
    // la derniere hauteur connue plutot que de coller les titres au bord.
    if (hauteur > 0) racine.style.setProperty(jeton, `${hauteur}px`);
  };

  mesurer('.espace-barre', '--h-barre');
  mesurer('.reglages-sommaire', '--h-sommaire');
}

async function demarrerEspace() {
  brancherNavigation();
  brancherConfirmation();
  brancherAgenda();

  // La largeur change : la barre du haut peut passer a la ligne, et tout ce qui
  // se cale dessous doit suivre.
  window.addEventListener('resize', mesurerLesBarresCollees);

  // Les polices arrivent apres le premier rendu et peuvent changer la hauteur
  // de la barre d'un ou deux pixels. Une ligne pour ne pas laisser un decalage
  // permanent au premier chargement.
  document.fonts?.ready.then(mesurerLesBarresCollees);

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
