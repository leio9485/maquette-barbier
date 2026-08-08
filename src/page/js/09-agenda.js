// ---------------------------------------------------------------------------
// L'AGENDA
//
// L'ecran que le commercant ouvre vingt fois par jour.
//
// ⚠️ UNE LISTE DE RENDEZ-VOUS, PLUS UNE GRILLE HORAIRE.
//
// C'etait une grille : une colonne par personne, une case cliquable toutes les
// demi-heures de l'ouverture a la fermeture, les rendez-vous poses dessus en
// position absolue. Un samedi de 8h30 a 17h faisait dix-sept cases par
// personne, cinquante et une en tout — pour trois rendez-vous. Le commercant
// ouvrait son agenda et voyait du vide quadrille.
//
// Une journee de barbier n'est pas un emploi du temps a remplir : c'est une
// liste de gens qui passent. On affiche donc les rendez-vous, dans l'ordre, et
// rien d'autre. Le vide ne se dessine pas — il se dit en une ligne.
//
// Ce qui a ete conserve : « Noter un rendez-vous » est un bouton en tete plutot
// qu'un clic dans une case vide, et il ouvre le meme formulaire.
// ---------------------------------------------------------------------------

/** Les rendez-vous de la periode affichee, ranges par jour. */
let AGENDA = new Map();

/** Les personnes actives, pour nommer qui prend le rendez-vous. */
function equipeActive() {
  return (CONFIG?.staff ?? []).filter((p) => p.active !== false);
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

  cible.dataset.vue = ESPACE.vue;
  cible.innerHTML = joursAffiches().map(peindreJour).join('');
}

/** Les rendez-vous d'un jour, dans l'ordre, blocages compris. */
function rdvTriesDe(iso) {
  return [...(AGENDA.get(iso) ?? [])].sort((a, b) => a.start - b.start);
}

/** « 3 rendez-vous », « 1 rendez-vous », « — ». */
function compteDe(liste) {
  const vrais = liste.filter((r) => r.type !== 'block').length;
  if (!vrais) return '';
  return vrais > 1 ? `${vrais} rendez-vous` : '1 rendez-vous';
}

/**
 * Une journee.
 *
 * En vue jour comme en vue semaine : meme forme, meme balisage. C'est ce qui
 * fait que la semaine n'est pas un second dessin a maintenir — c'est sept fois
 * la journee, en plus resserre (voir 15-agenda.css).
 */
function peindreJour(iso) {
  const liste = rdvTriesDe(iso);
  const ouvert = plagesDuJour(CONFIG?.hours[jourDeLaSemaine(iso)]).length > 0;

  const nom = dateLongue(iso);
  const compte = compteDe(liste);

  const tete = `<div class="agenda-jour-tete"${iso === aujourdhui() ? ' data-aujourdhui' : ''}>`
    + `<p class="agenda-jour-nom">${esc(nom.charAt(0).toUpperCase() + nom.slice(1))}`
      + (iso === aujourdhui() ? ' <span class="agenda-marque">Aujourd\'hui</span>' : '')
    + '</p>'
    + `<p class="agenda-jour-compte donnee">${esc(compte || (ouvert ? 'Rien de prévu' : 'Fermé'))}</p>`
    + '</div>';

  // Un jour ferme SANS rendez-vous ne montre rien de plus. Un jour ferme AVEC
  // un rendez-vous, si : c'est une exception qu'il faut voir, pas cacher.
  if (!liste.length) {
    return `<section class="agenda-jour">${tete}</section>`;
  }

  return `<section class="agenda-jour">${tete}`
    + `<ul class="agenda-liste">${liste.map((r) => ligneRdv(r, iso)).join('')}</ul>`
    + '</section>';
}

/**
 * Une ligne de rendez-vous, dans la langue du site : l'heure en chasse fixe a
 * gauche, le nom, la prestation, la personne.
 *
 * La couleur de la personne tient dans un filet de 3 px a gauche, et son PRENOM
 * est ecrit a cote : une information portee par la seule couleur est une
 * information perdue pour qui ne la distingue pas — et le commercant qui
 * imprime sa journee en noir et blanc est dans ce cas.
 */
function ligneRdv(rdv, iso) {
  const fin = fmtHeure(rdv.start + rdv.duration);

  if (rdv.type === 'block') {
    return '<li class="agenda-ligne agenda-ligne-bloc">'
      + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
      + '<span class="agenda-corps">'
        + `<span class="agenda-nom">${esc(rdv.notes || 'Bloqué')}</span>`
        + '<span class="agenda-quoi">Période bloquée</span>'
      + '</span>'
      + '</li>';
  }

  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);

  const detail = [prestation?.name, fmtDuree(rdv.duration)].filter(Boolean).join(' · ');

  return '<li class="agenda-ligne">'
    + `<button type="button" class="agenda-rdv" data-rdv="${esc(rdv.id)}" data-source="${esc(rdv.source || '')}"`
      + (personne ? ` style="--teinte:${esc(personne.color || '#24405C')}"` : '')
      + `>`
      + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
      + '<span class="agenda-corps">'
        + `<span class="agenda-nom">${esc(rdv.name)}</span>`
        + `<span class="agenda-quoi">${esc(detail)}</span>`
      + '</span>'
      + '<span class="agenda-cote donnee">'
        + (personne ? `<span class="agenda-qui">${esc(personne.name)}</span>` : '')
        + (rdv.phone ? `<span class="agenda-tel">${esc(rdv.phone)}</span>` : '')
      + '</span>'
    + '</button>'
    + '</li>';
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

  const colonnes = equipeActive();
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
  const colonnes = equipeActive();
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

  // Les cases vides cliquables ont disparu avec la grille : on note un
  // rendez-vous par le bouton en tete, qui ouvre le meme formulaire.
  $('#agenda')?.addEventListener('click', (evenement) => {
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
