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

  // Le fond ne defile plus derriere le voile : sur telephone, defiler dans une
  // boite fait autrement bouger la page en dessous.
  document.body.style.overflow = 'hidden';

  const premier = $(FOCUSABLES, boite);
  if (premier) premier.focus();
}

function fermerSurimpression(id) {
  const boite = $('#' + id);
  if (!boite) return;

  montrer(boite, false);
  document.body.style.overflow = '';

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
      fermerSurimpression(boite.id);
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

/** Ouvre la surimpression legale sur l'une de ses deux vues. */
function ouvrirLegal(vue) {
  const titre = $('#titreLegal');
  poserTexte(titre, vue === 'confidentialite' ? 'Confidentialité' : 'Mentions légales');

  for (const bloc of $$('[data-legal-vue]')) {
    montrer(bloc, bloc.dataset.legalVue === vue);
  }

  ouvrirSurimpression('surimpressionLegal');
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
  // depuis le tunnel.
  document.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('[data-legal]');
    if (bouton) ouvrirLegal(bouton.dataset.legal);
  });

  $('#fermerLegal')?.addEventListener('click', () => fermerSurimpression('surimpressionLegal'));

  // Un clic sur le voile ferme. Le test `=== boite` compte : sans lui, un clic
  // n'importe ou DANS la boite fermerait aussi, puisque l'evenement remonte.
  for (const boite of $$('.surimpression')) {
    boite.addEventListener('click', (evenement) => {
      if (evenement.target === boite) fermerSurimpression(boite.id);
    });
  }

  for (const bouton of $$('[data-fermer]')) {
    bouton.addEventListener('click', () => fermerSurimpression(bouton.dataset.fermer));
  }
}
