// ---------------------------------------------------------------------------
// LA CONFIRMATION AVANT L'IRREVERSIBLE.
//
// Une seule fonction, `demanderConfirmation()`, qui rend une promesse : vrai si
// la personne a confirme, faux dans tous les autres cas — bouton de refus,
// croix, touche Echap, clic sur le voile.
//
//     if (!await demanderConfirmation({ ... })) return;
//
// Elle se lit donc exactement comme le `window.confirm()` qu'elle remplace, a un
// `await` pres. C'etait la condition pour que les trois appels du depot y
// passent sans etre reecrits.
//
// TROIS DIFFERENCES AVEC LE CONFIRM NATIF, ET CE SONT LES TROIS RAISONS D'ETRE :
//
//   1. Elle NOMME ce qui va disparaitre. « Supprimer le rendez-vous de Damien
//      Carpentier, samedi 15 aout a 09:00 avec Remi ? », et non « Supprimer ce
//      rendez-vous ? ». C'est la seule facon de rattraper un clic sur la
//      mauvaise ligne.
//   2. Les deux boutons portent un VERBE. « OK » et « Annuler » ne disent pas
//      ce qu'ils font, et « Annuler » designe deja une action metier ici.
//   3. Elle NE FIGE PAS L'ONGLET. `window.confirm()` arrete le fil principal
//      jusqu'a la reponse : rien ne se peint, rien ne defile, et une page qui
//      attend derriere une fenetre native a l'air plantee.
//
// ⚠️ ELLE NE S'EMPILE PAS SUR UNE AUTRE SURIMPRESSION. Le mecanisme de
//    js/05-navigation.js ne retient QU'UN element a rendre au clavier : deux
//    boites ouvertes l'une sur l'autre et le focus ne revient pas ou il faut.
//    Les appelants ferment donc leur propre boite avant d'appeler, et la
//    rouvrent si la reponse est non — c'est aussi la sequence de /annuler,
//    fiche puis confirmation.
// ---------------------------------------------------------------------------

/** La fonction qui attend la reponse, tant qu'une question est posee. */
let repondreConfirmation = null;

/**
 * Pose la question et rend une promesse.
 *
 * @param {string}   titre        le titre de la fenetre
 * @param {string}   phrase       la question, qui nomme ce qui va disparaitre
 * @param {Array}    lignes       [[intitule, valeur], ...] — le detail, facultatif
 * @param {string}   consequence  ce qui se passe ensuite, et que rien ne defait
 * @param {string}   oui          le libelle du bouton qui agit (un verbe)
 * @param {string}   non          le libelle du bouton qui renonce (un verbe)
 */
function demanderConfirmation({
  titre,
  phrase,
  lignes = [],
  consequence = 'Cette action ne se défait pas.',
  oui,
  non = 'Non, revenir en arrière',
}) {
  const boite = $('#surimpressionConfirmation');
  if (!boite) return Promise.resolve(false);

  poserTexte($('#titreConfirmation'), titre);
  poserTexte($('#phraseConfirmation'), phrase);
  poserTexte($('#avertissementConfirmation'), consequence);
  poserTexte($('#confirmationOui'), oui);
  poserTexte($('#confirmationNon'), non);

  const fiche = $('#ficheConfirmation');
  peindreFicheDeTravail(fiche, lignes);
  montrer(fiche, lignes.length > 0);

  ouvrirSurimpression('surimpressionConfirmation');

  return new Promise((resoudre) => {
    repondreConfirmation = (reponse) => {
      repondreConfirmation = null;
      fermerSurimpression('surimpressionConfirmation');
      resoudre(reponse);
    };
  });
}

/**
 * Les lignes « intitule / valeur » de la fiche de travail.
 *
 * ⚠️ MEME BALISAGE QUE `peindreFiche()` DE js/07-tunnel.js ET DE
 *    js/annuler/02-ecrans.js. C'est la meme forme, employee aux trois endroits
 *    ou l'on recapitule quelque chose avant d'agir. Si l'une change, changer
 *    les autres.
 */
function peindreFicheDeTravail(cible, lignes) {
  if (!cible) return;

  cible.innerHTML = lignes
    .filter(([, valeur]) => valeur !== null && valeur !== undefined && valeur !== '')
    .map(([intitule, valeur]) => `<div><dt>${esc(intitule)}</dt><dd>${esc(valeur)}</dd></div>`)
    .join('');
}

/**
 * Le branchement.
 *
 * Les ecouteurs sont poses sur la boite elle-meme, et non sur le document :
 * c'est ce qui evite d'avoir a les retirer, et ce qui fait que ce fichier ne
 * connait rien du reste de la page.
 *
 * Echap remonte de l'element qui a le focus — il est DANS la boite, puisque le
 * focus y est piege — jusqu'a la boite. js/05-navigation.js la referme de son
 * cote ; ici on ne fait que rendre la reponse.
 */
function brancherConfirmation() {
  const boite = $('#surimpressionConfirmation');
  if (!boite) return;

  $('#confirmationOui')?.addEventListener('click', () => repondreConfirmation?.(true));
  $('#confirmationNon')?.addEventListener('click', () => repondreConfirmation?.(false));

  // La croix, et le clic sur le voile : refuser, comme partout.
  boite.addEventListener('click', (evenement) => {
    if (evenement.target === boite || evenement.target.closest('[data-fermer]')) {
      repondreConfirmation?.(false);
    }
  });

  boite.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Escape') repondreConfirmation?.(false);
  });
}
