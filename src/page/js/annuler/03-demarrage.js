// ---------------------------------------------------------------------------
// LE DEMARRAGE DE LA PAGE D'ANNULATION.
//
// Deux facons d'arriver ici, et elles ne demandent pas la meme chose :
//
//   /annuler                       le formulaire, en attente de saisie ;
//   /annuler?ref=MQJYBK&jeton=...  le lien du courriel — le jeton prouve tout,
//                                  on va droit au recapitulatif.
//
// ⚠️ LE LIEN N'ANNULE RIEN. Il authentifie, il montre, et il attend. Un lien
//    qui annulerait en etant simplement ouvert s'executerait au premier apercu
//    que fabrique une messagerie ou un antivirus de courrier, et le client
//    verrait son rendez-vous disparaitre sans y avoir touche.
//
// ⚠️ L'ADRESSE EST NETTOYEE DES QU'ELLE EST LUE. Le jeton est un secret de 256
//    bits ; le laisser dans la barre d'adresse, c'est le laisser dans
//    l'historique, dans les onglets partages et dans une capture d'ecran
//    envoyee au salon pour demander de l'aide. `replaceState` l'efface sans
//    recharger la page ni ajouter une entree a l'historique.
// ---------------------------------------------------------------------------

/** Les coordonnees du commerce, pour les quelques champs de la page. */
async function peindreCoordonnees() {
  let config;
  try {
    const reponse = await fetch('/api/config', { credentials: 'same-origin' });
    config = await reponse.json();
  } catch {
    // Le contenu de secours ecrit dans le balisage reste affiche : un nom de
    // commerce un peu ancien vaut mieux qu'un trou dans la page.
    return;
  }

  const salon = config?.salon;
  if (!salon) return;

  for (const element of $$('[data-champ="nom"]')) poserTexte(element, salon.name);

  for (const element of $$('[data-champ="telephone"]')) {
    poserTexte(element, salon.phone);
    if (element.tagName === 'A') {
      element.href = 'tel:' + salon.phone.replace(/[^\d+]/g, '');
    }
  }
}

/** Ce que l'adresse porte : la reference et, s'il vient du courriel, le jeton. */
function lireAdresse() {
  const parametres = new URLSearchParams(window.location.search);
  return {
    reference: parametres.get('ref') || '',
    jeton: parametres.get('jeton') || '',
  };
}

/** Efface la reference et le jeton de la barre d'adresse, sans recharger. */
function nettoyerAdresse() {
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    // Un navigateur qui refuse : sans consequence, le jeton reste visible.
  }
}

/** Le chemin du lien direct : le jeton se suffit a lui-meme. */
async function ouvrirDepuisLeLien(reference, jeton) {
  PREUVE.reference = reference;
  PREUVE.telephone = '';
  PREUVE.jeton = jeton;

  try {
    const reponse = await retrouverRendezVous();
    montrerFiche(reponse.rendezVous);
  } catch (erreur) {
    // Le lien ne vaut plus rien : base remise a zero, rendez-vous supprime par
    // le salon, lien tronque par une messagerie. On retombe sur le formulaire
    // avec la reference deja remplie — c'est la seule chose du lien qui reste
    // utilisable, et elle epargne au client de la rechercher.
    const champ = $('#champReference');
    if (champ) champ.value = reference;

    afficherMessage($('#messageRecherche'), erreur.message);
    montrerEcran('ecranSaisie');
    $('#champTelephone')?.focus();
  }
}

/**
 * Le rappel du rendez-vous que ce navigateur garde, au-dessus du formulaire.
 *
 * >>> LE CLIENT RETAPAIT UNE REFERENCE QU'IL AVAIT SOUS LA MAIN. <<< Le
 * rendez-vous est memorise depuis la reservation (`letabli.rdv`,
 * js/00-memoire.js) — c'est ce qui affiche « Votre rendez-vous » en haut de la
 * vitrine — et cette page-ci, ou l'on vient precisement pour ce rendez-vous-la,
 * presentait un formulaire vide.
 *
 * ⚠️ IL NE REMPLIT QUE LA REFERENCE, et laisse les quatre chiffres a saisir.
 *    C'est le second facteur : sur un appareil partage, le rappel dirait sinon
 *    a n'importe qui comment annuler le rendez-vous du proprietaire.
 *
 * ⚠️ RIEN N'EST DEMANDE AU SERVEUR ICI. Le rendez-vous garde peut avoir ete
 *    annule par le salon entre-temps ; le verifier demanderait justement les
 *    quatre chiffres qu'on ne veut pas deviner. La verite arrive une phrase
 *    plus tard, quand le client valide.
 */
function peindreRappelMemoire() {
  const bloc = $('#rappelMemoire');
  const bouton = $('#rappelMemoireBouton');
  if (!bloc || !bouton) return;

  // `rendezVousRetenus()` fait le menage des rendez-vous passes au passage, et
  // rend le plus proche en premier.
  const rdv = rendezVousRetenus()[0];
  if (!rdv) return;

  const quand = `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}`;
  poserTexte(bouton, `Votre rendez-vous du ${quand}`);

  bouton.addEventListener('click', () => {
    const champ = $('#champReference');
    if (champ) champ.value = rdv.reference;
    $('#champTelephone')?.focus();
  });

  montrer(bloc, true);
}

function brancher() {
  $('#formulaireRecherche')?.addEventListener('submit', chercher);

  $('#boutonVersAnnulation')?.addEventListener('click', () => {
    peindreFiche($('#confirmationRendezVous'), RENDEZ_VOUS);
    afficherMessage($('#messageConfirmation'), '');
    montrerEcran('ecranConfirmation');
  });

  $('#boutonRenoncer')?.addEventListener('click', () => {
    afficherMessage($('#messageFiche'), '');
    montrerEcran('ecranFiche');
  });

  $('#boutonAnnulerVraiment')?.addEventListener('click', annulerVraiment);
  $('#boutonDeplacer')?.addEventListener('click', partirDeplacer);
}

function demarrer() {
  brancher();
  peindreCoordonnees();

  const { reference, jeton } = lireAdresse();

  if (reference && jeton) {
    nettoyerAdresse();
    ouvrirDepuisLeLien(reference, jeton);
    return;
  }

  // Une reference sans jeton : on la pose dans le champ et on demande les
  // quatre chiffres. C'est le cas d'un lien recopie a la main, ou tronque.
  if (reference) {
    nettoyerAdresse();
    const champ = $('#champReference');
    if (champ) champ.value = reference;
    $('#champTelephone')?.focus();
    return;
  }

  // Personne n'est arrive par un lien : ce navigateur sait peut-etre de quel
  // rendez-vous il s'agit.
  peindreRappelMemoire();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer);
} else {
  demarrer();
}
