// ---------------------------------------------------------------------------
// LA NAVIGATION — les surimpressions, et le passage entre vitrine et espace.
// ---------------------------------------------------------------------------

/** Ce qu'il faudra rendre au clavier quand la surimpression se fermera. */
let elementAvantSurimpression = null;

/** Ce qui peut recevoir le focus a l'interieur d'une boite. */
const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]),'
  + ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ouvre une surimpression.
 *
 * TROIS CHOSES QUI NE SE VOIENT PAS MAIS SANS LESQUELLES C'EST INUTILISABLE :
 * le focus entre dans la boite, il n'en sort pas tant qu'elle est ouverte, et
 * il revient d'ou il venait a la fermeture. Sans la premiere, un lecteur
 * d'ecran continue de lire la page du dessous ; sans la deuxieme, la tabulation
 * s'echappe derriere le voile ; sans la troisieme, on se retrouve renvoye en
 * haut du document.
 */
function ouvrirSurimpression(id) {
  const boite = $('#' + id);
  if (!boite) return;

  elementAvantSurimpression = document.activeElement;
  montrer(boite, true);
  bloquerLeDefilement(true);

  const premier = $(FOCUSABLES, boite);
  if (premier) premier.focus();
}

/**
 * Empeche la page de defiler derriere le voile.
 *
 * ⚠️ SUR `<html>`, ET PLUS SUR `<body>`. C'etait `document.body.style.overflow
 *    = 'hidden'`, et cette ligne ne faisait plus rien : le navigateur ne fait
 *    remonter l'overflow du body a la fenetre que si le `<html>` a le sien a
 *    `visible`. Or styles/03-fondations.css pose `html { overflow-x: clip }`,
 *    la ligne du garde-fou horizontal. La propagation etait coupee, et
 *    l'arriere-plan defilait derriere chaque fenetre — molette et geste
 *    tactile.
 *
 * ⚠️ LA BARRE DE DEFILEMENT EST COMPENSEE. La faire disparaitre elargit la
 *    page d'une quinzaine de pixels, et tout le contenu saute lateralement au
 *    moment ou la fenetre s'ouvre. On rend cette largeur en marge interieure,
 *    et on la reprend a la fermeture.
 */
function bloquerLeDefilement(bloquer) {
  const racine = document.documentElement;

  if (bloquer) {
    const barre = window.innerWidth - racine.clientWidth;
    if (barre > 0) document.body.style.paddingRight = `${barre}px`;
    racine.classList.add('sans-defilement');
    return;
  }

  racine.classList.remove('sans-defilement');
  document.body.style.paddingRight = '';
}

function fermerSurimpression(id) {
  const boite = $('#' + id);
  if (!boite) return;

  montrer(boite, false);

  // Une seule fenetre a la fois dans ce site, mais la verification coute une
  // ligne : rendre le defilement alors qu'une autre boite est encore ouverte
  // ferait defiler la page derriere elle.
  if (!surimpressionOuverte()) bloquerLeDefilement(false);

  if (elementAvantSurimpression) {
    elementAvantSurimpression.focus();
    elementAvantSurimpression = null;
  }
}

/** La surimpression ouverte, s'il y en a une. */
function surimpressionOuverte() {
  return $$('.surimpression').find((boite) => !boite.hidden) || null;
}

/**
 * Le clavier, pour toutes les surimpressions a la fois.
 *
 * Un seul ecouteur pose sur le document plutot qu'un par boite : les regles sont
 * les memes partout, et c'est ce qui garantit qu'une boite ajoutee plus tard les
 * aura sans que personne n'y pense.
 */
function brancherClavierSurimpression() {
  document.addEventListener('keydown', (evenement) => {
    const boite = surimpressionOuverte();
    if (!boite) return;

    if (evenement.key === 'Escape') {
      fermerSurimpressionAuto(boite.id);
      return;
    }

    if (evenement.key !== 'Tab') return;

    // Le focus tourne en boucle a l'interieur de la boite.
    const cibles = $$(FOCUSABLES, boite).filter((e) => e.offsetParent !== null);
    if (!cibles.length) return;

    const premier = cibles[0];
    const dernier = cibles[cibles.length - 1];

    if (evenement.shiftKey && document.activeElement === premier) {
      evenement.preventDefault();
      dernier.focus();
    } else if (!evenement.shiftKey && document.activeElement === dernier) {
      evenement.preventDefault();
      premier.focus();
    }
  });
}

// --- LES MENTIONS LEGALES ---------------------------------------------------
//
// >>> DE VRAIES ADRESSES, /mentions-legales ET /confidentialite (lot D,
// point D3). <<< Le bouton qui ouvrait la surimpression n'avait pas
// d'adresse : ni partageable, ni indexable, ni ouvrable dans un nouvel onglet.
// Le serveur sait desormais servir ces deux adresses directement, la
// surimpression deja ouverte (src/lib/page.js, `ouvrirLegalDansLaPage()`).
//
// CE QUI SUIT NE FAIT QU'EVITER LE RECHARGEMENT quand on clique DEPUIS une
// page deja ouverte : `history.pushState()` change l'adresse sans naviguer, et
// `ouvrirLegal()` fait ce que le serveur aurait fait. `legalPousseParNous`
// distingue les deux facons d'arriver ici — ELLE DECIDE COMMENT FERMER :
//
//   - venu d'un clic (etat pousse par nous) : fermer, c'est REVENIR EN
//     ARRIERE (`history.back()`), pour que l'adresse redevienne celle d'avant
//     le clic. Le `popstate` qui en resulte fait le menage.
//   - arrive directement sur /mentions-legales ou /confidentialite (lien
//     partage, favori, robot) : il n'y a rien a "revenir en arriere" —
//     `history.back()` sortirait du site. Fermer pousse alors une nouvelle
//     adresse, `/`.

/** Vrai si l'entree d'historique courante a ete posee par un clic ICI. */
let legalPousseParNous = false;

/** Ouvre la surimpression legale sur l'une de ses deux vues. */
function ouvrirLegal(vue) {
  const titre = $('#titreLegal');
  poserTexte(titre, vue === 'confidentialite' ? 'Confidentialité' : 'Mentions légales');

  for (const bloc of $$('[data-legal-vue]')) {
    montrer(bloc, bloc.dataset.legalVue === vue);
  }

  ouvrirSurimpression('surimpressionLegal');
}

/** Le clic sur un lien `[data-legal]` : ouvre sans recharger. */
function ouvrirLegalDepuisLien(vue, href) {
  history.pushState({ legal: vue }, '', href);
  legalPousseParNous = true;
  ouvrirLegal(vue);
}

/** La fermeture de la surimpression legale — voir le commentaire plus haut. */
function fermerLegal() {
  if (legalPousseParNous) {
    history.back();
  } else {
    history.pushState(null, '', '/');
    fermerSurimpression('surimpressionLegal');
  }
}

/**
 * Ouvre la vue legale correspondant a l'adresse actuelle, si elle y
 * correspond. Appelee au demarrage : le serveur a deja tout ecrit pour
 * /mentions-legales et /confidentialite, ce n'est qu'une remise a jour
 * (meme raison que `peindrePhotos()` repeint une galerie deja servie).
 */
function ouvrirLegalDepuisAdresse() {
  const vue = { '/mentions-legales': 'mentions', '/confidentialite': 'confidentialite' }[location.pathname];
  if (vue) ouvrirLegal(vue);
}

/**
 * Ferme UNE surimpression, quelle qu'elle soit.
 *
 * La legale a sa propre fermeture, qui tient compte de l'adresse
 * (`fermerLegal()` ci-dessus) ; les autres surimpressions — celles de l'espace
 * commercant, qui partage ce fichier — se ferment simplement.
 */
function fermerSurimpressionAuto(id) {
  if (id === 'surimpressionLegal') fermerLegal();
  else fermerSurimpression(id);
}

// --- LA VITRINE ET L'ESPACE -------------------------------------------------
//
// >>> IL N'Y A PLUS DE BASCULE. <<<
//
// Ce fichier portait `afficherEspace(visible)`, qui masquait la vitrine pour
// montrer l'agenda dans le MEME document. C'est ce qui obligeait a servir le
// balisage, le style et le JavaScript de l'espace commercant a chaque visiteur
// — 35 % du poids de la page (lot 4).
//
// L'espace est desormais un document a part, servi par /espace-salon. Passer de
// l'un a l'autre est une vraie navigation : le « precedent » du navigateur
// fonctionne, l'adresse se met en favori, et rien de l'agenda ne voyage avec la
// vitrine.
//
// Ce fichier est partage par les DEUX documents : il ne contient plus que les
// surimpressions, dont les deux se servent. Les `?.` font le reste — la vitrine
// n'a pas de formulaire de rendez-vous, l'espace n'a pas de mentions legales,
// et chacun ne branche que ce qu'il possede.

function brancherNavigation() {
  brancherClavierSurimpression();

  // Les mentions legales et la confidentialite, depuis le pied de page comme
  // depuis le tunnel. Ce sont de vrais `<a href>` (lot D, D3) : un clic
  // ordinaire les intercepte pour eviter un rechargement ; un clic du milieu,
  // un Ctrl+clic ou un clic droit « Ouvrir dans un nouvel onglet » les laisse
  // filer normalement — `ctrlKey`/`metaKey`/`button` sont ceux qu'un
  // navigateur utilise pour ces gestes.
  document.addEventListener('click', (evenement) => {
    const lien = evenement.target.closest('[data-legal]');
    if (!lien || evenement.defaultPrevented) return;
    if (evenement.button !== 0 || evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return;

    evenement.preventDefault();
    ouvrirLegalDepuisLien(lien.dataset.legal, lien.getAttribute('href'));
  });

  // L'adresse peut deja designer une page legale a l'arrivee (lien partage,
  // favori, robot) : le serveur a tout ecrit, ceci ne fait que le confirmer.
  ouvrirLegalDepuisAdresse();

  // Precedent/suivant du navigateur : rouvre ou referme la legale selon que
  // l'etat qu'on y retrouve la designe ou non.
  window.addEventListener('popstate', (evenement) => {
    if (evenement.state?.legal) {
      legalPousseParNous = true;
      ouvrirLegal(evenement.state.legal);
    } else if (surimpressionOuverte()?.id === 'surimpressionLegal') {
      legalPousseParNous = false;
      fermerSurimpression('surimpressionLegal');
    }
  });

  $('#fermerLegal')?.addEventListener('click', () => fermerLegal());

  // Un clic sur le voile ferme. Le test `=== boite` compte : sans lui, un clic
  // n'importe ou DANS la boite fermerait aussi, puisque l'evenement remonte.
  for (const boite of $$('.surimpression')) {
    boite.addEventListener('click', (evenement) => {
      if (evenement.target === boite) fermerSurimpressionAuto(boite.id);
    });
  }

  for (const bouton of $$('[data-fermer]')) {
    bouton.addEventListener('click', () => fermerSurimpressionAuto(bouton.dataset.fermer));
  }
}
