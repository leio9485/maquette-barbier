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

  // La barre du haut vient d'apparaitre : c'est maintenant qu'elle a une
  // hauteur, et tout ce qui se colle dessous en depend.
  mesurerLesBarresCollees();

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

  // Le sommaire des reglages n'a de hauteur que son volet ouvert, et la barre
  // du haut peut changer de hauteur d'un volet a l'autre.
  mesurerLesBarresCollees();
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
  $('#formulaireCompte')?.addEventListener('submit', envoyerNouveauCompte);

  // Delegue : la liste est repeinte a chaque relecture, et des ecouteurs poses
  // sur les boutons disparaitraient avec eux.
  $('#listeComptes')?.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('[data-revoquer]');
    if (bouton) revoquerDepuisListe(bouton.dataset.revoquer);
  });

  for (const id of ['compteIdentifiant', 'compteMotDePasse']) {
    $('#' + id)?.addEventListener('input', (evenement) => marquerRefus(evenement.target, false));
  }

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

// --- LES PERSONNES AUTORISEES ----------------------------------------------
//
// >>> UN SEUL MOT DE PASSE POUR TOUTE L'EQUIPE, C'ETAIT LE DEFAUT. <<<
//
// La base acceptait plusieurs comptes depuis le premier jour ; la seule facon
// d'en creer un etait `npm run admin:create`, en ligne de commande, sur le
// serveur — que le commercant n'a pas. Un salon de trois personnes se
// retrouvait donc avec un mot de passe partage : personne ne sait qui a
// supprime quoi, couper l'acces de quelqu'un qui part oblige a deconnecter tout
// le monde, et un ancien employe garde l'entree du fichier client.
//
// Le raisonnement complet, et l'absence de roles, sont en tete de la section
// correspondante dans src/routes/auth.js.

/** Ce que la liste sait, entre deux relectures. */
let COMPTES = [];

/** Charge la liste des acces, et la dessine. */
async function chargerComptes() {
  try {
    const reponse = await lireComptes();
    COMPTES = reponse.users ?? [];
    peindreComptes();
    afficherMessage($('#messageComptes'), '');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageComptes'), erreur.message);
  }
}

/**
 * La liste des acces, dans la forme des autres listes des reglages.
 *
 * Aucun dessin propre : `.reglages-ligne` sert deja aux prestations, aux
 * personnes, aux avis et aux rayons. Cinq listes qui se ressemblent
 * s'apprennent une fois.
 */
function peindreComptes() {
  const cible = $('#listeComptes');
  if (!cible) return;

  cible.innerHTML = COMPTES
    .map((compte, rang) => {
      const numero = String(rang + 1).padStart(2, '0');

      // >>> CE QUI SE LIT SUR LA LIGNE EST CE QUI SERT A DECIDER. <<< « Compte
      //     2 » n'apprend rien ; savoir qu'un acces n'a jamais servi, ou qu'il
      //     est ouvert sur deux appareils en ce moment, est exactement ce qu'on
      //     vient chercher avant de revoquer.
      const appuis = [];
      if (compte.isSelf) appuis.push('vous, en ce moment');
      appuis.push(compte.lastLoginAt
        ? `dernière entrée le ${dateCourte(compte.lastLoginAt.slice(0, 10))}`
        : 'jamais entré');
      if (compte.openSessions > 0) {
        appuis.push(`${compte.openSessions} appareil${compte.openSessions > 1 ? 's' : ''} ouvert${compte.openSessions > 1 ? 's' : ''}`);
      }

      // Le bouton disparait sur sa propre ligne et sur la derniere restante :
      // le serveur refuse les deux, et un bouton qui refuse toujours n'a rien a
      // faire la. La regle vit des deux cotes, jamais du seul cote de la page.
      const revocable = !compte.isSelf && COMPTES.length > 1;

      return '<div class="reglages-ligne">'
        + '<div class="reglages-ligne-tete">'
        + `<span class="reglages-ligne-numero">${esc(numero)}</span>`
        + `<span class="reglages-ligne-titre">${esc(compte.username)}</span>`
        + `<span class="reglages-ligne-appui">${esc(appuis.join(' · '))}</span>`
        + (revocable
          ? '<span class="reglages-ligne-actions">'
            + `<button type="button" class="reglages-bouton reglages-retirer" data-revoquer="${esc(compte.id)}">Révoquer</button>`
            + '</span>'
          : '')
        + '</div>'
        + '</div>';
    })
    .join('');
}

async function envoyerNouveauCompte(evenement) {
  evenement.preventDefault();

  const message = $('#messageNouveauCompte');
  const bouton = $('#ajouterCompte');

  marquerRefus($('#compteIdentifiant'), false);
  marquerRefus($('#compteMotDePasse'), false);

  const identifiant = $('#compteIdentifiant')?.value.trim() ?? '';
  const motDePasse = $('#compteMotDePasse')?.value ?? '';

  if (!identifiant) {
    afficherMessage(message, "Il faut un identifiant.");
    marquerRefus($('#compteIdentifiant'), true, 'messageNouveauCompte');
    $('#compteIdentifiant')?.focus();
    return;
  }

  bouton.disabled = true;
  poserTexte(bouton, 'Ajout en cours…');

  try {
    const cree = await creerCompte(identifiant, motDePasse);

    // Les deux champs sont vides AUSSITOT : un mot de passe qui reste affiche
    // dans un formulaire, sur un poste de comptoir, se lit par-dessus l'epaule.
    // Meme regle que le formulaire de changement de mot de passe juste au-dessus.
    $('#compteIdentifiant').value = '';
    $('#compteMotDePasse').value = '';

    afficherMessage(message, '');
    await chargerComptes();
    afficherMessage($('#messageComptes'),
      `Accès créé pour ${cree.username}. Donnez-lui son mot de passe de vive voix : `
      + 'il pourra le changer depuis « Compte ».', 'bon');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();

    // Le champ fautif reprend le focus, comme partout : le message seul ne dit
    // rien a quelqu'un qui ne voit pas l'ecran.
    const champ = /identifiant/i.test(erreur.message) ? 'compteIdentifiant' : 'compteMotDePasse';
    afficherMessage(message, erreur.message);
    marquerRefus($('#' + champ), true, 'messageNouveauCompte');
    $('#' + champ)?.focus();
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Ajouter cet accès');
  }
}

/**
 * La revocation, precedee de la question qui nomme ce qu'elle coupe.
 *
 * Elle est irreversible — le compte se recree, mais avec un nouveau mot de
 * passe — et elle deconnecte quelqu'un qui est peut-etre en train de s'en
 * servir. C'est exactement le cas d'emploi de js/confirmation.js.
 */
async function revoquerDepuisListe(id) {
  const compte = COMPTES.find((c) => c.id === id);
  if (!compte) return;

  const ouvertes = compte.openSessions > 0
    ? `${compte.openSessions} appareil${compte.openSessions > 1 ? 's' : ''} ouvert${compte.openSessions > 1 ? 's' : ''} en ce moment`
    : 'aucun appareil ouvert';

  const accepte = await demanderConfirmation({
    titre: 'Révoquer cet accès',
    phrase: `Retirer l'accès de ${compte.username} à l'espace commerçant ?`,
    lignes: [
      ['Identifiant', compte.username],
      ['Créé le', compte.createdAt ? dateCourte(compte.createdAt.slice(0, 10)) : ''],
      ['Dernière entrée', compte.lastLoginAt ? dateCourte(compte.lastLoginAt.slice(0, 10)) : 'jamais'],
      ['Appareils', ouvertes],
    ],
    consequence: 'Ses sessions se ferment tout de suite, sur tous ses appareils. '
      + 'Les vôtres et celles des autres ne bougent pas. Cette action ne se défait pas.',
    oui: 'Oui, révoquer',
    non: 'Non, le garder',
  });

  if (!accepte) return;

  try {
    await revoquerCompte(id);
    await chargerComptes();
    afficherMessage($('#messageComptes'),
      `L'accès de ${compte.username} est retiré. Ses sessions sont fermées.`, 'bon');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageComptes'), erreur.message);
  }
}
