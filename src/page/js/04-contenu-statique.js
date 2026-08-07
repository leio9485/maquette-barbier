// ---------------------------------------------------------------------------
// LA VITRINE, PEINTE DEPUIS LES REGLAGES
//
// Ce que fait ce fichier : prendre la reponse de /api/config et la poser dans la
// page — nom, coordonnees, prestations, equipe, avis, photos, horaires.
//
// UNE GRANDE PARTIE EST DEJA DANS LE HTML ENVOYE. Le serveur y ecrit l'en-tete,
// la liste des prestations et la section des avis (src/lib/page.js). Repeindre
// ici n'est donc pas ce qui les fait exister : c'est ce qui les met a jour quand
// le commercant enregistre ses reglages, sans avoir a recharger la page.
//
// >>> LE BALISAGE PRODUIT ICI DOIT ETRE RIGOUREUSEMENT LE MEME QUE CELUI DE
//     src/lib/catalogue.js ET src/lib/temoignages.js. <<< Sinon la section
//     bougerait a l'ecran au moment de la reprise en main, sans raison visible.
//     Un test le verifie ; un commentaire le rappelle des deux cotes.
// ---------------------------------------------------------------------------

/**
 * Les champs simples, marques `data-champ` dans le HTML.
 *
 * Un seul passage pose le nom du commerce aux six endroits ou il apparait, sans
 * qu'aucun d'eux n'ait besoin d'un identifiant propre. Ajouter un endroit ou le
 * nom s'affiche ne demande donc pas de toucher a ce fichier.
 */
function peindreChamps(config) {
  const s = config.salon;

  const valeurs = {
    'nom': s.name,
    'rue': s.street,
    'code-postal': s.postalCode,
    'ville': s.city,
    'telephone': s.phone,
    'email': s.email,
  };

  for (const [champ, valeur] of Object.entries(valeurs)) {
    for (const element of $$(`[data-champ="${champ}"]`)) poserTexte(element, valeur);
  }

  // Les liens telephone et courriel. `tel:` n'accepte pas les espaces d'un
  // numero ecrit a la francaise : on les retire ici, sans toucher a ce qui est
  // affiche — un numero se lit « 03 27 39 98 40 », il ne se compose pas ainsi.
  for (const lien of $$('[data-champ="telephone-lien"]')) {
    lien.setAttribute('href', 'tel:' + String(s.phone || '').replace(/[^\d+]/g, ''));
  }
  for (const lien of $$('[data-champ="email-lien"]')) {
    lien.setAttribute('href', 'mailto:' + s.email);
  }

  // Les horaires d'aujourd'hui, sur la fiche d'accueil.
  const duJour = config.hours[jourDeLaSemaine(aujourdhui())];
  for (const element of $$('[data-champ="horaires-du-jour"]')) {
    poserTexte(element, texteHoraire(duJour));
  }
}

// --- LES PRESTATIONS --------------------------------------------------------

/**
 * Une ligne de prestation.
 *
 * >>> TRANSPOSITION EXACTE de `ligne()` dans src/lib/catalogue.js. <<<
 */
function ligneTarif(s) {
  // Pas d'`aria-label` : voir le raisonnement dans src/lib/catalogue.js (WCAG
  // 2.5.3, « Label in Name »). Le bouton s'annonce par son contenu.
  return '<li><button type="button" class="tarif-ligne"'
    + ` data-id="${esc(s.id)}" data-choix="prestation"`
    + ` data-prix-euros="${esc(s.price)}" data-duree-minutes="${esc(s.duration)}">`
    + '<span class="tarif-texte">'
      + `<span class="tarif-nom">${esc(s.name)}</span>`
      + (s.desc ? `<span class="tarif-desc">${esc(s.desc)}</span>` : '')
    + '</span>'
    + '<span class="tarif-donnees donnee">'
      + `<span class="tarif-duree">${fmtDuree(s.duration)}</span>`
      + `<span class="tarif-prix">${fmtPrix(s.price)}</span>`
    + '</span>'
    + '</button></li>';
}

/** Le catalogue range par rayon. Meme regroupement que cote serveur. */
function grouperParRayon(config) {
  const groupes = [];

  for (const cat of config.categories) {
    const dedans = config.services.filter((s) => s.category === cat.id);
    if (dedans.length) groupes.push({ cat, services: dedans });
  }

  const orphelines = config.services.filter(
    (s) => !config.categories.some((c) => c.id === s.category)
  );
  if (orphelines.length) {
    groupes.push({ cat: null, services: orphelines, seul: groupes.length === 0 });
  }

  return groupes;
}

/** Le HTML complet de la liste tarifaire. Employe par la vitrine et par le tunnel. */
function htmlPrestations(config) {
  return grouperParRayon(config).map((g) => {
    const ancre = 'rayon-' + (g.cat ? g.cat.id : 'autres');

    const entete = g.cat && !g.seul
      ? `<h3 class="tarif-rayon-titre etiquette">${esc(g.cat.name)}</h3>`
        + (g.cat.desc ? `<p class="tarif-rayon-desc">${esc(g.cat.desc)}</p>` : '')
      : '';

    return `<section class="tarif-rayon" id="${esc(ancre)}">`
      + entete
      + `<ul class="tarif-liste">${g.services.map(ligneTarif).join('')}</ul>`
      + '</section>';
  }).join('');
}

function peindrePrestations(config) {
  if (!config.services.length) return;

  const html = htmlPrestations(config);

  const vitrine = $('#tarifs');
  if (vitrine) vitrine.innerHTML = html;

  // Le tunnel montre la meme liste : c'est la meme question posee au meme
  // moment, il n'y a aucune raison qu'elle ait deux formes.
  //
  // Les identifiants des rayons y seraient en double avec ceux de la vitrine.
  // On les retire de cette copie : un identifiant en double dans une page est
  // une erreur de balisage, et les ancres de la vitrine cesseraient de
  // fonctionner (le navigateur irait au premier des deux).
  const tunnel = $('#tunnelPrestations');
  if (tunnel) {
    tunnel.innerHTML = html;
    for (const rayon of $$('.tarif-rayon', tunnel)) rayon.removeAttribute('id');
  }
}

// --- L'EQUIPE ---------------------------------------------------------------

/** « Rémi » -> « R ». Deux mots -> deux lettres. */
function initiales(nom) {
  return String(nom || '').trim().split(/\s+/).slice(0, 2)
    .map((mot) => mot.charAt(0).toUpperCase())
    .join('');
}

/**
 * Les jours travailles d'une personne, en une ligne.
 *
 * `hours: null` = elle suit le commerce, et il n'y a alors rien a dire : la
 * ligne serait la meme pour tout le monde. On ne l'ecrit que pour celles qui
 * ont des horaires propres — c'est-a-dire quand c'est une information.
 */
function joursDe(personne) {
  if (!personne.hours) return '';

  const ouverts = SEMAINE
    .filter((jour) => personne.hours[jour])
    .map((jour) => JOURS_COURTS[jour].replace('.', ''));

  if (!ouverts.length) return '';
  return ouverts.join(' ');
}

/** Ce qu'une personne assure, quand ce n'est pas tout. */
function prestationsDe(personne, config) {
  if (!personne.services.length) return '';

  const noms = personne.services
    .map((id) => config.services.find((s) => s.id === id)?.name)
    .filter(Boolean);

  return noms.join(' · ');
}

function peindreEquipe(config) {
  const section = $('#equipe');
  const liste = $('#equipeListe');
  if (!section || !liste) return;

  const equipe = config.staff.filter((p) => p.active !== false);

  // MOINS DE DEUX PERSONNES : LA SECTION DISPARAIT. Le site d'un barbier qui
  // travaille seul ne doit pas afficher une section « Équipe » avec un unique
  // portrait — cela souligne exactement ce qu'on ne veut pas souligner.
  if (equipe.length < 2) {
    montrer(section, false);
    liste.innerHTML = '';
    // Le lien du sommaire disparait avec elle : un raccourci vers une section
    // masquee emmene le visiteur au vide.
    for (const lien of $$('[data-section="equipe"]')) montrer(lien, false);
    return;
  }

  montrer(section, true);
  for (const lien of $$('[data-section="equipe"]')) montrer(lien, true);

  liste.innerHTML = equipe.map((p) => {
    const portrait = p.photo
      ? `<img src="${esc(p.photo)}" alt="" width="112" height="112">`
      : `<span class="equipe-initiales" style="background:${esc(p.color || '#24405C')}" aria-hidden="true">${esc(initiales(p.name))}</span>`;

    const detail = [prestationsDe(p, config), joursDe(p)].filter(Boolean);

    return '<li class="equipe-personne">'
      + `<div class="equipe-portrait">${portrait}</div>`
      + '<div class="equipe-texte">'
        + `<p class="equipe-nom">${esc(p.name)}</p>`
        + (p.role ? `<p class="equipe-role">${esc(p.role)}</p>` : '')
        + (detail.length ? `<p class="equipe-detail">${detail.map(esc).join(' <span aria-hidden="true">·</span> ')}</p>` : '')
      + '</div>'
      + '</li>';
  }).join('');
}

// --- LES AVIS ---------------------------------------------------------------

/**
 * >>> TRANSPOSITION EXACTE de `avis()` dans src/lib/temoignages.js. <<<
 */
function peindreAvis(config) {
  const section = $('#avis');
  const liste = $('#avisListe');
  if (!section || !liste) return;

  const avis = config.testimonials ?? [];

  montrer(section, avis.length > 0);
  for (const lien of $$('[data-section="avis"]')) montrer(lien, avis.length > 0);

  liste.dataset.nombre = String(avis.length);
  liste.innerHTML = avis.map((t) => {
    const attribution = [t.author, t.meta].filter(Boolean).map(esc);

    return '<li class="avis">'
      + `<blockquote class="avis-citation"><p>${esc(t.quote)}</p></blockquote>`
      + '<p class="avis-auteur donnee">'
        + `<cite>${attribution[0] ?? ''}</cite>`
        + (attribution[1] ? ` <span aria-hidden="true">·</span> ${attribution[1]}` : '')
      + '</p>'
      + '</li>';
  }).join('');
}

// --- LES PHOTOS -------------------------------------------------------------

/**
 * Les photos de la vitrine, et les reserves qui les remplacent.
 *
 * Une case sans photo affiche un aplat encre portant le cadrage attendu. C'est
 * volontairement visible : une reserve muette se ferait oublier et partirait en
 * ligne. Et surtout, la mise en page est deja definitive — deposer les photos
 * plus tard ne deplacera rien.
 */
function peindrePhotos(config) {
  const photos = config.photos || {};
  const legendes = config.legendes || {};

  for (const case_ of $$('[data-photo]')) {
    const emplacement = case_.dataset.photo;
    const photo = photos[emplacement];
    const image = $('img', case_);

    // La reserve precedente est retiree avant tout : sans cela, deposer une
    // photo depuis les reglages laisserait l'aplat par-dessus.
    const reserve = $('.reserve', case_);
    if (reserve) reserve.remove();

    if (photo?.url && image) {
      image.setAttribute('src', photo.url);
      montrer(image, true);
    } else {
      if (image) montrer(image, false);
      const bloc = document.createElement('p');
      bloc.className = 'reserve';
      bloc.textContent = `Photo — ${emplacement.replace('-', ' ')}`;
      case_.appendChild(bloc);
    }
  }

  // Les legendes de la galerie, saisies depuis les reglages.
  for (const element of $$('[data-legende]')) {
    const texte = legendes[element.dataset.legende];
    if (typeof texte === 'string') {
      poserTexte(element, texte);
      montrer(element, texte.length > 0);
    }
  }
}

// --- LE CONTACT -------------------------------------------------------------

function peindreHoraires(config) {
  const liste = $('#contactHoraires');
  if (!liste) return;

  const jourCourant = jourDeLaSemaine(aujourdhui());

  liste.innerHTML = SEMAINE.map((jour) => {
    const marque = jour === jourCourant ? ' data-aujourdhui' : '';
    const nom = JOURS_LONGS[jour];
    const nomAffiche = nom.charAt(0).toUpperCase() + nom.slice(1);
    // « Aujourd'hui » est ecrit pour les lecteurs d'ecran : la graisse seule ne
    // s'entend pas.
    const dit = jour === jourCourant ? '<span class="hors-ecran"> (aujourd\'hui)</span>' : '';

    return `<div${marque}>`
      + `<dt>${esc(nomAffiche)}${dit}</dt>`
      + `<dd>${esc(texteHoraire(config.hours[jour]))}</dd>`
      + '</div>';
  }).join('');
}

function peindrePlan(config) {
  const lien = $('#contactPlan');
  if (!lien) return;

  const plan = config.plan;
  if (!plan?.url) {
    montrer(lien, false);
    return;
  }

  const image = $('img', lien);
  if (image) image.setAttribute('src', plan.url);

  // L'adresse ouverte dans l'application de cartes du visiteur. Un lien, donc
  // rien ne part avant qu'il ne clique — toute la difference avec une carte
  // integree, qui deposerait un traceur des l'arrivee sur la page.
  const s = config.salon;
  const requete = encodeURIComponent(`${s.street}, ${s.postalCode} ${s.city}`);
  lien.setAttribute('href', `https://www.openstreetmap.org/search?query=${requete}`);

  montrer(lien, true);
}

function peindreLiens(config) {
  const liens = config.salon.links || {};

  for (const lien of $$('#contactLiens [data-lien]')) {
    const adresse = liens[lien.dataset.lien];
    const ligne = lien.closest('li');
    if (adresse) {
      lien.setAttribute('href', adresse);
      montrer(ligne, true);
    } else {
      montrer(ligne, false);
    }
  }
}

// --- LE TOUT ----------------------------------------------------------------

/**
 * Repeint toute la vitrine.
 *
 * Appelee au demarrage, et de nouveau apres chaque enregistrement des reglages :
 * le commercant change un tarif et le voit changer sur son site, sans recharger.
 */
function peindreVitrine(config) {
  peindreChamps(config);
  peindrePrestations(config);
  peindreEquipe(config);
  peindreAvis(config);
  peindrePhotos(config);
  peindreHoraires(config);
  peindrePlan(config);
  peindreLiens(config);

  // Le titre de l'onglet suit le nom du commerce.
  //
  // ⚠️ MEME FORMULATION QUE `enTete()` dans src/lib/page.js : le serveur ecrit
  // ce titre dans la page envoyee, et cette ligne le reecrit apres un
  // enregistrement. Si vous changez l'une, changez l'autre.
  document.title = `${config.salon.name} — Barbier à ${config.salon.city}`;
}
