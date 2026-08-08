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

/** Montre l'ecran de connexion, agenda masque. */
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
 */
async function remettreDemoAZero() {
  const bouton = $('#demoRemiseAZero');
  const message = $('#messageDemo');

  const seul = "Remettre la démonstration dans son état de départ ?\n\n"
    + "Les réglages, les rendez-vous et les photos saisis depuis la dernière "
    + "remise à zéro seront effacés.";
  if (!window.confirm(seul)) return;

  bouton.disabled = true;
  poserTexte(bouton, 'Remise à zéro…');
  afficherMessage(message, '');

  try {
    await reinitialiserDemo();

    // Tout est reconstruit cote serveur : on relit, et on repeint les deux
    // vues. Sans cela, l'agenda garderait les rendez-vous effaces a l'ecran.
    CONFIG = await lireConfig();
    peindreVitrine(CONFIG);
    ESPACE.brouillon = null;
    await chargerAgenda();
    if (ESPACE.volet === 'reglages') await chargerReglages();

    afficherMessage(message, 'La démonstration est repartie de son état de départ.', 'bon');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Remettre à zéro maintenant');
  }
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
    await lireCompte();
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
  afficherEspace(false);
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

  if (nom === 'reglages') chargerReglages();
  if (nom === 'agenda') chargerAgenda();
}

function brancherCompte() {
  $('#formulaireConnexion')?.addEventListener('submit', envoyerConnexion);
  $('#seDeconnecter')?.addEventListener('click', envoyerDeconnexion);
  $('#demoRemiseAZero')?.addEventListener('click', remettreDemoAZero);

  for (const onglet of $$('.espace-onglet')) {
    onglet.addEventListener('click', () => ouvrirVolet(onglet.dataset.volet));
  }
}
