// ---------------------------------------------------------------------------
// L'AGENDA
//
// L'ecran que le commercant ouvre vingt fois par jour. Vue jour ou semaine, une
// colonne par personne des qu'il y en a deux d'actives.
//
// LA REGLE DE POSITION : une minute vaut `ECHELLE` pixels. Tout le reste en
// decoule — la hauteur d'un rendez-vous, la place d'un blocage, la position
// d'une case vide. Une seule constante a changer pour resserrer ou aerer.
// ---------------------------------------------------------------------------

/** Hauteur d'une minute, en pixels. 32 px pour 30 minutes. */
const ECHELLE = 32 / 30;

/** Les rendez-vous de la periode affichee, ranges par jour. */
let AGENDA = new Map();

/** L'amplitude d'une journee : de la premiere ouverture a la derniere fermeture. */
function amplitudeDuJour(iso) {
  const plages = plagesDuJour(CONFIG?.hours[jourDeLaSemaine(iso)]);
  if (!plages.length) return null;
  return [plages[0][0], plages[plages.length - 1][1]];
}

/** Les personnes qui ont une colonne. Vide = un seul agenda, sans colonne. */
function colonnesDe() {
  const equipe = (CONFIG?.staff ?? []).filter((p) => p.active !== false);
  return equipe.length >= 2 ? equipe : [];
}

/** Les jours affiches, selon la vue. */
function joursAffiches() {
  if (ESPACE.vue === 'jour') return [ESPACE.date];
  const lundi = lundiDe(ESPACE.date);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => plusDeJours(lundi, n));
}

// --- Le chargement ----------------------------------------------------------

async function chargerAgenda() {
  const jours = joursAffiches();
  const du = jours[0];
  const au = jours[jours.length - 1];

  poserTexte($('#agendaPeriode'), ESPACE.vue === 'jour'
    ? dateLongue(du)
    : `${dateCourte(du)} – ${dateCourte(au)}`);

  try {
    const reponse = await lireRendezVous(du, au);

    AGENDA = new Map();
    for (const rdv of reponse.bookings ?? reponse) {
      if (!AGENDA.has(rdv.date)) AGENDA.set(rdv.date, []);
      AGENDA.get(rdv.date).push(rdv);
    }

    afficherMessage($('#messageAgenda'), '');
    peindreAgenda();
  } catch (erreur) {
    // Session expiree : on renvoie a la connexion plutot que d'afficher un
    // agenda vide qui ferait croire a une journee sans rendez-vous.
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

// --- Le dessin --------------------------------------------------------------

function peindreAgenda() {
  const cible = $('#agenda');
  if (!cible || !CONFIG) return;

  cible.innerHTML = joursAffiches().map(peindreJour).join('');
}

function peindreJour(iso) {
  const amplitude = amplitudeDuJour(iso);
  const colonnes = colonnesDe();
  const rdvDuJour = AGENDA.get(iso) ?? [];

  const titre = `<p class="agenda-jour-titre"${iso === aujourdhui() ? ' data-aujourdhui' : ''}>`
    + esc(dateLongue(iso)) + '</p>';

  // Jour de fermeture habituelle : on le dit, et on ne dessine pas de grille
  // vide de douze heures pour rien.
  if (!amplitude) {
    return `<div class="agenda-jour">${titre}`
      + '<p class="secondaire petit">Fermé.</p></div>';
  }

  const [ouverture, fermeture] = amplitude;
  const hauteur = (fermeture - ouverture) * ECHELLE;

  // La colonne des heures, une ligne par demi-heure.
  const heures = [];
  for (let t = ouverture; t < fermeture; t += 30) {
    heures.push(`<div class="agenda-heure">${fmtHeure(t)}</div>`);
  }

  const pistes = colonnes.length
    ? colonnes.map((p) => pisteDe(iso, p, ouverture, fermeture, rdvDuJour)).join('')
    : pisteDe(iso, null, ouverture, fermeture, rdvDuJour);

  return `<div class="agenda-jour">${titre}`
    + `<div class="agenda-colonnes" style="--colonnes:${colonnes.length || 1}">`
      + `<div class="agenda-heures">${heures.join('')}</div>`
      + pistes
    + '</div></div>';
}

/**
 * Une colonne : son en-tete, ses rendez-vous, ses zones inaccessibles.
 *
 * `personne` a `null` quand le commerce n'a pas d'equipe : il y a alors une
 * seule piste, et l'en-tete disparait — un agenda a une colonne n'a pas besoin
 * qu'on lui dise de qui elle est.
 */
function pisteDe(iso, personne, ouverture, fermeture, rdvDuJour) {
  const hauteur = (fermeture - ouverture) * ECHELLE;
  const haut = (minutes) => (minutes - ouverture) * ECHELLE;

  const tete = personne
    ? `<div class="agenda-colonne-tete" data-couleur style="border-bottom-color:${esc(personne.color || '#24405C')}">${esc(personne.name)}</div>`
    : '';

  const elements = [];

  // Ce qui n'appartient a personne — la pause du midi, et les heures hors des
  // horaires propres de cette personne. Dessine AVANT les rendez-vous : c'est
  // le fond, pas le contenu.
  for (const [debut, fin] of creuxDe(iso, personne, ouverture, fermeture)) {
    elements.push(`<div class="agenda-hors" style="top:${haut(debut)}px;height:${(fin - debut) * ECHELLE}px"></div>`);
  }

  // Les cases cliquables, toutes les 30 minutes. Cliquer ouvre le formulaire
  // avec la date, l'heure et la personne deja remplies : c'est le geste le plus
  // frequent de la journee, un client au telephone qu'on cale tout de suite.
  for (let t = ouverture; t < fermeture; t += 30) {
    elements.push(`<button type="button" class="agenda-creux"`
      + ` style="top:${haut(t)}px;height:${30 * ECHELLE}px"`
      + ` data-caler="${esc(iso)}" data-heure="${t}"`
      + (personne ? ` data-qui="${esc(personne.id)}"` : '')
      + ` aria-label="Noter un rendez-vous le ${esc(dateLongue(iso))} à ${fmtHeure(t)}"></button>`);
  }

  for (const rdv of rdvDuJour) {
    // Un rendez-vous sans personne attribuee occupe TOUT LE MONDE : c'est la
    // regle du serveur, et l'agenda doit la montrer telle quelle. Il apparait
    // donc dans chaque colonne.
    if (personne && rdv.staffId && rdv.staffId !== personne.id) continue;

    if (rdv.type === 'block') {
      elements.push(`<div class="agenda-bloc" style="top:${haut(rdv.start)}px;height:${rdv.duration * ECHELLE}px">`
        + esc(rdv.notes || 'Bloqué') + '</div>');
      continue;
    }

    const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);

    elements.push(`<button type="button" class="agenda-rdv"`
      + ` style="top:${haut(rdv.start)}px;height:${rdv.duration * ECHELLE}px;border-left-color:${esc(couleurDe(rdv))}"`
      + ` data-rdv="${esc(rdv.id)}" data-source="${esc(rdv.source || '')}"`
      + ` title="${esc(`${fmtHeure(rdv.start)} — ${rdv.name}${rdv.phone ? ' · ' + rdv.phone : ''}`)}">`
      + `<span class="agenda-rdv-heure">${fmtHeure(rdv.start)}</span>`
      + `<span class="agenda-rdv-nom">${esc(rdv.name)}</span>`
      + `<span class="agenda-rdv-quoi">${esc(prestation?.name ?? '')}</span>`
      + '</button>');
  }

  return `<div class="agenda-colonne">${tete}`
    + `<div class="agenda-piste" style="height:${hauteur}px">${elements.join('')}</div>`
    + '</div>';
}

/** La couleur de la personne qui assure ce rendez-vous. */
function couleurDe(rdv) {
  return CONFIG?.staff.find((s) => s.id === rdv.staffId)?.color || '#16191B';
}

/**
 * Les moments ou cette colonne ne peut rien recevoir : la pause du commerce, et
 * les heures hors des horaires propres de la personne.
 *
 * Calcule par difference entre l'amplitude affichee et les plages reellement
 * travaillees — la meme lecture que `plagesTravaillees()` cote serveur.
 */
function creuxDe(iso, personne, ouverture, fermeture) {
  const jour = jourDeLaSemaine(iso);

  const duCommerce = plagesDuJour(CONFIG.hours[jour]);
  const siennes = personne?.hours ? plagesDuJour(personne.hours[jour]) : null;

  // L'intersection : les horaires d'une personne ne peuvent que REDUIRE ceux du
  // commerce, jamais les etendre.
  const travaillees = siennes
    ? duCommerce.flatMap(([o1, f1]) => siennes
      .map(([o2, f2]) => [Math.max(o1, o2), Math.min(f1, f2)])
      .filter(([o, f]) => f > o))
    : duCommerce;

  const creux = [];
  let curseur = ouverture;

  for (const [debut, fin] of travaillees.sort((a, b) => a[0] - b[0])) {
    if (debut > curseur) creux.push([curseur, debut]);
    curseur = Math.max(curseur, fin);
  }
  if (curseur < fermeture) creux.push([curseur, fermeture]);

  return creux;
}

// --- Les actions ------------------------------------------------------------

/** Ouvre le formulaire de rendez-vous, pre-rempli si on vient d'une case. */
function ouvrirAjout({ date = ESPACE.date, heure = null, qui = '' } = {}) {
  const choixPrestation = $('#rdvPrestation');
  if (choixPrestation && CONFIG) {
    choixPrestation.innerHTML = CONFIG.services
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${fmtDuree(s.duration)}</option>`)
      .join('');
  }

  const colonnes = colonnesDe();
  const choixQui = $('#rdvQui');
  montrer($('#champRdvQui'), colonnes.length > 0);
  if (choixQui && colonnes.length) {
    choixQui.innerHTML = '<option value="">Peu importe</option>'
      + colonnes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    choixQui.value = qui;
  }

  const champDate = $('#rdvDate');
  if (champDate) champDate.value = date;

  afficherMessage($('#messageRdv'), '');
  chargerHeuresRdv(heure);

  ouvrirSurimpression('surimpressionRdv');
}

/** Les heures proposees au commercant : sans delai minimum, pauses comprises. */
async function chargerHeuresRdv(heureVoulue = null) {
  const choix = $('#rdvHeure');
  const date = $('#rdvDate')?.value;
  const serviceId = $('#rdvPrestation')?.value;
  if (!choix || !date || !serviceId) return;

  try {
    const reponse = await lireCreneauxAdmin(date, serviceId, $('#rdvQui')?.value || '');

    choix.innerHTML = reponse.slots
      .map((c) => `<option value="${c.start}"${c.free ? '' : ' disabled'}>`
        + `${esc(c.label)}${c.free ? '' : ' — pris'}</option>`)
      .join('');

    if (heureVoulue !== null) {
      const existe = reponse.slots.some((c) => c.start === heureVoulue && c.free);
      if (existe) choix.value = String(heureVoulue);
    }
  } catch (erreur) {
    choix.innerHTML = '';
    afficherMessage($('#messageRdv'), erreur.message);
  }
}

async function envoyerRdv(evenement) {
  evenement.preventDefault();
  const message = $('#messageRdv');

  const nom = $('#rdvNom')?.value.trim();
  if (!nom) return afficherMessage(message, 'Il faut un nom.');

  const heure = Number($('#rdvHeure')?.value);
  if (!Number.isInteger(heure)) return afficherMessage(message, 'Choisissez une heure.');

  try {
    await poserRendezVous({
      date: $('#rdvDate').value,
      start: heure,
      serviceId: $('#rdvPrestation').value,
      staffId: $('#rdvQui')?.value || undefined,
      name: nom,
      phone: $('#rdvTel')?.value.trim() || '',
      source: 'phone',
    });

    fermerSurimpression('surimpressionRdv');
    $('#formulaireRdv').reset();
    await chargerAgenda();
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  }
}

/** Annule un rendez-vous depuis l'agenda. */
async function retirerRdv(id) {
  const rdv = [...AGENDA.values()].flat().find((r) => r.id === id);
  if (!rdv) return;

  const quoi = `${rdv.name}, ${dateCourte(rdv.date)} à ${fmtHeure(rdv.start)}`;
  if (!window.confirm(`Annuler le rendez-vous de ${quoi} ?`)) return;

  try {
    await supprimerRendezVous(id);
    await chargerAgenda();
  } catch (erreur) {
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

async function envoyerBlocage(evenement) {
  evenement.preventDefault();
  const message = $('#messageBlocage');

  const du = $('#blocageDu')?.value;
  const au = $('#blocageAu')?.value;
  if (!du || !au) return afficherMessage(message, 'Il faut une date de début et une date de fin.');

  try {
    const reponse = await bloquerPeriode({
      date: du,
      to: au,
      staffId: $('#blocageQui')?.value || undefined,
      notes: $('#blocageMotif')?.value.trim() || 'Fermé',
    });

    fermerSurimpression('surimpressionBlocage');
    $('#formulaireBlocage').reset();
    await chargerAgenda();

    // Les jours de fermeture habituelle sont sautes par le serveur : on le dit,
    // sinon le commercant compte ses jours et croit a une erreur.
    //
    // La cle est `skipped`, et le serveur ne la renvoie QUE pour une periode de
    // plusieurs jours — une journee unique repond par le blocage lui-meme.
    const sautes = reponse?.skipped ?? 0;
    if (sautes) {
      afficherMessage($('#messageAgenda'),
        `Période bloquée. ${sautes} jour${sautes > 1 ? 's' : ''} de fermeture habituelle ${sautes > 1 ? 'ont' : 'a'} été ignoré${sautes > 1 ? 's' : ''}.`,
        'bon');
    }
  } catch (erreur) {
    afficherMessage(message, erreur.message);
  }
}

function ouvrirBlocage() {
  const colonnes = colonnesDe();
  const choix = $('#blocageQui');

  montrer($('#champBlocageQui'), colonnes.length > 0);
  if (choix && colonnes.length) {
    choix.innerHTML = '<option value="">Tout le commerce</option>'
      + colonnes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  }

  const du = $('#blocageDu');
  const au = $('#blocageAu');
  if (du) du.value = ESPACE.date;
  if (au) au.value = ESPACE.date;

  afficherMessage($('#messageBlocage'), '');
  ouvrirSurimpression('surimpressionBlocage');
}

// --- Le branchement ---------------------------------------------------------

function brancherAgenda() {
  $('#agendaPrecedent')?.addEventListener('click', () => {
    ESPACE.date = plusDeJours(ESPACE.date, ESPACE.vue === 'jour' ? -1 : -7);
    chargerAgenda();
  });

  $('#agendaSuivant')?.addEventListener('click', () => {
    ESPACE.date = plusDeJours(ESPACE.date, ESPACE.vue === 'jour' ? 1 : 7);
    chargerAgenda();
  });

  $('#agendaAujourdhui')?.addEventListener('click', () => {
    ESPACE.date = aujourdhui();
    chargerAgenda();
  });

  for (const bouton of $$('input[name="agendaVue"]')) {
    bouton.addEventListener('change', () => {
      ESPACE.vue = bouton.value;
      chargerAgenda();
    });
  }

  $('#ouvrirAjoutRdv')?.addEventListener('click', () => ouvrirAjout());
  $('#ouvrirBlocage')?.addEventListener('click', ouvrirBlocage);

  $('#agenda')?.addEventListener('click', (evenement) => {
    const creux = evenement.target.closest('[data-caler]');
    if (creux) {
      return ouvrirAjout({
        date: creux.dataset.caler,
        heure: Number(creux.dataset.heure),
        qui: creux.dataset.qui || '',
      });
    }

    const rdv = evenement.target.closest('[data-rdv]');
    if (rdv) retirerRdv(rdv.dataset.rdv);
  });

  // Changer de prestation ou de personne change les heures possibles.
  $('#rdvPrestation')?.addEventListener('change', () => chargerHeuresRdv());
  $('#rdvQui')?.addEventListener('change', () => chargerHeuresRdv());
  $('#rdvDate')?.addEventListener('change', () => chargerHeuresRdv());

  $('#formulaireRdv')?.addEventListener('submit', envoyerRdv);
  $('#formulaireBlocage')?.addEventListener('submit', envoyerBlocage);
}
