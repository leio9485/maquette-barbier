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

/** Le rendez-vous en cours de prise. */
const RESERVATION = {
  etape: 1,
  prestation: null,   // l'objet prestation complet
  staffId: '',        // '' = peu importe
  date: '',           // 'AAAA-MM-JJ'
  creneau: null,      // { start, label }
  mois: null,         // le premier jour du mois affiche au calendrier
  confirmee: null,    // ce que le serveur a repondu, jeton d'annulation compris
  // LE MODE DEPLACEMENT. `null` = on prend un nouveau rendez-vous, le cas
  // normal. Rempli quand on arrive depuis /annuler avec un rendez-vous a
  // decaler : le tunnel garde alors la meme prestation, saute les coordonnees,
  // et enregistre par /api/rendez-vous/deplacer au lieu de creer une seconde
  // ligne. Voir js/07-tunnel.js.
  deplacement: null,  // { reference, telephone, jeton, ancien }
  // La preuve qui a servi au deplacement, gardee pour l'ecran de confirmation :
  // c'est elle qui permet d'annuler sans identifiant ni jeton frais.
  preuve: null,       // { reference, jeton, telephone }
  // De quoi ecrire le fichier .ics du bouton « Ajouter à mon agenda »
  // (js/07-mon-agenda.js). Rempli par les DEUX chemins qui menent a l'ecran de
  // confirmation — la reservation neuve et le deplacement — parce que le
  // second ne pose pas `confirmee`.
  pourAgenda: null,   // { date, start, duree, prestation, avec, reference }
};

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

  // Le premier titre de l'etape recoit le focus : sans cela, un lecteur d'ecran
  // continuerait d'annoncer l'etape precedente, et le clavier repartirait du
  // haut du document a la tabulation suivante.
  //
  // TOUT DE SUITE, ET SANS DEFILER (`preventScroll`). Le focus est la reponse
  // au geste qu'on vient de faire : le differer d'une image le detacherait du
  // clic. C'est le DEFILEMENT, lui, qui attend — voir juste dessous.
  const titre = $(`.etape[data-etape="${numero}"] h2`);
  if (titre) {
    titre.setAttribute('tabindex', '-1');
    titre.focus({ preventScroll: true });
  }

  if (defiler) defilerVersTunnel();
}

/**
 * Remonter en tete du tunnel apres un changement d'etape.
 *
 * >>> C'EST LE MOMENT OU L'ON PERD LE CLIENT. <<< Les etapes n'ont pas la meme
 * hauteur, et de loin : l'etape 2 porte un calendrier et jusqu'a trente-trois
 * creneaux, l'etape 4 tient en huit lignes. Choisir une heure fait donc perdre
 * a la page les deux tiers de sa hauteur d'un coup — le navigateur ramene alors
 * le defilement a ce qu'il reste, et sans rien faire de plus on se retrouve a
 * regarder le pied de page. Sur telephone, c'est exactement l'instant ou l'on
 * croit que la reservation n'est pas passee, et ou l'on rappelle.
 *
 * ⚠️ APRES LA REDISPOSITION, PAS PENDANT. Le defilement etait demande dans la
 *    meme foulee que le `hidden` de l'etape precedente : la position visee
 *    etait calculee sur une page qui n'avait pas encore retreci, puis rabotee
 *    par le navigateur. Une image d'attente (`requestAnimationFrame`) suffit a
 *    la calculer sur la page telle qu'elle sera.
 *
 * ⚠️ `#reserver`, PAS LE HAUT DE LA PAGE : le bandeau d'etat reste visible, et
 *    la frise des quatre etapes est la premiere chose lue. `scrollIntoView`
 *    tient compte du `scroll-padding-top` de la feuille (03-fondations.css),
 *    donc du bandeau et de l'en-tete colles en haut — c'est la raison de le
 *    preferer a un `scrollTo` qui redemanderait ce calcul ici.
 *
 * ⚠️ `auto`, JAMAIS `smooth`. C'etait `smooth` sauf sous
 *    `prefers-reduced-motion`, et ce reglage a ete retire pour la meme raison
 *    que `scroll-behavior` l'a ete de la feuille (03-fondations.css, qui porte
 *    le diagnostic complet) : un defilement anime n'avance qu'aux images
 *    peintes, donc pas du tout dans un onglet en arriere-plan ni sous un
 *    navigateur pilote — et « Changer de creneau » ne bougeait alors plus la
 *    page du tout. Un saut instantane arrive toujours.
 */
function defilerVersTunnel() {
  const section = $('#reserver');
  if (!section) return;

  const remonter = () => section.scrollIntoView({ block: 'start', behavior: 'auto' });

  // DEUX FOIS, ET LES DEUX SERVENT.
  //
  // Tout de suite : `scrollIntoView` force le calcul de la mise en page, donc
  // il lit deja la page RETRECIE par le `hidden` d'au-dessus — verifie, la
  // position visee est la bonne des le premier appel. C'est aussi le seul appel
  // qui arrive quand les images ne sont pas peintes (onglet en arriere-plan,
  // navigateur pilote), ou `requestAnimationFrame` ne se declenche jamais.
  //
  // Puis a l'image suivante : ce qui se met en place APRES le calcul — une
  // photo qui finit d'arriver, une police qui remplace sa doublure — change
  // encore la hauteur. Le second appel vise la page telle qu'elle est vraiment.
  // Il est sans effet quand rien n'a bouge : on redemande la meme position.
  remonter();
  requestAnimationFrame(remonter);
}

// --- ETAPE 1 : la prestation ------------------------------------------------

/**
 * Le rappel de la prestation, AUX DEUX ENDROITS OU IL EST ECRIT.
 *
 * ⚠️ L'ETAPE 3 N'EN AVAIT PAS. Son rappel n'affichait que « sam. 15 aout a
 *    09:30 » : au moment ou l'on saisit son numero de telephone, on ne voyait
 *    plus ni ce qu'on avait choisi, ni ce que ca coute. Les deux ne
 *    reapparaissaient que plus bas, sous le pli, dans la fiche de travail.
 *
 * Une fonction plutot que deux appels recopies : le jour ou la formulation
 * change, elle ne peut pas changer d'un cote seulement.
 */
function poserRappelPrestation(prestation) {
  const texte = `${prestation.name} · ${fmtDuree(prestation.duration)} · ${fmtPrix(prestation.price)}`;
  poserTexte($('#rappelPrestation'), texte);
  poserTexte($('#rappelPrestationEtape3'), texte);
}

function choisirPrestation(id) {
  const prestation = CONFIG?.services.find((s) => s.id === id);
  if (!prestation) return;

  RESERVATION.prestation = prestation;
  RESERVATION.date = '';
  RESERVATION.creneau = null;

  poserRappelPrestation(prestation);

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


// --- ETAPE 3 : la reservation -----------------------------------------------

async function envoyerReservation(evenement) {
  evenement.preventDefault();

  const bouton = $('#validerReservation');
  const message = $('#messageReservation');

  // On deplace un rendez-vous existant : le salon a deja les coordonnees, et
  // il n'y a pas de seconde ligne a creer.
  if (RESERVATION.deplacement) return envoyerDeplacement(bouton, message);

  const nom = $('#clientNom')?.value.trim() ?? '';
  const telephone = $('#clientTel')?.value.trim() ?? '';
  const courriel = $('#clientEmail')?.value.trim() ?? '';

  // >>> CE MIROIR NE FAIT PAS FOI. <<< Les memes regles sont appliquees par le
  // serveur (src/lib/coordonnees.js), et ce sont celles-la qui protegent la
  // base : une requete peut arriver sans passer par cette page. Ce qui suit
  // n'existe que pour eviter un aller-retour et DIRE OU EST LE PROBLEME —
  // sous le champ fautif, pas dans un message general en bas du formulaire.
  //
  // ⚠️ SI UNE REGLE CHANGE ICI, ELLE CHANGE DANS src/lib/coordonnees.js — et
  //    reciproquement. Un test envoie les memes saisies aux deux et verifie
  //    qu'elles obtiennent le meme verdict. C'est la meme discipline que pour
  //    le balisage des prestations et des avis, ecrit lui aussi a deux
  //    endroits.
  // >>> ON EFFACE LES TROIS AVANT DE REVERIFIER. <<< Sans cette ligne, un
  // champ signale reste signale apres avoir ete corrige : on tapait « abc »,
  // on obtenait le refus du telephone, on le corrigeait, et le message rouge
  // du telephone restait a l'ecran pendant qu'un autre s'affichait sous le
  // courriel. Le client repare alors un champ qui est deja juste.
  //
  // Le nettoyage etait fait APRES les controles, donc jamais atteint quand
  // l'un d'eux echouait. Un defaut sans consequence tant qu'il n'y avait que
  // deux champs et un seul refus possible a la fois.
  for (const [champ, aide] of [['clientNom', 'aideNom'], ['clientTel', 'aideTel'], ['clientEmail', 'aideEmail']]) {
    effacerChamp(champ, aide);
  }

  if (!nom) return signalerChamp('clientNom', 'aideNom', 'Il nous faut un nom pour vous appeler.');
  if (nom.length > 80) {
    return signalerChamp('clientNom', 'aideNom', 'Ce nom dépasse 80 caractères. Le prénom suffit.');
  }

  if (!telephone) return signalerChamp('clientTel', 'aideTel', 'Un numéro, pour vous prévenir si quelque chose change.');
  if (!telephonePlausible(telephone)) {
    return signalerChamp('clientTel', 'aideTel',
      "Ce numéro de téléphone n'a pas l'air complet. Exemple : 06 12 34 56 78.");
  }

  // Le courriel est FACULTATIF : vide n'est pas une faute. Il n'est verifie
  // que s'il y a quelque chose a verifier.
  if (courriel && !courrielPlausible(courriel)) {
    return signalerChamp('clientEmail', 'aideEmail',
      "Cette adresse e-mail n'a pas l'air valable. Exemple : prenom@exemple.fr. "
      + 'Vous pouvez aussi la laisser vide.');
  }

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

    // Le rendez-vous est retenu dans le navigateur : le client qui reviendra
    // sur le site le retrouvera sous l'en-tete, sans rien ressaisir
    // (js/11-mon-rendez-vous.js).
    retenirLaReservation(reponse);

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

/**
 * Le numero a-t-il une chance d'en etre un ?
 *
 * ⚠️ MIROIR DE `normaliserTelephone()` (src/lib/coordonnees.js). Il en reprend
 *    les regles, PAS la normalisation : ce qu'on envoie est ce que le client a
 *    tape, et c'est le serveur qui range. Reecrire son numero sous ses yeux
 *    pendant qu'il le tape est desagreable, et surtout ca ferait exister deux
 *    endroits ou une ecriture se decide.
 *
 * Les numeros etrangers passent : Bavay est a huit kilometres de la Belgique.
 */
function telephonePlausible(brut) {
  let compact = String(brut).replace(/[\s.\-/()  ]/g, '');
  if (compact.startsWith('00')) compact = '+' + compact.slice(2);

  if (!/^\+?\d+$/.test(compact)) return false;
  if (compact.startsWith('+33')) return /^[1-9]\d{8}$/.test(compact.slice(3));
  if (compact.startsWith('+')) return /^\d{8,15}$/.test(compact.slice(1));

  return /^0[1-9]\d{8}$/.test(compact);
}

/**
 * L'adresse a-t-elle une chance d'en etre une ?
 *
 * ⚠️ MIROIR DE `validerCourriel()` (src/lib/coordonnees.js), meme expression.
 *    Elle n'est volontairement pas celle de la norme : on ecarte ce qui NE
 *    PEUT PAS etre une adresse (« pasunemail »), pas ce qui n'existe pas.
 */
function courrielPlausible(brut) {
  const propre = String(brut);
  if (propre.length > 160) return false;
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.\d]{2,}$/.test(propre);
}

/**
 * Un champ refuse.
 *
 * ⚠️ CETTE VALIDATION ETAIT PARFAITE A L'OEIL ET MUETTE AU LECTEUR D'ECRAN.
 *
 * Le focus partait bien sur le champ fautif, la phrase disait quoi faire et
 * donnait un exemple (« Ce numéro n'a pas l'air complet. Exemple :
 * 06 12 34 56 78 »). Mais aucun `aria-invalid`, aucun `aria-describedby`,
 * aucune region vivante : quelqu'un qui ne voit pas l'ecran appuyait sur
 * « Réserver ce créneau » et, de son point de vue, il ne se passait rien.
 *
 * Les trois manques sont combles ailleurs, une seule fois pour tout le site :
 * `marquerRefus()` pose les deux attributs (js/02-utilitaires.js), et
 * `afficherMessage()` fait de l'aide une region `role="alert"`, ce qui la fait
 * lire au moment ou elle apparait.
 */
function signalerChamp(champId, aideId, texte) {
  const champ = $('#' + champId);
  const aide = $('#' + aideId);

  afficherMessage(aide, texte);
  marquerRefus(champ, true, aideId);
  champ?.focus();
}

/**
 * Le texte que porte une aide QUAND TOUT VA BIEN.
 *
 * ⚠️ Un seul des trois champs a une aide permanente : le telephone, qui dit
 *    pourquoi on le demande. Elle est relevee au premier passage et remise
 *    telle quelle apres un refus — sans ca, corriger son numero laissait a sa
 *    place le message d'erreur, muet et definitif.
 */
const AIDES_AU_REPOS = new Map();

function effacerChamp(champId, aideId) {
  const champ = $('#' + champId);
  marquerRefus(champ, false, aideId);

  const aide = $('#' + aideId);
  if (!aide) return;

  // L'aide du telephone reste affichee : ce n'est pas un message d'erreur,
  // c'est la raison pour laquelle on demande le numero.
  if (aide.id === 'aideTel') {
    if (!AIDES_AU_REPOS.has(aideId)) AIDES_AU_REPOS.set(aideId, aide.textContent);
    poserTexte(aide, AIDES_AU_REPOS.get(aideId));
    montrer(aide, true);

    // ⚠️ ELLE REDEVIENT UNE DESCRIPTION, ET CESSE D'ETRE UNE ALERTE. Elle a pu
    //    porter un refus il y a un instant : la laisser en `role="alert"` ferait
    //    reannoncer « Pour vous prévenir si quelque chose change » a chaque
    //    correction, et l'association permanente, elle, doit rester — c'est la
    //    raison pour laquelle on demande ce numero, et elle se lit en arrivant
    //    sur le champ.
    aide.removeAttribute('role');
    champ?.setAttribute('aria-describedby', aideId);
    return;
  }

  montrer(aide, false);
}

// --- ETAPE 4 : la confirmation ----------------------------------------------

function confirmer(reponse) {
  const qui = reponse.staffId
    ? CONFIG?.staff.find((s) => s.id === reponse.staffId)?.name
    : '';

  poserTexte($('#confirmationPhrase'), qui
    ? `${dateLongue(reponse.date)} à ${fmtHeure(reponse.start)}, avec ${qui}.`
    : `${dateLongue(reponse.date)} à ${fmtHeure(reponse.start)}.`);

  // >>> LA REFERENCE VIENT DU SERVEUR. ELLE NE SE RECALCULE PAS ICI. <<<
  //
  // Cette ligne derivait la reference du jeton d'annulation :
  //
  //     (reponse.cancelToken || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
  //
  // C'etait juste tant que la reference n'existait qu'a l'ecran. Elle est
  // depuis une COLONNE INDEXEE, tiree par le serveur dans l'alphabet de
  // Crockford (src/lib/reference.js), et c'est elle que /annuler cherche en
  // base. Les deux ne coincidaient plus : l'ecran affichait « FVLJ8U » quand
  // la base portait « MQJYBK ». Un client qui notait ce qu'il voyait et
  // revenait l'annuler recevait « rendez-vous introuvable » — pour une
  // reference que le site venait lui-meme de lui donner.
  //
  // Le tri etait double : le deplacement, lui, affichait deja la bonne
  // (`rdv.reference`, plus bas). Seule la premiere reservation mentait.
  peindreFiche($('#confirmationFiche'), { reference: reponse.reference ?? '' });

  RESERVATION.pourAgenda = {
    date: reponse.date,
    start: reponse.start,
    duree: reponse.duration ?? RESERVATION.prestation?.duration,
    prestation: RESERVATION.prestation?.name ?? '',
    avec: qui,
    reference: reponse.reference ?? '',
  };

  montrer($('#annulerReservation'), true);
  afficherMessage($('#messageAnnulation'), '');
  allerEtape(4);
}

async function demanderAnnulation() {
  const message = $('#messageAnnulation');
  const bouton = $('#annulerReservation');
  const rdv = RESERVATION.confirmee;

  // DEUX CHEMINS, PARCE QU'IL Y A DEUX FACONS D'ARRIVER SUR CET ECRAN.
  //
  //   - on vient de reserver : on a l'identifiant du rendez-vous et son jeton,
  //     tout frais du serveur ;
  //   - on vient de deplacer : on n'a ni l'un ni l'autre — le serveur ne rend
  //     pas d'identifiant au client — mais on a la reference et la preuve qui
  //     vient de servir au deplacement, jeton ou quatre chiffres.
  //
  // Le second chemin n'existait pas : le bouton etait donc simplement masque
  // apres un deplacement.
  if (!rdv && !RESERVATION.preuve) return;

  bouton.disabled = true;

  try {
    if (rdv) await annulerReservation(rdv.id, rdv.cancelToken);
    else await annulerParReference(RESERVATION.preuve);

    afficherMessage(message, 'Le rendez-vous est annulé. Le créneau repart à quelqu\'un d\'autre.', 'bon');
    montrer(bouton, false);

    // Le tiroir du navigateur suit, sinon le bandeau « Votre rendez-vous »
    // continuerait de l'annoncer en haut de la vitrine.
    oublierRendezVous(rdv?.reference || RESERVATION.preuve?.reference);

    RESERVATION.confirmee = null;
    RESERVATION.preuve = null;

    document.dispatchEvent(new CustomEvent('reservation-annulee'));
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

// --- LE DEPLACEMENT D'UN RENDEZ-VOUS EXISTANT -------------------------------
//
// On arrive ici depuis /annuler, bouton « Déplacer ce rendez-vous ». Le tunnel
// se reouvre a l'etape 2, prestation et personne deja choisies, et l'etape 3
// ne demande plus rien : elle ne fait que confirmer.
//
// >>> LE TUNNEL N'EST PAS RECOPIE. <<< C'est toute la raison de ce detour par
// la vitrine plutot qu'un second calendrier sur /annuler : il n'y a qu'un
// calendrier, qu'une liste de creneaux et qu'une facon de les grouper dans ce
// projet, et un deplacement doit se choisir exactement comme une reservation.
//
// La preuve d'identite voyage par `sessionStorage`, jamais par l'adresse : voir
// `partirDeplacer()` dans js/annuler/02-ecrans.js.

const CLE_DEPLACEMENT = 'letabli.deplacement';

/** La note de l'ecran de confirmation, telle qu'elle est ecrite dans la page. */
const NOTE_CONFIRMATION = { html: null };

/**
 * Reprend un deplacement demande depuis /annuler, s'il y en a un.
 *
 * Appele au demarrage, apres que CONFIG est arrive — il faut la liste des
 * prestations pour retrouver celle du rendez-vous.
 *
 * Ne leve jamais et ne dit rien en cas d'echec : le visiteur retombe alors sur
 * la vitrine ordinaire, ce qui est un mauvais resultat mais pas une panne. Son
 * rendez-vous, lui, n'a pas bouge.
 */
async function reprendreDeplacement() {
  let demande = null;
  try {
    const brut = sessionStorage.getItem(CLE_DEPLACEMENT);
    // Retire des la lecture : rafraichir la page ne doit pas relancer un
    // deplacement que le client a peut-etre abandonne entre-temps.
    sessionStorage.removeItem(CLE_DEPLACEMENT);
    if (brut) demande = JSON.parse(brut);
  } catch {
    return;
  }

  if (!demande?.reference) return;

  let rdv;
  try {
    const preuve = { reference: demande.reference };
    if (demande.jeton) preuve.jeton = demande.jeton;
    else preuve.telephone = demande.telephone;

    rdv = (await retrouverRendezVous(preuve)).rendezVous;
  } catch {
    return;
  }

  if (!rdv || rdv.cancelledAt || rdv.past) return;

  const prestation = CONFIG?.services.find((s) => s.id === rdv.serviceId);
  if (!prestation) return;

  RESERVATION.deplacement = { ...demande, ancien: rdv };
  RESERVATION.prestation = prestation;
  RESERVATION.date = '';
  RESERVATION.creneau = null;

  poserRappelPrestation(prestation);

  peindreQui();

  // « Avec qui » est prerempli sur la personne du rendez-vous d'origine : c'est
  // le plus souvent la reponse voulue, et elle reste changeable d'un clic.
  if (rdv.staffId) {
    const bouton = $(`#staff-${CSS.escape(rdv.staffId)}`);
    if (bouton) {
      bouton.checked = true;
      RESERVATION.staffId = rdv.staffId;
    }
  }

  peindreBandeauDeplacement(rdv);
  habillerEtapeDeplacement();

  RESERVATION.mois = premierDuMois(aujourdhui());
  allerEtape(2);
  chargerMois();
}

/** Le rappel de ce qu'on est en train de deplacer, en tete du tunnel. */
function peindreBandeauDeplacement(rdv) {
  const frise = $('#tunnelFrise');
  if (!frise || $('#tunnelDeplacement')) return;

  const avec = rdv.staffName ? ` avec ${rdv.staffName}` : '';

  const bloc = document.createElement('p');
  bloc.className = 'message';
  bloc.id = 'tunnelDeplacement';
  poserTexte(bloc,
    `Vous déplacez le rendez-vous ${rdv.reference} du ${dateLongue(rdv.date)} `
    + `à ${fmtHeure(rdv.start)}${avec}. Choisissez le nouveau créneau : `
    + "l'ancien ne sera libéré qu'une fois le nouveau confirmé.");

  frise.parentNode.insertBefore(bloc, frise.nextSibling);
}

/**
 * Le libelle d'une cellule de la frise, numero conserve.
 *
 * `textContent` et `append`, jamais `innerHTML` : ce mot ne vient pas d'une
 * saisie, mais la regle du projet est de ne pas fabriquer de balisage pour
 * poser un mot.
 */
function libelleFrise(rang, mot) {
  const cellule = $(`.frise-etape[data-frise="${rang}"]`);
  if (!cellule) return;

  const numero = cellule.querySelector('.frise-numero');
  cellule.textContent = '';
  if (numero) cellule.appendChild(numero);
  cellule.append(' ' + mot);
}

/** L'etape 3, quand elle ne sert qu'a confirmer un deplacement. */
function habillerEtapeDeplacement() {
  if (!RESERVATION.deplacement) return;

  poserTexte($('#titreEtape3'), 'Confirmez le nouveau créneau');
  poserTexte($('#introEtape3'),
    "Rien d'autre à saisir : le salon a déjà vos coordonnées.");

  // >>> LA FRISE DISAIT « 03 · Coordonnées » PENDANT QU'ON DEPLACAIT, et
  // l'ecran, lui, disait « Rien d'autre à saisir : le salon a déjà vos
  // coordonnées ». Le plan du parcours annoncait donc une etape que le
  // parcours venait de retirer. La frise existe pour dire ou l'on en est ;
  // quand elle se trompe, elle coute plus qu'elle ne rapporte.
  //
  // Le libelle accessible suit, puisque c'est le meme texte : la frise est une
  // liste de cellules de texte, sans `aria-label` par-dessus.
  libelleFrise(3, 'Confirmer');

  montrer($('#tunnelCoordonnees'), false);
  poserTexte($('#validerReservation'), 'Déplacer vers ce créneau');
}

async function envoyerDeplacement(bouton, message) {
  bouton.disabled = true;
  poserTexte(bouton, 'Déplacement…');
  afficherMessage(message, '');

  const demande = RESERVATION.deplacement;

  try {
    const corps = {
      reference: demande.reference,
      date: RESERVATION.date,
      start: RESERVATION.creneau.start,
      staffId: RESERVATION.staffId || undefined,
    };
    if (demande.jeton) corps.jeton = demande.jeton;
    else corps.telephone = demande.telephone;

    const reponse = await deplacerRendezVous(corps);
    const rdv = reponse.rendezVous;

    // La reference et le jeton ne changent pas — c'est le meme rendez-vous a
    // une autre heure — mais la memoire du navigateur, elle, doit suivre.
    //
    // `reponse.jeton` n'existe que si la preuve ETAIT le jeton (le serveur ne
    // le rend pas a qui a montre quatre chiffres) ; `retenirRendezVous()` garde
    // de toute facon celui qu'il avait deja. Les deux se completent : ni l'un
    // ni l'autre ne suffit seul.
    retenirRendezVous({ ...rdv, jeton: reponse.jeton || demande.jeton });

    // La preuve qui vient de servir sert encore : c'est elle qui rend le bouton
    // « Annuler ce rendez-vous » utilisable sur l'ecran de confirmation.
    confirmerDeplacement(rdv, {
      reference: rdv.reference,
      jeton: reponse.jeton || demande.jeton || '',
      telephone: demande.telephone || '',
    });
    document.dispatchEvent(new CustomEvent('reservation-prise'));

  } catch (erreur) {
    // Meme traitement que pour une collision a la reservation : on revient a
    // l'etape 2 avec la journee rechargee. L'ancien rendez-vous est intact —
    // c'est la garantie de la transaction cote serveur.
    if (erreur.code === 409) {
      allerEtape(2);
      await chargerCreneaux(RESERVATION.date);
      afficherMessage($('#creneauxMessage'), erreur.message);
    } else {
      afficherMessage(message, erreur.message);
    }
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Déplacer vers ce créneau');
  }
}

function confirmerDeplacement(rdv, preuve) {
  // >>> LE BANDEAU D'ANNONCE PART. <<< Il disait « Vous déplacez le rendez-vous
  // FMXQCS du jeudi 20 août à 16:00 […] Choisissez le nouveau créneau », et il
  // restait a l'ecran SOUS le titre « C'est déplacé » : deux messages
  // contradictoires empiles, dont le premier demande ce que le second vient de
  // faire.
  //
  // On le RETIRE au lieu de le masquer : `peindreBandeauDeplacement()` ne
  // redessine pas s'il en trouve un, et un deplacement suivant doit pouvoir
  // reafficher le sien.
  $('#tunnelDeplacement')?.remove();

  poserTexte($('.tunnel-confirme'), "C'est déplacé");

  const avec = rdv.staffName ? `, avec ${rdv.staffName}` : '';
  poserTexte($('#confirmationPhrase'),
    `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}${avec}.`);

  peindreFiche($('#confirmationFiche'), { reference: rdv.reference });

  RESERVATION.pourAgenda = {
    date: rdv.date,
    start: rdv.start,
    duree: rdv.duration ?? RESERVATION.prestation?.duration,
    prestation: rdv.serviceName || RESERVATION.prestation?.name || '',
    avec: rdv.staffName ?? '',
    reference: rdv.reference,
  };

  // La note porte un lien vers /annuler : on la remplace par du texte, donc on
  // garde l'originale pour la remettre si le visiteur enchaine sur une nouvelle
  // reservation (`recommencer()`).
  const note = $('#confirmationNote');
  if (note) {
    if (NOTE_CONFIRMATION.html === null) NOTE_CONFIRMATION.html = note.innerHTML;
    poserTexte(note,
      `Même référence qu'avant : ${rdv.reference}. L'ancien créneau est libéré.`);
  }

  // >>> LES TROIS MEMES ACTIONS QU'APRES UNE RESERVATION. <<<
  //
  // « Annuler ce rendez-vous » disparaissait apres un deplacement. Le motif
  // ecrit ici etait juste — le bouton s'appuyait sur le jeton remis a la
  // reservation, que ce chemin n'a pas toujours — mais la conclusion ne l'etait
  // pas : l'annulation par reference existe (`POST /api/rendez-vous/annuler`),
  // et la preuve qui vient de servir au deplacement lui convient telle quelle,
  // jeton OU quatre chiffres. On la garde donc pour l'ecran de confirmation.
  RESERVATION.preuve = preuve;
  montrer($('#annulerReservation'), true);
  afficherMessage($('#messageAnnulation'), '');

  RESERVATION.deplacement = null;
  allerEtape(4);
}

/** Repart de l'etape 1, saisie effacee. */
function recommencer() {
  RESERVATION.prestation = null;
  RESERVATION.staffId = '';
  RESERVATION.date = '';
  RESERVATION.creneau = null;
  RESERVATION.confirmee = null;
  RESERVATION.deplacement = null;
  RESERVATION.pourAgenda = null;

  RESERVATION.preuve = null;

  // L'etape 3 avait pu etre deshabillee pour un deplacement : elle redevient
  // ce qu'elle est par defaut, sans quoi le rendez-vous suivant se prendrait
  // sans nom ni telephone. LA FRISE AVEC ELLE : elle disait « Confirmer »
  // pendant le deplacement, et le rendez-vous suivant demande bien des
  // coordonnees.
  libelleFrise(3, 'Coordonnées');
  poserTexte($('#titreEtape3'), 'À quel nom ?');
  poserTexte($('#introEtape3'), "Deux champs, et c'est réservé. Rien à payer maintenant.");
  montrer($('#tunnelCoordonnees'), true);
  poserTexte($('#validerReservation'), 'Réserver ce créneau');
  poserTexte($('.tunnel-confirme'), "C'est réservé");
  $('#tunnelDeplacement')?.remove();

  const note = $('#confirmationNote');
  if (note && NOTE_CONFIRMATION.html !== null) note.innerHTML = NOTE_CONFIRMATION.html;

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

  // Ouvrir un rayon amene son contenu dans la vue.
  //
  // ⚠️ EN CAPTURE, ET C'EST OBLIGATOIRE : l'evenement `toggle` d'un `<details>`
  //    NE REMONTE PAS. Un ecouteur ordinaire pose sur le conteneur ne le verrait
  //    jamais. La capture, elle, descend jusqu'a la cible.
  //
  // Pose sur le conteneur plutot que sur chaque rayon : ils sont repeints a
  // chaque enregistrement des reglages.
  //
  // `block: 'nearest'` ne bouge RIEN quand le rayon est deja entierement
  // visible — le cas courant sur un ecran d'ordinateur — et fait le minimum
  // sinon. C'est le complement de `overflow-anchor: none` (styles/13-tunnel.css) :
  // celui-la empeche la page de partir toute seule, celui-ci va chercher le
  // contenu quand il depasse par le bas.
  //
  // ⚠️ AUCUN `behavior: 'smooth'`. Le saut est instantane, comme celui des
  //    ancres du sommaire : styles/03-fondations.css explique pourquoi le site
  //    n'a pas de defilement anime, et une exception ici serait la premiere.
  $('#tunnelRayons')?.addEventListener('toggle', (evenement) => {
    const rayon = evenement.target;
    if (rayon.open) rayon.scrollIntoView({ block: 'nearest' });
  }, true);

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

  // « Ajouter à mon agenda » (js/07-mon-agenda.js). Le fichier de l'agenda pose
  // lui-meme son ecouteur, ou retire le bouton si le navigateur ne sait pas
  // telecharger ce qu'on fabrique sur place.
  preparerBoutonAgenda();
}
