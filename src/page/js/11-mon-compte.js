// ---------------------------------------------------------------------------
// LA CONNEXION A L'ESPACE COMMERCANT
//
// Le mot de passe n'est jamais garde ici : il part au serveur, qui repond en
// posant un cookie de session. Le navigateur n'en conserve rien — pas de jeton
// dans localStorage, rien a voler dans la page.
//
// LA DECONNEXION EST REELLE : elle appelle le serveur, qui detruit la session en
// base. Effacer un drapeau cote navigateur aurait laisse la session valide, et
// n'importe qui reprenant l'ordinateur serait revenu dans l'agenda en
// rechargeant.
// ---------------------------------------------------------------------------

/**
 * Montre l'ecran de connexion, agenda masque.
 *
 * On ne quitte PAS la page : se deconnecter ramene au formulaire, pas a la
 * vitrine. Quelqu'un qui se deconnecte veut le plus souvent se reconnecter
 * autrement, et l'y renvoyer d'un cran evite un aller-retour.
 */
function exigerConnexion() {
  ESPACE.connecte = false;
  montrer($('#ecranConnexion'), true);
  montrer($('#ecranEspace'), false);
}

/** Montre l'espace, connexion masquee, et charge ce qu'il faut. */
async function ouvrirEspaceConnecte() {
  ESPACE.connecte = true;
  ESPACE.date = ESPACE.date || aujourdhui();

  montrer($('#ecranConnexion'), false);
  montrer($('#ecranEspace'), true);

  // Le bandeau de demonstration n'apparait que sur la demonstration : chez un
  // vrai client, `CONFIG.demo` n'existe pas et rien ne s'affiche.
  montrer($('#demoBandeau'), Boolean(CONFIG?.demo));

  await chargerAgenda();
}

/**
 * Remet toute la demonstration a zero : reglages, rendez-vous d'exemple,
 * photos.
 *
 * ON DEMANDE CONFIRMATION, parce que c'est destructeur et qu'on peut cliquer
 * dessus en visant « Reglages » juste a cote. Le bouton dit ensuite ce qu'il
 * fait pendant qu'il le fait — la remise a zero reconstruit une base entiere,
 * ce n'est pas instantane.
 *
 * ⚠️ RIEN ICI NE BLOQUE PLUS LE FIL PRINCIPAL. Tout est `await` sur des
 *    requetes, et la page continue de defiler pendant l'operation. Le seul
 *    appel qui figeait l'onglet etait la confirmation NATIVE qui ouvrait cette
 *    fonction : `window.confirm()` arrete tout jusqu'a la reponse, rendu
 *    compris — c'est ce qui donnait l'impression d'une page plantee.
 */
async function remettreDemoAZero() {
  const bouton = $('#demoRemiseAZero');
  const message = $('#messageDemo');

  const accepte = await demanderConfirmation({
    titre: 'Remettre la démonstration à zéro',
    phrase: 'Remettre la démonstration dans son état de départ ?',
    consequence: 'Les réglages, les rendez-vous et les photos saisis depuis la '
      + 'dernière remise à zéro seront effacés. C\'est sans conséquence : cette '
      + 'base est faite pour ça.',
    oui: 'Oui, tout remettre à zéro',
    non: 'Non, garder ce qu\'il y a',
  });
  if (!accepte) return;

  bouton.disabled = true;
  poserTexte(bouton, 'Remise à zéro en cours…');
  afficherMessage(message, '');

  try {
    await reinitialiserDemo();

    // Tout est reconstruit cote serveur : on relit, et on repeint. Sans cela,
    // l'agenda garderait les rendez-vous effaces a l'ecran.
    //
    // ⚠️ PLUS DE `peindreVitrine()` ICI : depuis le lot 4, l'espace est un
    //    document a part et il n'y a aucune vitrine a repeindre a l'ecran. La
    //    vitrine, elle, relira tout a sa prochaine ouverture.
    CONFIG = await lireConfig();
    ESPACE.brouillon = null;

    // La vue courante, quelle qu'elle soit : le bandeau est en tete des trois
    // volets, et on remet a zero aussi bien depuis les chiffres que depuis
    // l'agenda.
    await rafraichirVoletCourant();

    afficherMessage(message, 'La démonstration est repartie de son état de départ.', 'bon');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Remettre à zéro maintenant');
  }
}

// --- LA SECTION « COMPTE » ---------------------------------------------------
//
// >>> ELLE N'EXISTAIT PAS. <<<
//
// `PUT /api/admin/password` etait ecrite et testee depuis le debut, et n'avait
// aucun formulaire. Un commercant a qui l'on livre un identifiant cree en ligne
// de commande ne pouvait donc jamais changer son mot de passe, ni le renouveler
// au depart d'un employe. Pour un produit facture, c'est la premiere chose
// qu'un acheteur oppose.

/** Ce que la section « Compte » affiche : qui, depuis quand, combien d'appareils. */
function peindreCompte() {
  const cible = $('#ficheCompte');
  if (!cible) return;

  const compte = ESPACE.compte;
  if (!compte) return peindreFicheDeTravail(cible, []);

  const autres = compte.otherSessions ?? 0;

  peindreFicheDeTravail(cible, [
    ['Identifiant', compte.username],
    ['Dernière connexion', compte.lastLoginAt
      ? `${dateCourte(compte.lastLoginAt.slice(0, 10))} ${compte.lastLoginAt.slice(11, 16)}`
      : 'Première connexion'],
    ['Autres appareils connectés', autres > 0 ? String(autres) : 'aucun'],
  ]);
}

/**
 * Le changement de mot de passe.
 *
 * ⚠️ LES TROIS CHAMPS SONT VIDES DES QUE LA REQUETE EST PARTIE, qu'elle
 *    aboutisse ou non. Un mot de passe n'a aucune raison de rester dans la page
 *    — ni pour le prochain qui s'assied devant l'ecran, ni pour le
 *    gestionnaire de mots de passe du navigateur.
 */
async function envoyerMotDePasse(evenement) {
  evenement.preventDefault();

  const message = $('#messageMotDePasse');
  const bouton = $('#changerMotDePasse');

  const actuel = $('#motDePasseActuel')?.value ?? '';
  const nouveau = $('#motDePasseNouveau')?.value ?? '';
  const confirmation = $('#motDePasseConfirmation')?.value ?? '';

  // Deux controles avant l'aller-retour, et le serveur refait les deux : ils ne
  // sont ici que pour eviter un aller-retour evident.
  if (!actuel || !nouveau) {
    return signalerChampMotDePasse(!actuel ? 'motDePasseActuel' : 'motDePasseNouveau',
      message, 'Remplissez les trois champs.');
  }
  if (nouveau !== confirmation) {
    return signalerChampMotDePasse('motDePasseConfirmation', message,
      'Les deux nouveaux mots de passe ne sont pas identiques.');
  }

  bouton.disabled = true;
  poserTexte(bouton, 'Changement en cours…');
  afficherMessage(message, '');

  try {
    const reponse = await changerMotDePasse(actuel, nouveau, confirmation);

    viderChampsMotDePasse();
    for (const id of ['motDePasseActuel', 'motDePasseNouveau', 'motDePasseConfirmation']) {
      marquerRefus($('#' + id), false);
    }

    // Les autres sessions viennent d'etre fermees : le compte a change, on le
    // relit plutot que de deviner ce qu'il est devenu.
    try {
      ESPACE.compte = await lireCompte();
      peindreCompte();
    } catch { /* le compte s'affichera a la prochaine ouverture */ }

    afficherMessage(message, reponse?.message ?? 'Mot de passe modifié.', 'bon');
  } catch (erreur) {
    if (erreur.code === 401 && !erreur.message.includes('actuel')) return exigerConnexion();

    viderChampsMotDePasse();
    signalerChampMotDePasse(
      erreur.message.includes('actuel') ? 'motDePasseActuel' : 'motDePasseNouveau',
      message, erreur.message);
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Changer le mot de passe');
  }
}

function viderChampsMotDePasse() {
  for (const id of ['motDePasseActuel', 'motDePasseNouveau', 'motDePasseConfirmation']) {
    const champ = $('#' + id);
    if (champ) champ.value = '';
  }
}

/**
 * Le refus d'un champ : il se signale, il s'annonce, et il reprend le focus.
 *
 * Les trois comptent, et la troisieme n'est pas un confort : sans elle,
 * quelqu'un au lecteur d'ecran reste sur le bouton et n'apprend jamais lequel
 * des trois champs est en cause.
 */
function signalerChampMotDePasse(champId, message, texte) {
  afficherMessage(message, texte);

  for (const id of ['motDePasseActuel', 'motDePasseNouveau', 'motDePasseConfirmation']) {
    marquerRefus($('#' + id), id === champId);
  }

  $('#' + champId)?.focus();
}

/**
 * Y a-t-il encore une session valide ?
 *
 * Appelee a l'ouverture de l'espace : quelqu'un qui recharge sa page ne doit pas
 * ressaisir son mot de passe. Le serveur seul repond — le navigateur ne sait
 * rien de l'etat de la session, et c'est voulu.
 */
async function verifierSession() {
  try {
    ESPACE.compte = await lireCompte();
    await ouvrirEspaceConnecte();
  } catch {
    exigerConnexion();
  }
}

async function envoyerConnexion(evenement) {
  evenement.preventDefault();

  const message = $('#messageConnexion');
  const identifiant = $('#connexionIdentifiant')?.value.trim() ?? '';
  const motDePasse = $('#connexionMotDePasse')?.value ?? '';

  if (!identifiant || !motDePasse) {
    return afficherMessage(message, 'Identifiant et mot de passe sont demandés.');
  }

  afficherMessage(message, '');

  try {
    await seConnecter(identifiant, motDePasse);

    // Le mot de passe est efface du formulaire des que possible : il n'a plus
    // aucune raison de rester dans la page.
    $('#connexionMotDePasse').value = '';

    await ouvrirEspaceConnecte();
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  }
}

async function envoyerDeconnexion() {
  try {
    await seDeconnecterServeur();
  } catch {
    // Meme si l'appel echoue, on repasse a l'ecran de connexion : laisser
    // l'agenda affiche apres un clic sur « se déconnecter » serait le pire des
    // deux mondes.
  }

  ESPACE.brouillon = null;
  exigerConnexion();
}

/** Bascule entre l'agenda et les reglages. */
function ouvrirVolet(nom) {
  ESPACE.volet = nom;

  for (const onglet of $$('.espace-onglet')) {
    onglet.setAttribute('aria-current', String(onglet.dataset.volet === nom));
  }

  for (const volet of $$('[data-volet]')) {
    if (volet.tagName === 'SECTION') montrer(volet, volet.dataset.volet === nom);
  }

  if (nom === 'chiffres') chargerChiffres();
  if (nom === 'reglages') { chargerReglages(); peindreCompte(); }
  if (nom === 'agenda') chargerAgenda();
}

/**
 * Relit ce que le volet ouvert affiche, et lui seul.
 *
 * ⚠️ L'AGENDA EST TOUJOURS RELU, meme quand on regarde un autre volet : il est
 *    deja peint derriere, et le laisser sur des rendez-vous effaces est
 *    exactement ce qui donne l'impression qu'une remise a zero n'a rien remis.
 *    Les deux autres volets, eux, se relisent seulement s'ils sont a l'ecran —
 *    reconstruire les 255 champs des reglages pour personne coute cher et ne
 *    montre rien.
 */
function rafraichirVoletCourant() {
  const attentes = [chargerAgenda()];
  if (ESPACE.volet === 'chiffres') attentes.push(chargerChiffres());
  if (ESPACE.volet === 'reglages') attentes.push(chargerReglages());
  return Promise.all(attentes);
}

function brancherCompte() {
  $('#formulaireConnexion')?.addEventListener('submit', envoyerConnexion);
  $('#seDeconnecter')?.addEventListener('click', envoyerDeconnexion);
  $('#demoRemiseAZero')?.addEventListener('click', remettreDemoAZero);
  $('#formulaireMotDePasse')?.addEventListener('submit', envoyerMotDePasse);

  // Un champ corrige cesse d'etre en faute des la frappe : laisser le filet
  // rouge et `aria-invalid` sur un champ qu'on vient de reecrire ferait dire
  // « saisie invalide » sur une saisie qui ne l'est plus.
  for (const id of ['motDePasseActuel', 'motDePasseNouveau', 'motDePasseConfirmation']) {
    $('#' + id)?.addEventListener('input', (evenement) => marquerRefus(evenement.target, false));
  }

  for (const onglet of $$('.espace-onglet')) {
    onglet.addEventListener('click', () => ouvrirVolet(onglet.dataset.volet));
  }
}
