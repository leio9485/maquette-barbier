// ---------------------------------------------------------------------------
// LE TUNNEL DE RESERVATION
//
//     01 PRESTATION -> 02 DATE ET HEURE -> 03 COORDONNEES -> 04 C'EST RESERVE
//
// AUCUN CRENEAU N'EST CALCULE ICI. Le navigateur demande (/api/days, /api/slots)
// et affiche. C'est le serveur qui sait quels creneaux existent, et c'est lui
// qui refusera un rendez-vous impossible — un visiteur peut modifier ce qui
// tourne dans son navigateur, pas ce qui tourne sur le serveur.
//
// LES COLLISIONS SONT LE CAS QUI COMPTE. Entre le moment ou l'on voit « 16h45 »
// et celui ou l'on valide, quelqu'un d'autre a pu le prendre. Le serveur repond
// alors 409 avec une phrase en francais : on revient a l'etape 2, la journee
// deja chargee, et on affiche ce qu'il reste. Jamais d'erreur brute, jamais de
// retour au depart.
// ---------------------------------------------------------------------------

const NOMS_ETAPES = { 1: 'Prestation', 2: 'Date et heure', 3: 'Coordonnées', 4: "C'est réservé" };

// --- Le passage d'une etape a l'autre ---------------------------------------

function allerEtape(numero, { defiler = true } = {}) {
  RESERVATION.etape = numero;

  for (const etape of $$('.etape')) {
    montrer(etape, Number(etape.dataset.etape) === numero);
  }

  // LA FRISE. Trois etats : franchie, en cours, a venir. `aria-current="step"`
  // est le mot que les lecteurs d'ecran annoncent — la seule mise en forme ne
  // s'entend pas, et c'est justement l'information qui manquait le plus.
  for (const cellule of $$('.frise-etape')) {
    const rang = Number(cellule.dataset.frise);
    cellule.toggleAttribute('data-fait', rang < numero);
    if (rang === numero) cellule.setAttribute('aria-current', 'step');
    else cellule.removeAttribute('aria-current');
  }

  if (defiler) {
    // On remonte en haut de la section, pas en haut de la page : le bandeau
    // d'etat reste visible, et le titre de l'etape est la premiere chose lue.
    $('#reserver')?.scrollIntoView({ block: 'start' });
  }

  // Le premier titre de l'etape recoit le focus : sans cela, un lecteur d'ecran
  // continuerait d'annoncer l'etape precedente, et le clavier repartirait du
  // haut du document a la tabulation suivante.
  const titre = $(`.etape[data-etape="${numero}"] h2`);
  if (titre) {
    titre.setAttribute('tabindex', '-1');
    titre.focus({ preventScroll: true });
  }
}

// --- ETAPE 1 : la prestation ------------------------------------------------

function choisirPrestation(id) {
  const prestation = CONFIG?.services.find((s) => s.id === id);
  if (!prestation) return;

  RESERVATION.prestation = prestation;
  RESERVATION.date = '';
  RESERVATION.creneau = null;

  poserTexte($('#rappelPrestation'),
    `${prestation.name} · ${fmtDuree(prestation.duration)} · ${fmtPrix(prestation.price)}`);

  peindreQui();

  RESERVATION.mois = premierDuMois(aujourdhui());

  allerEtape(2);
  chargerMois();
}

// --- ETAPE 2 : AVEC QUI -----------------------------------------------------

/**
 * Le choix « avec qui ? », APRES le jour.
 *
 * « Peu importe » est presélectionné et donne le plus de creneaux : c'est la
 * reponse de la grande majorite des clients, et lui consacrer une etape entiere
 * coute un abandon a chaque reservation.
 *
 * Le bloc disparait quand le commerce travaille seul, ou quand une seule
 * personne assure la prestation choisie : la question n'aurait alors qu'une
 * reponse possible.
 */
function peindreQui() {
  const bloc = $('#champQui');
  const choix = $('#tunnelQuiChoix');
  if (!bloc || !choix || !CONFIG) return;

  const prestation = RESERVATION.prestation;

  // La regle se lit depuis la prestation : personne ne l'a cochee = tout le
  // monde l'assure. Elle est appliquee ici comme cote serveur.
  const equipe = CONFIG.staff.filter((p) => {
    if (p.active === false) return false;
    if (!prestation) return true;
    const cochee = CONFIG.staff.some((autre) => autre.services.includes(prestation.id));
    return cochee ? p.services.includes(prestation.id) : true;
  });

  if (equipe.length < 2) {
    montrer(bloc, false);
    RESERVATION.staffId = '';
    return;
  }

  montrer(bloc, true);

  choix.innerHTML = '<input type="radio" name="staff" id="staff-peu-importe" value="" checked>'
    + '<label for="staff-peu-importe">Peu importe</label>'
    + equipe.map((p) => `<input type="radio" name="staff" id="staff-${esc(p.id)}" value="${esc(p.id)}">`
      + `<label for="staff-${esc(p.id)}">${esc(p.name)}</label>`).join('');

  RESERVATION.staffId = '';
}

// --- ETAPE 2 : LE CALENDRIER ------------------------------------------------

function premierDuMois(iso) {
  const d = versDate(iso);
  return versIso(new Date(d.getFullYear(), d.getMonth(), 1, 12));
}

function moisSuivantDe(iso, pas) {
  const d = versDate(iso);
  return versIso(new Date(d.getFullYear(), d.getMonth() + pas, 1, 12));
}

/**
 * Demande au serveur l'etat de chaque journee du mois affiche, puis dessine.
 *
 * UN SEUL APPEL POUR TOUT LE MOIS, et c'est la raison d'etre de /api/days :
 * passer par /api/slots demanderait trente allers-retours a chaque changement
 * de mois — et il y en a un a chaque fois qu'on change de personne, puisque les
 * disponibilites ne sont plus les memes.
 */
async function chargerMois() {
  const grille = $('#calendrierGrille');
  if (!grille || !RESERVATION.prestation) return;

  const debutMois = RESERVATION.mois;
  const d = versDate(debutMois);
  poserTexte($('#calendrierMois'), `${MOIS_LONGS[d.getMonth()]} ${d.getFullYear()}`);

  // On ne demande jamais le passe : la fenetre commence aujourd'hui si le mois
  // affiche est le mois courant.
  const premier = debutMois < aujourdhui() ? aujourdhui() : debutMois;
  const dernier = versIso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));

  // Le mois precedent est interdit des qu'il est entierement passe.
  const precedent = $('#moisPrecedent');
  if (precedent) precedent.disabled = moisSuivantDe(debutMois, -1) < premierDuMois(aujourdhui());

  let etats = new Map();
  try {
    const reponse = await lireJours(premier, dernier, RESERVATION.prestation.id, RESERVATION.staffId);
    etats = new Map(reponse.days.map((j) => [j.date, j.state]));
  } catch {
    // Le calendrier s'affiche quand meme, toutes journees cliquables : le
    // serveur dira au clic ce qu'il en est. Mieux vaut un calendrier un peu
    // optimiste qu'un mois vide et un message d'erreur.
  }

  peindreCalendrier(debutMois, etats);

  // LE JOUR RETENU RESTE RETENU tant qu'il est encore ouvert : changer de
  // personne ne doit pas effacer la date qu'on venait de choisir. S'il ne l'est
  // plus — cette personne ne travaille pas ce jour-la — on retombe sur le
  // premier jour libre du mois affiche, et les creneaux suivent.
  const ouverts = [...etats.entries()]
    .filter(([iso, etat]) => etat === 'open' && iso >= aujourdhui())
    .map(([iso]) => iso)
    .sort();

  const retenu = ouverts.includes(RESERVATION.date) ? RESERVATION.date : ouverts[0];

  if (retenu) {
    await chargerCreneaux(retenu);
  } else {
    // Aucun jour libre ce mois-ci : on le dit, et on efface les creneaux du
    // mois precedent plutot que de les laisser a l'ecran.
    RESERVATION.date = '';
    montrer($('#tunnelCreneaux'), false);
    afficherMessage($('#creneauxMessage'), RESERVATION.staffId
      ? "Cette personne n'a aucune disponibilité ce mois-ci. Essayez « peu importe », ou le mois suivant."
      : "Aucune disponibilité ce mois-ci. Essayez le mois suivant.");
  }
}

function peindreCalendrier(debutMois, etats) {
  const grille = $('#calendrierGrille');
  if (!grille) return;

  const d = versDate(debutMois);
  const nbJours = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

  // Les cases vides avant le 1er : la semaine commence le lundi.
  const decalage = (versDate(debutMois).getDay() + 6) % 7;

  const cases = [];
  for (let i = 0; i < decalage; i++) cases.push('<span></span>');

  const jourCourant = aujourdhui();

  for (let numero = 1; numero <= nbJours; numero++) {
    const iso = versIso(new Date(d.getFullYear(), d.getMonth(), numero, 12));
    const etat = etats.get(iso);

    const passe = iso < jourCourant;
    const indisponible = passe || !etat || etat !== 'open';

    // Le motif est annonce aux lecteurs d'ecran : « complet » et « fermé » ne se
    // devinent pas au gris de la case.
    const raison = passe ? 'passé'
      : etat === 'closed' ? 'fermé'
      : etat === 'full' ? 'complet'
      : '';

    const etiquette = `${dateLongue(iso)}${raison ? ' — ' + raison : ''}`;

    cases.push(`<button type="button" class="calendrier-jour" data-date="${esc(iso)}"`
      + ` aria-pressed="${RESERVATION.date === iso}"`
      + ` aria-label="${esc(etiquette)}"`
      + (iso === jourCourant ? ' data-aujourdhui' : '')
      + (indisponible ? ' disabled' : '')
      + `>${numero}</button>`);
  }

  grille.innerHTML = cases.join('');
}

// --- ETAPE 2 : LES CRENEAUX -------------------------------------------------

/** La coupure matin / apres-midi, en minutes depuis minuit.
 *
 * ⚠️ `start` EST UN NOMBRE DE MINUTES DEPUIS MINUIT, pas un horodatage. 510
 *    vaut 8h30, 990 vaut 16h30. Le passer a `new Date()` donne le 1er janvier
 *    1970 a 1h du matin pour toutes les valeurs — les trente-trois creneaux
 *    d'un samedi se retrouvaient alors tous dans « Matin ». */
const MINUTES_MIDI = 13 * 60;

/**
 * Les creneaux d'un jour, ranges par demi-journee.
 *
 * Une journee ouverte de 8h30 a 21h en donne trente-trois. En une seule grille
 * c'est un mur de chiffres ou l'on ne trouve pas « vers 18h » sans le chercher
 * case par case ; coupes a 13h, ce sont deux listes courtes.
 *
 * La coupure est a 13h et non a midi : chez un barbier la pause de midi est
 * dans le creux, et « 12h45 » appartient a la matinee pour qui reserve.
 */
function grouperCreneaux(creneaux) {
  return [
    { nom: 'Matin', liste: creneaux.filter((c) => c.start < MINUTES_MIDI) },
    { nom: 'Après-midi', liste: creneaux.filter((c) => c.start >= MINUTES_MIDI) },
  ].filter((g) => g.liste.length > 0);
}

/**
 * Un creneau.
 *
 * LES CRENEAUX PRIS RESTENT AFFICHES, barres et eteints. Les retirer donnerait
 * une liste qui saute de 14h00 a 16h30 et laisserait croire a une erreur ; les
 * montrer barres dit « c'est un jour charge », ce qui est l'information vraie.
 */
function htmlCreneau(c) {
  const etiquette = c.free ? c.label : `${c.label} — déjà pris`;
  return `<button type="button" class="creneau" data-creneau="${c.start}"`
    + ` aria-pressed="false" aria-label="${esc(etiquette)}"`
    + (c.free ? '' : ' disabled')
    + `>${esc(c.label)}</button>`;
}

/** Les heures d'un jour, pour la prestation et la personne retenues. */
async function chargerCreneaux(date) {
  const bloc = $('#tunnelCreneaux');
  const grille = $('#creneauxGroupes');
  const message = $('#creneauxMessage');
  if (!bloc || !grille || !RESERVATION.prestation) return;

  RESERVATION.date = date;
  RESERVATION.creneau = null;

  montrer(bloc, true);
  poserTexte($('#creneauxTitre'), dateLongue(date));
  afficherMessage(message, '');

  for (const jour of $$('.calendrier-jour')) {
    jour.setAttribute('aria-pressed', String(jour.dataset.date === date));
  }

  let reponse;
  try {
    reponse = await lireCreneaux(date, RESERVATION.prestation.id, RESERVATION.staffId);
  } catch (erreur) {
    grille.innerHTML = '';
    afficherMessage(message, erreur.message);
    return;
  }

  const libres = reponse.slots.filter((c) => c.free);

  if (!reponse.slots.length) {
    grille.innerHTML = '';
    afficherMessage(message, "Rien ce jour-là. Choisissez une autre date.");
    return;
  }

  if (!libres.length) {
    grille.innerHTML = '';
    afficherMessage(message, RESERVATION.staffId
      ? "Cette personne est complète ce jour-là. Essayez « peu importe », ou un autre jour."
      : "La journée est complète. Choisissez une autre date.");
    return;
  }

  grille.innerHTML = grouperCreneaux(reponse.slots).map((g) =>
    '<div class="creneaux-groupe">'
      + `<h4 class="etiquette creneaux-moment">${esc(g.nom)}</h4>`
      + `<div class="creneaux-grille donnee">${g.liste.map(htmlCreneau).join('')}</div>`
    + '</div>'
  ).join('');
}

/** Un creneau choisi : on passe a l'etape 3. */
function choisirCreneau(bouton) {
  const start = Number(bouton.dataset.creneau);

  RESERVATION.creneau = { start, label: bouton.textContent.trim() };

  for (const autre of $$('.creneau')) {
    autre.setAttribute('aria-pressed', String(autre === bouton));
  }

  // Le rendez-vous retenu, rappele en tete de l'etape 3 avec son chemin de
  // retour. C'etait l'etape sans porte de sortie : on y arrivait en cliquant
  // une heure, et plus rien ne permettait d'en changer.
  poserTexte($('#rappelCreneau'),
    `${dateCourte(RESERVATION.date)} à ${RESERVATION.creneau.label}`);

  peindreFiche($('#tunnelFiche'));
  allerEtape(3);
}

// --- LA FICHE DE TRAVAIL ----------------------------------------------------

/**
 * Le recapitulatif, en fiche de travail : intitule a gauche, valeur en chasse
 * fixe a droite, filet entre chaque ligne.
 *
 * C'est la forme que prend le vocabulaire de l'atelier la ou il sert vraiment :
 * une fiche se lit valeur par valeur, en diagonale, et c'est exactement ce
 * qu'on demande a un recapitulatif juste avant de valider.
 */
function peindreFiche(cible, { reference = '' } = {}) {
  if (!cible || !RESERVATION.prestation || !RESERVATION.creneau) return;

  const p = RESERVATION.prestation;

  // Qui, seulement si c'est une information : « peu importe » avant la
  // reservation ne dit rien, le prenom attribue apres en dit une.
  const qui = RESERVATION.confirmee?.staffId
    ? CONFIG?.staff.find((s) => s.id === RESERVATION.confirmee.staffId)?.name
    : (RESERVATION.staffId
      ? CONFIG?.staff.find((s) => s.id === RESERVATION.staffId)?.name
      : '');

  const lignes = [
    ['Prestation', p.name],
    ['Durée', fmtDuree(p.duration)],
  ];

  if (qui) lignes.push(['Avec', qui]);

  lignes.push(['Quand', `${dateCourte(RESERVATION.date)} ${RESERVATION.creneau.label}`]);
  lignes.push(['À régler sur place', fmtPrix(p.price)]);

  if (reference) lignes.push(['Référence', reference]);

  cible.innerHTML = lignes.map(([intitule, valeur], index) => {
    const appui = intitule === 'À régler sur place' ? ' class="appui"' : '';
    return `<div${appui}><dt>${esc(intitule)}</dt><dd>${esc(valeur)}</dd></div>`;
  }).join('');
}

// --- LES MESSAGES -----------------------------------------------------------

/**
 * Un message dans le flux, sur aplat plein.
 *
 * Jamais une bulle flottante : elle a besoin d'une ombre pour se detacher, elle
 * disparait souvent avant d'etre lue, et sur telephone elle recouvre ce qu'on
 * vient de saisir.
 */
function afficherMessage(element, texte, ton = '') {
  if (!element) return;
  poserTexte(element, texte);
  if (ton) element.dataset.ton = ton; else delete element.dataset.ton;
  montrer(element, Boolean(texte));
}

// --- ETAPE 3 : la reservation -----------------------------------------------

async function envoyerReservation(evenement) {
  evenement.preventDefault();

  const bouton = $('#validerReservation');
  const message = $('#messageReservation');

  const nom = $('#clientNom')?.value.trim() ?? '';
  const telephone = $('#clientTel')?.value.trim() ?? '';
  const courriel = $('#clientEmail')?.value.trim() ?? '';

  // Les controles de saisie sont refaits par le serveur : ceux-ci n'existent que
  // pour eviter un aller-retour et pour dire ou est le probleme.
  if (!nom) return signalerChamp('clientNom', 'aideNom', 'Il nous faut un nom pour vous appeler.');
  if (!telephone) return signalerChamp('clientTel', 'aideTel', 'Un numéro, pour vous prévenir si quelque chose change.');

  effacerChamp('clientNom', 'aideNom');
  effacerChamp('clientTel', 'aideTel');

  bouton.disabled = true;
  poserTexte(bouton, 'Enregistrement…');
  afficherMessage(message, '');

  try {
    const reponse = await poserReservation({
      date: RESERVATION.date,
      start: RESERVATION.creneau.start,
      serviceId: RESERVATION.prestation.id,
      staffId: RESERVATION.staffId || undefined,
      name: nom,
      phone: telephone,
      email: courriel,
    });

    RESERVATION.confirmee = reponse;
    confirmer(reponse);

    // Le bandeau d'etat n'est plus a jour : le creneau qu'on vient de prendre
    // etait peut-etre le prochain disponible.
    document.dispatchEvent(new CustomEvent('reservation-prise'));

  } catch (erreur) {
    // LA COLLISION. Quelqu'un a pris le creneau entre l'affichage et la
    // validation : on retourne a l'etape 2 avec la journee deja chargee, et le
    // message dit ce qui s'est passe. Jamais d'erreur brute, jamais de retour
    // au depart.
    if (erreur.code === 409) {
      allerEtape(2);
      await chargerCreneaux(RESERVATION.date);
      afficherMessage($('#creneauxMessage'), erreur.message);
    } else {
      afficherMessage(message, erreur.message);
    }
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Réserver ce créneau');
  }
}

function signalerChamp(champId, aideId, texte) {
  const champ = $('#' + champId);
  const aide = $('#' + aideId);
  champ?.closest('.champ')?.setAttribute('data-refus', '');
  afficherMessage(aide, texte);
  champ?.focus();
}

function effacerChamp(champId, aideId) {
  $('#' + champId)?.closest('.champ')?.removeAttribute('data-refus');
  const aide = $('#' + aideId);
  if (aide && aide.id !== 'aideTel') montrer(aide, false);
}

// --- ETAPE 4 : la confirmation ----------------------------------------------

function confirmer(reponse) {
  const qui = reponse.staffId
    ? CONFIG?.staff.find((s) => s.id === reponse.staffId)?.name
    : '';

  poserTexte($('#confirmationPhrase'), qui
    ? `${dateLongue(reponse.date)} à ${fmtHeure(reponse.start)}, avec ${qui}.`
    : `${dateLongue(reponse.date)} à ${fmtHeure(reponse.start)}.`);

  // La reference est le debut du jeton d'annulation, en capitales : six
  // caracteres suffisent a la lire au telephone, et le jeton complet reste en
  // memoire pour l'annulation.
  //
  // ⚠️ LES TIRETS ET SOULIGNES SONT RETIRES AVANT LA COUPE. Le jeton est en
  //    base64url : il contient des `-` et des `_`, et un tirage sur deux
  //    donnait une reference du genre « -HHJBG » ou « A_9K2M ». Ce n'est pas
  //    faux — le jeton complet sert seul a l'annulation — mais c'est la
  //    derniere chose que le client lit, et on lui demande de la noter.
  peindreFiche($('#confirmationFiche'), {
    reference: (reponse.cancelToken || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase(),
  });

  montrer($('#annulerReservation'), true);
  afficherMessage($('#messageAnnulation'), '');
  allerEtape(4);
}

async function demanderAnnulation() {
  const message = $('#messageAnnulation');
  const bouton = $('#annulerReservation');
  const rdv = RESERVATION.confirmee;
  if (!rdv) return;

  bouton.disabled = true;

  try {
    await annulerReservation(rdv.id, rdv.cancelToken);

    afficherMessage(message, 'Le rendez-vous est annulé. Le créneau repart à quelqu\'un d\'autre.', 'bon');
    montrer(bouton, false);
    RESERVATION.confirmee = null;

    document.dispatchEvent(new CustomEvent('reservation-annulee'));
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

/** Repart de l'etape 1, saisie effacee. */
function recommencer() {
  RESERVATION.prestation = null;
  RESERVATION.staffId = '';
  RESERVATION.date = '';
  RESERVATION.creneau = null;
  RESERVATION.confirmee = null;

  $('#formulaireReservation')?.reset();
  montrer($('#tunnelCreneaux'), false);
  afficherMessage($('#messageReservation'), '');
  afficherMessage($('#creneauxMessage'), '');

  allerEtape(1);
}

// --- LE BRANCHEMENT ---------------------------------------------------------

function brancherTunnel() {
  // Les lignes de prestation, sur la vitrine comme dans le tunnel. Un seul
  // ecouteur pose sur le document : les lignes sont repeintes a chaque
  // enregistrement des reglages, et un ecouteur pose sur chacune serait a
  // rebrancher a chaque fois.
  document.addEventListener('click', (evenement) => {
    const ligne = evenement.target.closest('[data-choix="prestation"]');
    if (ligne) choisirPrestation(ligne.dataset.id);
  });

  // Les retours en arriere, depuis n'importe quelle etape.
  document.addEventListener('click', (evenement) => {
    const retour = evenement.target.closest('[data-retour]');
    if (!retour) return;

    const vers = Number(retour.dataset.retour);

    allerEtape(vers);
  });


  // AVEC QUI : le CALENDRIER ET les creneaux changent, puisque les
  // disponibilites ne sont plus les memes. `chargerMois()` fait les deux — il
  // redessine le mois et recharge les creneaux du jour retenu, ou retombe sur
  // le premier jour libre si cette personne ne travaille pas ce jour-la.
  //
  // C'est tout l'interet de poser la question APRES le jour : le resultat du
  // choix est visible immediatement, sur le calendrier comme sur les heures.
  $('#tunnelQuiChoix')?.addEventListener('change', (evenement) => {
    if (evenement.target.name !== 'staff') return;
    RESERVATION.staffId = evenement.target.value;
    chargerMois();
  });

  $('#moisPrecedent')?.addEventListener('click', () => {
    RESERVATION.mois = moisSuivantDe(RESERVATION.mois, -1);
    chargerMois();
  });

  $('#moisSuivant')?.addEventListener('click', () => {
    RESERVATION.mois = moisSuivantDe(RESERVATION.mois, 1);
    chargerMois();
  });

  $('#calendrierGrille')?.addEventListener('click', (evenement) => {
    const jour = evenement.target.closest('.calendrier-jour');
    if (jour && !jour.disabled) chargerCreneaux(jour.dataset.date);
  });

  // Sur le conteneur des GROUPES, et non sur une grille : les grilles sont
  // recreees a chaque changement de jour, un ecouteur pose sur l'une d'elles
  // disparaitrait avec.
  $('#creneauxGroupes')?.addEventListener('click', (evenement) => {
    const creneau = evenement.target.closest('.creneau');
    if (creneau && !creneau.disabled) choisirCreneau(creneau);
  });

  $('#formulaireReservation')?.addEventListener('submit', envoyerReservation);
  $('#annulerReservation')?.addEventListener('click', demanderAnnulation);
  $('#nouvelleReservation')?.addEventListener('click', recommencer);
}
