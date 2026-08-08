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

  allerEtape(2);
  chargerJours();
}

/**
 * « Reserver avec X », depuis la section Equipe.
 *
 * La personne est mise DE COTE, pas appliquee tout de suite : on ne sait pas
 * encore quelle prestation sera choisie, et c'est elle qui determine qui peut
 * la faire. `peindreQui()` retrouve l'attente et coche le bon bouton — ou
 * l'ignore si la personne n'assure pas la prestation retenue, auquel cas
 * « peu importe » reste coche plutot que de proposer un choix impossible.
 */
function reserverAvec(staffId) {
  RESERVATION.attenteStaffId = staffId || '';

  // On repart de l'etape 1 : la prestation reste la question qui vient en
  // premier, y compris quand on sait deja avec qui.
  allerEtape(1);
}

// --- ETAPE 2 : avec qui -----------------------------------------------------

/**
 * Le choix « avec qui ? », dans l'etape date — jamais dans une etape a part.
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
  const champ = $('#champQui');
  const liste = $('#tunnelQui');
  if (!champ || !liste || !CONFIG) return;

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
    montrer(champ, false);
    RESERVATION.staffId = '';
    return;
  }

  montrer(champ, true);

  // La personne mise de cote par « Reserver avec X » (section Equipe), si elle
  // assure bien la prestation choisie. Sinon on l'oublie : proposer un choix
  // que le serveur refusera ensuite est pire que ne rien proposer.
  const attendue = equipe.some((p) => p.id === RESERVATION.attenteStaffId)
    ? RESERVATION.attenteStaffId
    : '';
  RESERVATION.attenteStaffId = '';

  liste.innerHTML = '<option value="">Peu importe</option>'
    + equipe.map((p) => `<option value="${esc(p.id)}"${p.id === attendue ? ' selected' : ''}>`
      + `${esc(p.name)}</option>`).join('');

  RESERVATION.staffId = attendue;
}

// --- ETAPE 2 : LE JOUR ------------------------------------------------------

/**
 * Combien de jours en avant on propose.
 *
 * Huit semaines : assez pour qu'un jour ouvert existe toujours dans la liste,
 * meme si le barbier ferme deux semaines en aout, et assez court pour que la
 * liste deroulante reste parcourable d'un pouce. Au-dela, personne ne prend
 * rendez-vous chez le coiffeur.
 */
const JOURS_PROPOSES = 56;

/** Un jour, ecrit comme on se donne rendez-vous : « samedi 9 aout ». */
function etiquetteJour(iso) {
  const texte = dateLongue(iso);
  if (iso === aujourdhui()) return `Aujourd'hui — ${texte}`;
  if (iso === versIso(new Date(versDate(aujourdhui()).getTime() + 86400000))) {
    return `Demain — ${texte}`;
  }
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/**
 * Remplit la liste des jours.
 *
 * ON N'Y MET QUE LES JOURS REELLEMENT OUVERTS. Le calendrier d'avant affichait
 * les trente et un jours du mois et laissait deviner, a une nuance de gris
 * pres, lesquels etaient cliquables. Une liste deroulante n'a pas ce probleme :
 * ce qui n'y est pas n'existe pas. Un jour ferme ou complet n'a rien a faire
 * dans un choix.
 *
 * UN SEUL APPEL POUR HUIT SEMAINES, et c'est la raison d'etre de /api/days :
 * passer par /api/slots demanderait cinquante-six allers-retours.
 */
async function chargerJours() {
  const liste = $('#tunnelJour');
  if (!liste || !RESERVATION.prestation) return;

  const premier = aujourdhui();
  const dernier = versIso(new Date(versDate(premier).getTime() + JOURS_PROPOSES * 86400000));

  let ouverts = [];
  try {
    const reponse = await lireJours(premier, dernier, RESERVATION.prestation.id, RESERVATION.staffId);
    ouverts = reponse.days.filter((j) => j.state === 'open').map((j) => j.date);
  } catch {
    // Le serveur n'a pas repondu. On ne laisse pas une liste vide sans rien
    // dire : le message explique, et le telephone reste en haut de la page.
    liste.innerHTML = '<option value="">Indisponible pour le moment</option>';
    liste.disabled = true;
    afficherMessage($('#creneauxMessage'),
      "Impossible de lire les disponibilités. Réessayez, ou appelez-nous.");
    return;
  }

  liste.disabled = false;

  if (!ouverts.length) {
    liste.innerHTML = '<option value="">Aucun jour disponible</option>';
    verrouillerHeures('Aucun jour disponible');
    afficherMessage($('#creneauxMessage'), RESERVATION.staffId
      ? "Cette personne n'a plus de place sur les huit prochaines semaines. Essayez « peu importe »."
      : "Plus aucune place sur les huit prochaines semaines. Appelez-nous, on trouvera.");
    return;
  }

  afficherMessage($('#creneauxMessage'), '');

  // Le jour deja retenu s'il est toujours ouvert, sinon le premier libre : on
  // ne renvoie jamais le visiteur a un choix vide, et revenir de l'etape 3 ne
  // doit pas effacer ce qu'il avait choisi.
  const retenu = ouverts.includes(RESERVATION.date) ? RESERVATION.date : ouverts[0];

  liste.innerHTML = ouverts.map((iso) =>
    `<option value="${esc(iso)}"${iso === retenu ? ' selected' : ''}>${esc(etiquetteJour(iso))}</option>`
  ).join('');

  await chargerHeures(retenu);
}

// --- ETAPE 2 : L'HEURE ------------------------------------------------------

/** La coupure matin / apres-midi, en minutes depuis minuit.
 *
 * ⚠️ `start` EST UN NOMBRE DE MINUTES DEPUIS MINUIT, pas un horodatage. 510
 *    vaut 8h30, 990 vaut 16h30. Le passer a `new Date()` donne le 1er janvier
 *    1970 a 1h du matin pour toutes les valeurs — les trente-trois creneaux
 *    d'un samedi se retrouvaient alors tous dans « Matin ». */
const MINUTES_MIDI = 13 * 60;

/** La liste des heures, eteinte, avec la raison ecrite dedans. */
function verrouillerHeures(raison) {
  const liste = $('#tunnelHeure');
  if (!liste) return;
  liste.innerHTML = `<option value="">${esc(raison)}</option>`;
  liste.disabled = true;
  const valider = $('#validerCreneau');
  if (valider) valider.disabled = true;
}

/**
 * Remplit la liste des heures d'un jour.
 *
 * Deux groupes, matin et apres-midi. Une journee de barbier ouverte de 8h30 a
 * 21h donne trente-trois creneaux : en une seule liste c'est un rouleau ou l'on
 * ne trouve pas « vers 18h » sans le parcourir en entier. `<optgroup>` est la
 * reponse native, et le selecteur du telephone l'affiche tout seul.
 *
 * LES CRENEAUX PRIS RESTENT DANS LA LISTE, eteints. Les retirer donnerait une
 * liste qui saute de 14h00 a 16h30 et laisserait croire a une erreur ; les
 * montrer barres dit « c'est un jour charge », ce qui est l'information vraie.
 */
async function chargerHeures(date) {
  const liste = $('#tunnelHeure');
  const message = $('#creneauxMessage');
  if (!liste || !RESERVATION.prestation) return;

  RESERVATION.date = date;
  RESERVATION.creneau = null;

  verrouillerHeures('Recherche des heures libres…');

  let reponse;
  try {
    reponse = await lireCreneaux(date, RESERVATION.prestation.id, RESERVATION.staffId);
  } catch (erreur) {
    verrouillerHeures('Indisponible pour le moment');
    afficherMessage(message, erreur.message);
    return;
  }

  const libres = reponse.slots.filter((c) => c.free);

  if (!libres.length) {
    verrouillerHeures('Complet ce jour-là');
    afficherMessage(message, RESERVATION.staffId
      ? "Cette personne est complète ce jour-là. Essayez « peu importe », ou un autre jour."
      : "La journée est complète. Choisissez un autre jour.");
    return;
  }

  afficherMessage(message, '');

  const groupe = (nom, creneaux) => creneaux.length
    ? `<optgroup label="${esc(nom)}">`
      + creneaux.map((c) => `<option value="${esc(c.start)}"${c.free ? '' : ' disabled'}>`
        + `${esc(c.label)}${c.free ? '' : ' — déjà pris'}</option>`).join('')
      + '</optgroup>'
    : '';

  liste.innerHTML = '<option value="">Choisissez une heure</option>'
    + groupe('Matin', reponse.slots.filter((c) => c.start < MINUTES_MIDI))
    + groupe('Après-midi', reponse.slots.filter((c) => c.start >= MINUTES_MIDI));

  liste.disabled = false;
  liste.value = '';

  const valider = $('#validerCreneau');
  if (valider) valider.disabled = true;
}

/** L'heure choisie dans la liste. Rien ne se valide tant qu'elle est vide. */
function choisirHeure(valeur) {
  const valider = $('#validerCreneau');
  const liste = $('#tunnelHeure');

  if (!valeur) {
    RESERVATION.creneau = null;
    if (valider) valider.disabled = true;
    return;
  }

  const option = liste?.selectedOptions?.[0];
  RESERVATION.creneau = {
    start: Number(valeur),
    // L'intitule affiche, debarrasse de la mention « deja pris » que seules les
    // options eteintes portent — et qu'on ne peut donc pas choisir.
    label: (option?.textContent || '').replace(' — déjà pris', '').trim(),
  };

  if (valider) valider.disabled = false;
}

/** Passe a l'etape 3 avec le creneau retenu. */
function validerCreneau() {
  if (!RESERVATION.creneau) return;

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
      await chargerHeures(RESERVATION.date);
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
  RESERVATION.attenteStaffId = '';
  RESERVATION.date = '';
  RESERVATION.creneau = null;
  RESERVATION.confirmee = null;

  $('#formulaireReservation')?.reset();

  const choix = $('#tunnelPrestation');
  if (choix) choix.value = '';
  const valider = $('#validerPrestation');
  if (valider) valider.disabled = true;

  verrouillerHeures('Choisissez d\'abord un jour');
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

  // L'etape 1 : la liste deroulante groupee par rayon. « Continuer » reste
  // eteint tant que rien n'est choisi — la meme regle qu'a l'etape 2.
  $('#tunnelPrestation')?.addEventListener('change', (evenement) => {
    const valider = $('#validerPrestation');
    if (valider) valider.disabled = !evenement.target.value;
  });

  $('#validerPrestation')?.addEventListener('click', () => {
    const id = $('#tunnelPrestation')?.value;
    if (id) choisirPrestation(id);
  });

  // Les retours en arriere, depuis n'importe quelle etape.
  document.addEventListener('click', (evenement) => {
    const retour = evenement.target.closest('[data-retour]');
    if (!retour) return;

    const vers = Number(retour.dataset.retour);

    // En revenant a l'etape 1, la liste retrouve la prestation deja choisie :
    // on revient pour en CHANGER, pas pour tout resaisir, et « Continuer »
    // reste actif si l'on se ravise.
    if (vers === 1 && RESERVATION.prestation) {
      const liste = $('#tunnelPrestation');
      const valider = $('#validerPrestation');
      if (liste) liste.value = RESERVATION.prestation.id;
      if (valider) valider.disabled = false;
    }

    allerEtape(vers);
  });

  // « Reserver avec X », depuis la section Equipe. Meme motif que les lignes de
  // prestation : un seul ecouteur pose sur le document, parce que la liste de
  // l'equipe est repeinte a chaque enregistrement des reglages.
  document.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('[data-reserver-avec]');
    if (bouton) reserverAvec(bouton.dataset.reserverAvec);
  });

  // AVEC QUI : la liste des jours ET celle des heures changent, puisque les
  // disponibilites ne sont plus les memes. `chargerJours()` recharge les deux —
  // il appelle `chargerHeures()` sur le jour retenu.
  $('#tunnelQui')?.addEventListener('change', (evenement) => {
    RESERVATION.staffId = evenement.target.value;
    chargerJours();
  });

  $('#tunnelJour')?.addEventListener('change', (evenement) => {
    if (evenement.target.value) chargerHeures(evenement.target.value);
  });

  $('#tunnelHeure')?.addEventListener('change', (evenement) => {
    choisirHeure(evenement.target.value);
  });

  $('#validerCreneau')?.addEventListener('click', validerCreneau);

  $('#formulaireReservation')?.addEventListener('submit', envoyerReservation);
  $('#annulerReservation')?.addEventListener('click', demanderAnnulation);
  $('#nouvelleReservation')?.addEventListener('click', recommencer);
}
