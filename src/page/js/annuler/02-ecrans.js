// ---------------------------------------------------------------------------
// LES QUATRE ECRANS DE LA PAGE D'ANNULATION.
//
// saisie -> fiche -> confirmation -> fini. Un seul visible a la fois.
//
// LA REGLE QUI GOUVERNE CE FICHIER : ON NE DIT RIEN AVANT D'AVOIR MONTRE. Le
// client voit son rendez-vous — prestation, jour, heure, avec qui — avant que
// le mot « annuler » ne devienne cliquable, et une seconde fois avant que
// l'annulation ne parte. Une annulation ne se defait pas ; deux ecrans de plus
// coutent quatre secondes, se tromper coute un rendez-vous.
// ---------------------------------------------------------------------------

const ECRANS = ['ecranSaisie', 'ecranFiche', 'ecranConfirmation', 'ecranFini'];

/** Le rendez-vous retrouve, tel que le serveur le decrit. */
let RENDEZ_VOUS = null;

function montrerEcran(id) {
  for (const nom of ECRANS) montrer($('#' + nom), nom === id);

  // Le titre de l'ecran reprend le focus : sans cela, quelqu'un au clavier ou
  // au lecteur d'ecran reste au bouton qu'il vient de quitter, dans un ecran
  // qui n'existe plus a l'affichage.
  const titre = $('#' + id)?.querySelector('h2, .intro');
  if (titre) {
    titre.setAttribute('tabindex', '-1');
    titre.focus({ preventScroll: true });
  }
}

// >>> `afficherMessage()` N'EST PLUS REDEFINIE ICI. <<<
//
// Elle l'etait, mot pour mot identique a celle de js/02-utilitaires.js, que ce
// document charge deja. La copie l'emportait — meme portee, declaration plus
// tardive — si bien que la version partagee ne servait a rien sur cette page.
// C'est passe inapercu tant que les deux etaient identiques ; le jour ou l'une
// a recu `role="alert"` (lot 5), cette page serait restee muette pour un
// lecteur d'ecran, sans que rien ne le signale.

// --- LA FICHE ---------------------------------------------------------------

/**
 * Le recapitulatif, dans la meme fiche de travail que le tunnel.
 *
 * ⚠️ MEME BALISAGE QUE `peindreFiche()` de js/07-tunnel.js, et ce n'est pas une
 *    coincidence : c'est la meme information, dans la meme forme, et le client
 *    l'a deja vue une fois a la reservation. Les deux doivent le rester — si
 *    l'une change, changer l'autre.
 */
function peindreFiche(cible, rdv) {
  if (!cible || !rdv) return;

  const lignes = [];

  if (rdv.serviceName) lignes.push(['Prestation', rdv.serviceName]);
  lignes.push(['Durée', fmtDuree(rdv.duration)]);
  if (rdv.staffName) lignes.push(['Avec', rdv.staffName]);
  lignes.push(['Quand', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)}`]);
  if (rdv.price !== null) lignes.push(['À régler sur place', fmtPrix(rdv.price)]);
  lignes.push(['Référence', rdv.reference]);

  cible.innerHTML = lignes.map(([intitule, valeur]) => {
    const appui = intitule === 'À régler sur place' ? ' class="appui"' : '';
    return `<div${appui}><dt>${esc(intitule)}</dt><dd>${esc(valeur)}</dd></div>`;
  }).join('');
}

/**
 * L'ecran du recapitulatif, et ce qu'on y propose.
 *
 * Un rendez-vous passe ou deja annule s'affiche quand meme — c'est bien le sien,
 * il a le droit de le voir — mais sans aucun bouton : il n'y a plus rien a en
 * faire, et un bouton qui ne peut que refuser vaut moins qu'une phrase.
 */
function montrerFiche(rdv) {
  RENDEZ_VOUS = rdv;

  peindreFiche($('#ficheRendezVous'), rdv);

  const actions = $('#ficheActions');
  const message = $('#messageFiche');

  if (rdv.cancelledAt) {
    poserTexte($('#ficheIntro'), 'Ce rendez-vous a déjà été annulé.');
    afficherMessage(message, 'Le créneau est reparti. Vous pouvez en prendre un autre quand vous voulez.');
    montrer(actions, false);
  } else if (rdv.past) {
    poserTexte($('#ficheIntro'), 'Ce rendez-vous est déjà passé.');
    afficherMessage(message, "Il n'y a plus rien à annuler ni à déplacer.");
    montrer(actions, false);
  } else {
    poserTexte($('#ficheIntro'), 'Voici ce qui est réservé à votre nom.');
    afficherMessage(message, '');
    montrer(actions, true);
  }

  montrerEcran('ecranFiche');
}

// --- ECRAN 1 : retrouver ----------------------------------------------------

async function chercher(evenement) {
  evenement?.preventDefault();

  const bouton = $('#boutonRecherche');
  const message = $('#messageRecherche');

  const reference = $('#champReference')?.value.trim() ?? '';
  const telephone = $('#champTelephone')?.value.trim() ?? '';

  // Deux controles seulement, et ils ne servent qu'a eviter un aller-retour
  // inutile : c'est le serveur qui decide, et lui ne dit jamais lequel des deux
  // champs est en cause.
  if (!reference) return signaler('champReference', 'aideReference', 'Entrez votre référence.');
  if (telephone.replace(/\D/g, '').length !== 4) {
    return signaler('champTelephone', 'aideTelephone', 'Les quatre derniers chiffres de votre numéro.');
  }

  effacer('champReference', 'aideReference', 'Six caractères, par exemple MQJYBK.');
  effacer('champTelephone', 'aideTelephone', "Celui que vous avez laissé en réservant. Il évite qu'un inconnu tombe sur votre rendez-vous en essayant des références au hasard.");

  PREUVE.reference = reference;
  PREUVE.telephone = telephone;
  PREUVE.jeton = '';

  bouton.disabled = true;
  poserTexte(bouton, 'Recherche…');
  afficherMessage(message, '');

  try {
    const reponse = await retrouverRendezVous();
    montrerFiche(reponse.rendezVous);
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Retrouver mon rendez-vous');
  }
}

/**
 * Un champ refuse : le filet change, la phrase d'aide dit pourquoi, le focus y
 * revient — ET le lecteur d'ecran l'apprend.
 *
 * C'est ce dernier point qui manquait : ni `aria-invalid`, ni
 * `aria-describedby`, nulle part. Tout est desormais dans `marquerRefus()`
 * (js/02-utilitaires.js), partage par cette page, le tunnel et l'espace.
 */
function signaler(champId, aideId, texte) {
  const champ = $('#' + champId);
  poserTexte($('#' + aideId), texte);
  marquerRefus(champ, true, aideId);
  champ?.focus();
}

function effacer(champId, aideId, texteDeRepos) {
  marquerRefus($('#' + champId), false, aideId);
  poserTexte($('#' + aideId), texteDeRepos);
}

// --- ECRAN 3 : annuler pour de bon ------------------------------------------

async function annulerVraiment() {
  const bouton = $('#boutonAnnulerVraiment');
  const message = $('#messageConfirmation');

  bouton.disabled = true;
  poserTexte(bouton, 'Annulation…');
  afficherMessage(message, '');

  try {
    const reponse = await annulerRendezVous();
    RENDEZ_VOUS = reponse.rendezVous;

    // Le rappel garde en memoire par la vitrine ne vaut plus rien : ce
    // rendez-vous n'existe plus. Le retirer ICI evite qu'un bandeau
    // « votre rendez-vous mardi 11 » reapparaisse au prochain passage.
    oublierRendezVous(RENDEZ_VOUS.reference);

    poserTexte($('#finiTitre'), "C'est annulé");
    poserTexte($('#finiPhrase'),
      `Le rendez-vous du ${dateLongue(RENDEZ_VOUS.date)} à ${fmtHeure(RENDEZ_VOUS.start)} est annulé. `
      + 'Le créneau repart à quelqu\'un d\'autre.');
    montrerEcran('ecranFini');
  } catch (erreur) {
    // Deja annule, deja passe : le serveur joint le rendez-vous a ces refus-la.
    // On repasse alors a la fiche, qui dira la meme chose en le montrant.
    if (erreur.rendezVous) {
      montrerFiche(erreur.rendezVous);
      afficherMessage($('#messageFiche'), erreur.message);
    } else {
      afficherMessage(message, erreur.message);
    }
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Oui, annuler');
  }
}

// --- LE DEPLACEMENT ---------------------------------------------------------

/**
 * Deplacer, c'est retourner dans le tunnel — pas en refaire un ici.
 *
 * Le tunnel sait deja dessiner un calendrier, ranger les creneaux par
 * demi-journee, et grimer les jours fermes. En recopier une version allegee sur
 * cette page donnerait deux calendriers a maintenir, dont un que personne ne
 * regarderait jamais.
 *
 * ⚠️ LA PREUVE PASSE PAR `sessionStorage`, JAMAIS PAR L'ADRESSE. Quatre
 *    chiffres d'un numero de telephone dans une URL, c'est une donnee
 *    personnelle dans l'historique du navigateur, dans les journaux du serveur
 *    et dans le champ « referer » de la requete suivante. `sessionStorage` est
 *    lie a l'onglet, il disparait a sa fermeture, et il ne franchit pas la
 *    barre d'adresse.
 */
function partirDeplacer() {
  try {
    sessionStorage.setItem('letabli.deplacement', JSON.stringify({
      reference: RENDEZ_VOUS.reference,
      telephone: PREUVE.telephone,
      jeton: PREUVE.jeton,
    }));
  } catch {
    // Navigation privee, stockage plein, stockage refuse : on ne bloque pas le
    // client pour autant. Le tunnel s'ouvrira sans rien savoir du deplacement,
    // il prendra un nouveau rendez-vous, et l'ancien restera annulable ici.
  }

  window.location.href = '/#reserver';
}
