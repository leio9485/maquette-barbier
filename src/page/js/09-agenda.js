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

/**
 * Les numeros qui cumulent au moins deux absences, et combien.
 *
 * Charge une fois avec l'agenda plutot qu'interroge rendez-vous par
 * rendez-vous : la solution naive ferait cinquante allers-retours pour une
 * semaine. Le serveur ne renvoie QUE ceux qui atteignent le seuil — envoyer la
 * liste entiere reviendrait a exporter le repertoire du commerce a chaque
 * ouverture de l'agenda.
 */
let ABSENCES = { seuil: 2, absences: {} };

/**
 * Le meme calcul de cle que le serveur (src/lib/statistiques.js).
 *
 * ⚠️ LES DEUX DOIVENT RESTER IDENTIQUES. Si l'un normalise « +33 6 39… » et pas
 *    l'autre, le marqueur ne s'affichera jamais pour les numeros ecrits au
 *    format international — sans que rien ne le signale.
 */
function clePhone(telephone) {
  if (typeof telephone !== 'string') return '';
  let chiffres = telephone.replace(/\D/g, '');
  if (chiffres.startsWith('33') && chiffres.length === 11) chiffres = '0' + chiffres.slice(2);
  return chiffres;
}

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

    // Les absences en meme temps que l'agenda, et sans le retenir : leur echec
    // ne doit pas empecher la journee de s'afficher. Sans elles, le marqueur ne
    // s'affiche pas — c'est tout.
    lireAbsences()
      .then((liste) => { ABSENCES = liste; peindreAgenda(); })
      .catch(() => { /* le marqueur est un confort, pas une fonction */ });

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

/**
 * Les rendez-vous d'un jour, dans l'ordre, blocages compris.
 *
 * ⚠️ LES BLOCAGES PASSENT DEVANT, A HEURE EGALE. Un blocage couvre la journee
 *    entiere : il commence donc a l'ouverture, c'est-a-dire souvent a la meme
 *    minute que le premier rendez-vous, et il se retrouvait range au hasard au
 *    milieu de la liste. « Le commerce est ferme ce jour-la » est la premiere
 *    chose a lire d'une journee, pas la troisieme.
 */
function rdvTriesDe(iso) {
  const rang = (r) => (r.type === 'block' ? 0 : 1);
  return [...(AGENDA.get(iso) ?? [])]
    .sort((a, b) => a.start - b.start || rang(a) - rang(b));
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

  // ⚠️ UNE PERIODE BLOQUEE EST UN BOUTON, comme un rendez-vous.
  //
  // C'etait un `<li>` inerte : aucun bouton, aucun `data-`, aucune action. Un
  // barbier qui se trompait d'une semaine en posant ses conges fermait sa
  // boutique en ligne SANS AUCUN RECOURS, et devait appeler l'editeur. Creer un
  // blocage demandait un formulaire complet, le lever etait impossible.
  //
  // La personne concernee est ecrite a cote, comme pour un rendez-vous : le
  // commercant doit voir d'un coup d'oeil si c'est le commerce entier qui ferme
  // ou une seule personne qui s'absente.
  if (rdv.type === 'block') {
    const absent = CONFIG.staff.find((s) => s.id === rdv.staffId);

    return '<li class="agenda-ligne">'
      + `<button type="button" class="agenda-bloc" data-bloc="${esc(rdv.id)}">`
        + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
        + '<span class="agenda-corps">'
          + `<span class="agenda-nom">${esc(rdv.notes || 'Bloqué')}</span>`
          + '<span class="agenda-quoi">Période bloquée</span>'
        + '</span>'
        + '<span class="agenda-cote donnee">'
          + `<span class="agenda-qui">${esc(absent ? absent.name : 'Tout le commerce')}</span>`
        + '</span>'
      + '</button>'
      + '</li>';
  }

  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);

  const detail = [prestation?.name, fmtDuree(rdv.duration)].filter(Boolean).join(' · ');

  // Un rendez-vous que le CLIENT a annule reste affiche, barre. Le faire
  // disparaitre priverait le commercant de la seule chose qu'il a a en
  // apprendre : un creneau s'est libere sans qu'il y soit pour rien.
  const annule = Boolean(rdv.cancelledAt);

  // Le marqueur d'absences : discret, cote commercant seulement, JAMAIS de
  // conséquence automatique. C'est une information, le patron décide.
  const absences = ABSENCES.absences?.[clePhone(rdv.phone)] ?? 0;
  const marque = absences >= (ABSENCES.seuil ?? 2)
    ? `<span class="agenda-absences" title="${esc(absences)} absences constatées">${esc(absences)} abs.</span>`
    : '';

  return `<li class="agenda-ligne"${annule ? ' data-annule' : ''}>`
    + `<button type="button" class="agenda-rdv" data-rdv="${esc(rdv.id)}" data-source="${esc(rdv.source || '')}"`
      + (personne ? ` style="--teinte:${esc(personne.color || '#24405C')}"` : '')
      + `>`
      + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
      + '<span class="agenda-corps">'
        + `<span class="agenda-nom">${esc(rdv.name)}${marque}</span>`
        + `<span class="agenda-quoi">${esc(detail)}${annule ? ' · annulé par le client' : ''}</span>`
      + '</span>'
      + '<span class="agenda-cote donnee">'
        + (personne ? `<span class="agenda-qui">${esc(personne.name)}</span>` : '')
        + (rdv.phone ? `<span class="agenda-tel">${esc(rdv.phone)}</span>` : '')
      + '</span>'
    + '</button>'
    + pointage(rdv, iso, annule)
    + '</li>';
}

/**
 * Les deux boutons « Venu » / « Pas venu », sur les rendez-vous PASSES.
 *
 * Ils n'apparaissent pas avant : pointer un rendez-vous de la semaine
 * prochaine n'a aucun sens, et deux boutons de plus sur chaque ligne d'une
 * journee a venir encombreraient l'ecran qu'on ouvre vingt fois par jour.
 *
 * Un rendez-vous annule n'a personne a pointer.
 *
 * ⚠️ ON PEUT REVENIR EN ARRIERE : cliquer le bouton deja actif l'efface. Le
 *    cas le plus frequent d'un pointage est le clic a cote, et un etat qu'on ne
 *    peut pas defaire ferait hesiter avant chacun.
 */
function pointage(rdv, iso, annule) {
  if (annule || iso >= aujourdhui()) return '';

  const bouton = (valeur, libelle) => {
    const actif = rdv.presence === valeur;
    return `<button type="button" class="agenda-pointage" data-pointage="${esc(rdv.id)}"`
      + ` data-valeur="${esc(valeur)}"${actif ? ' aria-pressed="true"' : ' aria-pressed="false"'}>`
      + `${esc(libelle)}</button>`;
  };

  return '<span class="agenda-pointages">'
    + bouton('venu', 'Venu')
    + bouton('absent', 'Pas venu')
    + '</span>';
}

/** Enregistre le pointage, ou l'annule si on reclique le meme. */
async function pointer(id, valeur) {
  const rdv = [...AGENDA.values()].flat().find((r) => r.id === id);
  if (!rdv) return;

  const nouvelle = rdv.presence === valeur ? null : valeur;

  try {
    await pointerPresence(id, nouvelle);
    rdv.presence = nouvelle;

    // Le nombre d'absences a pu changer : on relit, puis on repeint une fois.
    try { ABSENCES = await lireAbsences(); } catch { /* sans consequence */ }
    peindreAgenda();
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
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

  // Le champ fautif se signale au lecteur d'ecran ET reprend le focus, comme
  // dans le tunnel : un message qui n'apparait qu'a l'ecran ne dit rien a
  // quelqu'un qui ne le voit pas (lot 5).
  marquerRefus($('#rdvNom'), false);
  marquerRefus($('#rdvHeure'), false);

  const nom = $('#rdvNom')?.value.trim();
  if (!nom) {
    afficherMessage(message, 'Il faut un nom.');
    marquerRefus($('#rdvNom'), true, 'messageRdv');
    $('#rdvNom')?.focus();
    return;
  }

  const heure = Number($('#rdvHeure')?.value);
  if (!Number.isInteger(heure)) {
    afficherMessage(message, 'Choisissez une heure.');
    marquerRefus($('#rdvHeure'), true, 'messageRdv');
    $('#rdvHeure')?.focus();
    return;
  }

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

// --- LA FICHE D'UNE LIGNE D'AGENDA ------------------------------------------
//
// >>> LE CLIC SUR UNE LIGNE OUVRE UNE FICHE. IL NE SUPPRIME PLUS RIEN. <<<
//
// Il demandait directement « Annuler le rendez-vous de X ? » dans une fenetre
// native. Deux choses clochaient. La premiere : ce n'est pas ce qu'on veut en
// cliquant sur une ligne d'agenda — on veut voir le telephone en entier, la
// prestation, la reference, savoir si le rendez-vous a ete pris en ligne ou
// note a la main. La seconde : la seule action possible etait irreversible, et
// elle etait cachee derriere un clic qu'on fait par curiosite.
//
// La suppression vit maintenant DANS la fiche, derriere un bouton nomme, et sa
// confirmation nomme le client, le jour, l'heure et la personne.

/** La ligne d'agenda actuellement ouverte en fiche. */
let FICHE_OUVERTE = null;

/** Le rendez-vous, retrouve dans ce que l'agenda a en memoire. */
function rdvConnu(id) {
  return [...AGENDA.values()].flat().find((r) => r.id === id) ?? null;
}

/** « en ligne » / « noté par le salon » — deux choses tres differentes a lire. */
function origineDe(rdv) {
  return rdv.source === 'online' ? 'Pris en ligne par le client' : 'Noté par le salon';
}

/** Ouvre la fiche d'un rendez-vous client. */
function ouvrirFicheRdv(id) {
  const rdv = rdvConnu(id);
  if (!rdv) return;

  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);

  FICHE_OUVERTE = { genre: 'rdv', rdv };

  poserTexte($('#titreFicheAgenda'), rdv.name || 'Rendez-vous');

  const lignes = [
    ['Quand', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)} → ${fmtHeure(rdv.start + rdv.duration)}`],
    ['Prestation', prestation?.name ?? 'Prestation retirée'],
    ['Durée', fmtDuree(rdv.duration)],
    ['Avec', personne?.name ?? ''],
    ['À régler', rdv.price === null || rdv.price === undefined ? '' : fmtPrix(rdv.price)],
    ['Téléphone', rdv.phone ?? ''],
    ['Courriel', rdv.email ?? ''],
    ['Référence', rdv.reference ?? ''],
    ['Origine', origineDe(rdv)],
    ['Note', rdv.notes ?? ''],
  ];

  if (rdv.cancelledAt) lignes.push(['Annulé par le client', dateCourte(rdv.cancelledAt.slice(0, 10))]);
  if (rdv.presence === 'venu') lignes.push(['Pointé', 'Venu']);
  if (rdv.presence === 'absent') lignes.push(['Pointé', 'Pas venu']);

  peindreFicheDeTravail($('#ficheAgenda'), lignes);

  // Le telephone se TOUCHE : sur le telephone du commercant, c'est ce qui
  // permet de rappeler quelqu'un sans le recopier. On le repasse en lien apres
  // coup plutot que dans la fiche, qui n'ecrit que du texte.
  poserLienTelephone($('#ficheAgenda'), rdv.phone);

  poserTexte($('#ficheSupprimer'), 'Supprimer ce rendez-vous');
  afficherMessage($('#messageFicheAgenda'), '');
  ouvrirSurimpression('surimpressionFiche');
}

/** Ouvre la fiche d'une periode bloquee. */
async function ouvrirFicheBloc(id) {
  const bloc = rdvConnu(id);
  if (!bloc) return;

  const personne = CONFIG.staff.find((s) => s.id === bloc.staffId);

  poserTexte($('#titreFicheAgenda'), bloc.notes || 'Période bloquée');
  peindreFicheDeTravail($('#ficheAgenda'), [['Jour', dateCourte(bloc.date)]]);
  poserTexte($('#ficheSupprimer'), 'Lever ce blocage');
  afficherMessage($('#messageFicheAgenda'), '');
  ouvrirSurimpression('surimpressionFiche');

  // La periode complete se demande au serveur : un blocage est une ligne par
  // jour, et seul lui sait quels jours de fermeture habituelle l'enjambent. La
  // fiche s'ouvre AVANT la reponse, avec ce qu'on sait deja — l'attente n'a pas
  // a se voir sur une boite qui s'ouvre.
  try {
    const periode = await lireBlocage(id);
    FICHE_OUVERTE = { genre: 'bloc', bloc, periode };

    const seulJour = periode.from === periode.to;

    peindreFicheDeTravail($('#ficheAgenda'), [
      ['Qui', personne?.name ?? 'Tout le commerce'],
      ['Du', dateCourte(periode.from)],
      ['Au', dateCourte(periode.to)],
      ['Journées bloquées', String(periode.days)],
      ['Motif', bloc.notes ?? ''],
      ['Heures', `${fmtHeure(bloc.start)} → ${fmtHeure(bloc.start + bloc.duration)}`],
    ]);

    poserTexte($('#ficheSupprimer'), seulJour ? 'Lever ce blocage' : 'Lever toute la période');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    // La periode n'a pas pu etre recomposee : on leve au moins ce jour-la,
    // plutot que de laisser un bouton qui ne fait rien.
    FICHE_OUVERTE = { genre: 'bloc', bloc, periode: { from: bloc.date, to: bloc.date, days: 1 } };
    afficherMessage($('#messageFicheAgenda'), erreur.message);
  }
}

/**
 * Le numero de telephone, repasse en lien `tel:` dans la fiche.
 *
 * `peindreFicheDeTravail()` n'ecrit que du texte, et c'est voulu — tout ce qui
 * vient de la base y passe echappe. On retrouve donc la ligne apres coup, et on
 * n'y met qu'une adresse construite ici, jamais du balisage venu d'ailleurs.
 */
function poserLienTelephone(fiche, telephone) {
  if (!fiche || !telephone) return;

  const ligne = $$('div', fiche).find((d) => d.querySelector('dt')?.textContent === 'Téléphone');
  const valeur = ligne?.querySelector('dd');
  if (!valeur) return;

  const lien = document.createElement('a');
  lien.href = `tel:${telephone.replace(/[^\d+]/g, '')}`;
  lien.textContent = telephone;

  valeur.textContent = '';
  valeur.append(lien);
}

/** Le bouton d'action de la fiche : supprimer un rendez-vous, ou lever un blocage. */
async function agirDepuisFiche() {
  if (!FICHE_OUVERTE) return;

  // La confirmation ne s'empile pas sur la fiche : on ferme, on demande, et on
  // rouvre si la reponse est non (voir js/confirmation.js).
  fermerSurimpression('surimpressionFiche');

  const accepte = FICHE_OUVERTE.genre === 'rdv'
    ? await confirmerSuppressionRdv(FICHE_OUVERTE.rdv)
    : await confirmerLeveeBlocage(FICHE_OUVERTE);

  if (!accepte) {
    ouvrirSurimpression('surimpressionFiche');
    return;
  }

  try {
    let retour;

    if (FICHE_OUVERTE.genre === 'rdv') {
      await supprimerRendezVous(FICHE_OUVERTE.rdv.id);
      retour = `Le rendez-vous de ${FICHE_OUVERTE.rdv.name} a été supprimé.`;
    } else {
      const { bloc, periode } = FICHE_OUVERTE;
      await debloquerPeriode({ date: periode.from, to: periode.to, staffId: bloc.staffId ?? '' });
      retour = periode.days > 1
        ? `Le blocage est levé sur ${periode.days} journées. Les créneaux sont de nouveau réservables.`
        : 'Le blocage est levé. Les créneaux sont de nouveau réservables.';
    }

    FICHE_OUVERTE = null;

    // ⚠️ LE MESSAGE APRES LA RELECTURE, ET PAS AVANT. `chargerAgenda()` efface
    //    `#messageAgenda` quand elle aboutit — c'est ce qu'on veut d'elle, sans
    //    quoi une erreur resterait affichee sur un agenda qui s'est reaffiche.
    //    Annoncer avant, c'etait annoncer dans le vide : la ligne disparaissait
    //    sans un mot, exactement ce que ce retour doit eviter.
    await chargerAgenda();
    annoncer(retour);
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

/**
 * Le retour visible apres une suppression.
 *
 * A defaut d'un vrai « annuler », le commercant doit au moins VOIR que quelque
 * chose s'est passe : une ligne qui disparait sans un mot laisse le doute
 * — a-t-on supprime la bonne ? a-t-on supprime tout court ?
 */
function annoncer(texte) {
  afficherMessage($('#messageAgenda'), texte, 'bon');
}

function confirmerSuppressionRdv(rdv) {
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);
  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);

  const quand = `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}`;
  const avec = personne ? ` avec ${personne.name}` : '';

  return demanderConfirmation({
    titre: 'Supprimer ce rendez-vous',
    phrase: `Supprimer le rendez-vous de ${rdv.name}, ${quand}${avec} ?`,
    lignes: [
      ['Quand', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)}`],
      ['Prestation', prestation?.name ?? ''],
      ['Avec', personne?.name ?? ''],
      ['Téléphone', rdv.phone ?? ''],
    ],
    consequence: 'Le créneau repartira aussitôt à quelqu\'un d\'autre, et le client '
      + 'ne sera pas prévenu. Cette action ne se défait pas.',
    oui: 'Oui, supprimer',
    non: 'Non, le garder',
  });
}

function confirmerLeveeBlocage({ bloc, periode }) {
  const personne = CONFIG.staff.find((s) => s.id === bloc.staffId);
  const qui = personne ? personne.name : 'tout le commerce';
  const seulJour = periode.from === periode.to;

  return demanderConfirmation({
    titre: seulJour ? 'Lever ce blocage' : 'Lever toute la période',
    phrase: seulJour
      ? `Rouvrir le ${dateLongue(periode.from)} pour ${qui} ?`
      : `Rouvrir du ${dateLongue(periode.from)} au ${dateLongue(periode.to)} pour ${qui} ?`,
    lignes: [
      ['Qui', personne?.name ?? 'Tout le commerce'],
      ['Du', dateCourte(periode.from)],
      ['Au', dateCourte(periode.to)],
      ['Journées', String(periode.days)],
      ['Motif', bloc.notes ?? ''],
    ],
    consequence: 'Les créneaux redeviennent réservables en ligne immédiatement. '
      + 'Vous pourrez re-bloquer la période, mais les rendez-vous pris entre-temps resteront.',
    oui: seulJour ? 'Oui, lever le blocage' : 'Oui, lever la période',
    non: 'Non, la garder bloquée',
  });
}

async function envoyerBlocage(evenement) {
  evenement.preventDefault();
  const message = $('#messageBlocage');

  marquerRefus($('#blocageDu'), false);
  marquerRefus($('#blocageAu'), false);

  const du = $('#blocageDu')?.value;
  const au = $('#blocageAu')?.value;
  if (!du || !au) {
    afficherMessage(message, 'Il faut une date de début et une date de fin.');
    marquerRefus($(du ? '#blocageAu' : '#blocageDu'), true, 'messageBlocage');
    $(du ? '#blocageAu' : '#blocageDu')?.focus();
    return;
  }

  // Le motif part tel quel : c'est le serveur qui choisit le libelle de repli
  // quand il est vide, et un seul endroit doit le decider.
  const demande = {
    date: du,
    to: au,
    staffId: $('#blocageQui')?.value || undefined,
    notes: $('#blocageMotif')?.value.trim() || undefined,
  };

  try {
    let reponse;

    try {
      reponse = await bloquerPeriode(demande);
    } catch (erreur) {
      // 409 avec une liste : des rendez-vous sont deja pris sur la periode. Le
      // serveur n'a rien pose, et attend de savoir quoi en faire.
      if (erreur.code !== 409 || !Array.isArray(erreur.donnees?.conflicts)) throw erreur;

      const choix = await deciderDesConflits(erreur.donnees.conflicts);
      if (choix === null) return;

      reponse = await bloquerPeriode({
        ...demande,
        confirmConflicts: true,
        cancelConflicts: choix === 'annuler',
      });
    }

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

/**
 * L'ecran des rendez-vous qu'un blocage va recouvrir.
 *
 * Rend « garder », « annuler », ou `null` si la fenetre est fermee sans choisir
 * — auquel cas rien n'est bloque, et le formulaire reste ouvert tel qu'il etait.
 *
 * Deux boutons qui agissent tous les deux, plus une sortie : c'est pour cela
 * qu'il n'emprunte pas `demanderConfirmation()`, dont la reponse est un oui ou
 * un non. Il en reprend en revanche tous les objets — la liste, l'avertissement,
 * la paire de boutons.
 */
function deciderDesConflits(conflits) {
  const nombre = conflits.length;

  poserTexte($('#phraseConflits'), nombre > 1
    ? `${nombre} rendez-vous sont pris sur cette période. Voici les personnes à rappeler.`
    : 'Un rendez-vous est pris sur cette période. Voici la personne à rappeler.');

  peindreConflits($('#listeConflits'), conflits);
  ouvrirSurimpression('surimpressionConflits');

  return new Promise((resoudre) => {
    const boite = $('#surimpressionConflits');

    const terminer = (choix) => {
      boite.removeEventListener('click', surClic);
      boite.removeEventListener('keydown', surTouche);
      fermerSurimpression('surimpressionConflits');
      resoudre(choix);
    };

    function surClic(evenement) {
      if (evenement.target.closest('#conflitsGarder')) return terminer('garder');
      if (evenement.target.closest('#conflitsAnnuler')) return terminer('annuler');
      if (evenement.target === boite || evenement.target.closest('[data-fermer]')) terminer(null);
    }

    function surTouche(evenement) {
      if (evenement.key === 'Escape') terminer(null);
    }

    boite.addEventListener('click', surClic);
    boite.addEventListener('keydown', surTouche);
  });
}

/** Un rendez-vous en conflit, dans la forme d'une ligne d'agenda. */
function peindreConflits(cible, conflits) {
  if (!cible) return;

  cible.innerHTML = conflits.map((rdv) => {
    const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
    const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);
    const detail = [prestation?.name, fmtDuree(rdv.duration)].filter(Boolean).join(' · ');

    return '<li class="conflit">'
      + `<span class="conflit-quand donnee">${esc(dateCourte(rdv.date))} ${esc(fmtHeure(rdv.start))}</span>`
      + '<span class="conflit-corps">'
        + `<span class="conflit-nom">${esc(rdv.name || 'Sans nom')}</span>`
        + `<span class="conflit-quoi">${esc(detail)}${personne ? ' · ' + esc(personne.name) : ''}</span>`
      + '</span>'
      + (rdv.phone
        ? `<a class="conflit-tel donnee" href="tel:${esc(rdv.phone.replace(/[^\d+]/g, ''))}">${esc(rdv.phone)}</a>`
        : '<span class="conflit-tel donnee">pas de numéro</span>')
      + '</li>';
  }).join('');
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
    // Le pointage d'abord : ses boutons sont DANS la ligne, et laisser passer
    // le clic ouvrirait la fiche par-dessus.
    const point = evenement.target.closest('[data-pointage]');
    if (point) return pointer(point.dataset.pointage, point.dataset.valeur);

    const rdv = evenement.target.closest('[data-rdv]');
    if (rdv) return ouvrirFicheRdv(rdv.dataset.rdv);

    const bloc = evenement.target.closest('[data-bloc]');
    if (bloc) ouvrirFicheBloc(bloc.dataset.bloc);
  });

  $('#ficheSupprimer')?.addEventListener('click', agirDepuisFiche);

  // Changer de prestation ou de personne change les heures possibles.
  $('#rdvPrestation')?.addEventListener('change', () => chargerHeuresRdv());
  $('#rdvQui')?.addEventListener('change', () => chargerHeuresRdv());
  $('#rdvDate')?.addEventListener('change', () => chargerHeuresRdv());

  $('#formulaireRdv')?.addEventListener('submit', envoyerRdv);
  $('#formulaireBlocage')?.addEventListener('submit', envoyerBlocage);

  // Un champ corrige cesse d'etre en faute des la frappe : laisser
  // `aria-invalid` sur une saisie qui vient d'etre reparee ferait dire
  // « saisie invalide » sur un champ qui ne l'est plus.
  for (const formulaire of [$('#formulaireRdv'), $('#formulaireBlocage')]) {
    formulaire?.addEventListener('input', (evenement) => marquerRefus(evenement.target, false));
  }
}
