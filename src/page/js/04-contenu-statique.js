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
    // Un <span> et non un <button> : la ligne entiere EST le bouton. Voir le
    // raisonnement complet dans src/lib/catalogue.js.
    + '<span class="tarif-action" aria-hidden="true">Réserver</span>'
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
      ? `<h3 class="tarif-rayon-titre">${esc(g.cat.name)}</h3>`
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

  peindreChoixPrestation(config);
}

/**
 * L'etape 1 du tunnel : UN RAYON DEPLIABLE PAR LIGNE.
 *
 * L'etape a eu trois formes. D'abord les treize lignes du catalogue recopiees
 * telles quelles — c'est-a-dire la section « Prestations » qu'on venait de
 * faire defiler, si bien que rien ne disait qu'on avait avance. Puis une liste
 * deroulante, plus courte mais qui cachait tout : on ne voyait plus ce que
 * proposait le commerce sans ouvrir le menu.
 *
 * Le depliant garde les deux : quatre lignes qui montrent l'offre entiere avec
 * son premier prix, et le detail a un clic.
 *
 * `<details>` / `<summary>` : l'ouverture, le clavier et l'annonce « replie /
 * deplie » sont natifs. Le premier rayon part ouvert, pour qu'on voie du
 * premier coup d'oeil ce qu'il y a dedans.
 *
 * Les lignes sont celles de la vitrine, `ligneTarif()` — meme balisage, donc
 * meme `data-choix="prestation"` et meme ecouteur : cliquer une ligne mene a
 * l'etape 2, ici comme la-haut.
 */
function peindreChoixPrestation(config) {
  const cible = $('#tunnelRayons');
  if (!cible) return;

  cible.innerHTML = grouperParRayon(config).map((g, rang) => {
    const nom = g.cat && !g.seul ? g.cat.name : 'Toutes les prestations';

    // Ce qu'il y a dedans, et a partir de quel prix. C'est l'information qui
    // permet de choisir SANS ouvrir : « des 13 € » repond a la question qu'on
    // se pose en parcourant une liste de rayons.
    const combien = g.services.length > 1
      ? `${g.services.length} prestations`
      : '1 prestation';
    const moins = Math.min(...g.services.map((s) => Number(s.price) || 0));
    const resume = `${combien} · dès ${fmtPrix(moins)}`;

    return `<details class="rayon"${rang === 0 ? ' open' : ''}>`
      + '<summary class="rayon-tete">'
        + `<span class="rayon-nom">${esc(nom)}</span>`
        + `<span class="rayon-compte donnee">${esc(resume)}</span>`
      + '</summary>'
      + `<ul class="tarif-liste rayon-liste">${g.services.map(ligneTarif).join('')}</ul>`
      + '</details>';
  }).join('');
}

// --- LES INDICATEURS DE CONFIANCE -------------------------------------------

/**
 * La note Google, dans la bande de preuves et en tete de la section « Avis ».
 *
 * MASQUEE TANT QU'IL N'Y A RIEN A DIRE. Les reglages livres portent une note a
 * zero, et c'est delibere : ce commerce n'existe pas, il n'a pas de fiche
 * Google. « 0/5 sur 0 avis » affiche en grand vaut moins que rien du tout.
 *
 * Les trois autres indicateurs sont ecrits en dur dans parties/accueil.html :
 * ce sont des faits sur le fonctionnement du site (pas d'acompte, pas de
 * compte, reservation a toute heure), vrais pour toutes les instances.
 *
 * La note s'ecrit a la francaise — 4,8 et non 4.8. C'est une donnee affichee a
 * un client francais, pas une valeur de calcul.
 */
function peindreConfiance(config) {
  const avis = config.reviews || {};
  const note = Number(avis.rating) || 0;
  const nombre = Number(avis.count) || 0;
  const montrable = note > 0 && nombre > 0;

  const texteNote = String(note).replace('.', ',') + '/5';
  const texteNombre = nombre > 1 ? `sur ${nombre} avis Google` : 'sur 1 avis Google';

  poserTexte($('#preuveNote'), texteNote);
  poserTexte($('#preuveNombre'), texteNombre);
  montrer($('#preuveAvis'), montrable);

  // La meme note, rappelee en tete de la section « Avis » — c'est la que le
  // visiteur la cherche, et c'est elle qui donne leur poids aux trois
  // temoignages qui suivent.
  const source = $('#avisSource');
  if (source) {
    poserTexte($('#avisSourceNote'), `${texteNote} ${texteNombre.replace('sur ', '· ')}`);
    montrer(source, montrable);
  }

  // Le lien vers la fiche Google. Il ne s'affiche que si l'adresse est saisie :
  // jamais de lien mort vers une fiche qui n'existe pas.
  //
  // C'est le lien le plus utile de la section : les avis qui comptent sont ceux
  // que Google heberge, pas ceux qu'un commerce recopie sur son propre site.
  // L'envoyer la-bas est plus honnete que de faire semblant que trois citations
  // choisies valent une reputation.
  const lien = $('#avisLienGoogle');
  const pied = $('#avisPied');
  if (lien && pied) {
    const adresse = config.salon?.links?.google || '';
    if (adresse) lien.setAttribute('href', adresse);
    montrer(pied, Boolean(adresse));
  }
}

// --- L'EQUIPE ---------------------------------------------------------------
//
// `initiales()` est dans js/02-utilitaires.js : les reglages s'en servent aussi,
// et ils tournent dans un autre document depuis le lot 4.

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

    // LA PHOTO, LE PRENOM, LE POSTE. RIEN D'AUTRE.
    //
    // La ligne portait en plus, en chasse fixe, la liste des prestations
    // assurees et les jours travailles : « Rasage traditionnel au coupe-chou ·
    // Coupe + rasage traditionnel », « mer jeu ven sam ». Deux informations
    // vraies, mais qui ne servent a personne a cet endroit — celui qui veut
    // savoir si Remi est libre jeudi ne lit pas une liste de jours, il ouvre le
    // tunnel, et celui-ci ne propose de toute facon que les creneaux reels.
    // Elles alourdissaient trois lignes qui doivent se lire d'un coup d'oeil.
    //
    // Ce qui reste est ce qu'on regarde vraiment sur une page d'equipe : un
    // visage, un prenom, ce que la personne fait.
    return '<li class="equipe-personne">'
      + `<div class="equipe-portrait">${portrait}</div>`
      + '<div class="equipe-texte">'
        + `<p class="equipe-nom">${esc(p.name)}</p>`
        + (p.role ? `<p class="equipe-role">${esc(p.role)}</p>` : '')
      + '</div>'
      // (Il y avait ici un bouton « Reserver avec X » qui ouvrait le tunnel
      // avec la personne deja retenue. Retire : « avec qui ? » se pose une
      // seule fois, dans le tunnel, APRES le jour — c'est la que la question a
      // une consequence visible, puisque le choix change les creneaux libres.
      // Poser la meme question deux fois a deux endroits, c'est laisser croire
      // qu'il y a deux chemins differents.)
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
/** Combien de cases la galerie peut porter. Même valeur que `GALERIE_MAX`. */
const GALERIE_MAX = 12;

/**
 * La galerie, repeinte depuis les réglages.
 *
 * ⚠️ CE CODE PRODUIT EXACTEMENT LE MÊME BALISAGE QUE `sectionGalerie()`
 *    (src/lib/galerie.js). Même règle que pour les prestations et les avis : le
 *    serveur écrit pour ceux qui n'exécutent pas de code, la page réécrit pour
 *    la mise à jour sans rechargement, et un test vérifie que les deux
 *    coïncident au caractère près. Si vous changez l'un, changez l'autre.
 *
 * Une case n'existe que si sa photo « avant » existe : la galerie se remplit et
 * se vide toute seule, sans que le commerçant ait à déclarer combien de photos
 * il veut.
 */
function peindreGalerie(config) {
  const liste = $('#galerieListe');
  if (!liste) return;

  const photos = config.photos || {};
  const legendes = config.legendes || {};
  const descriptions = config.descriptions || {};

  const image = (url, alt, chargement) =>
    `<img src="${esc(url)}" alt="${esc(alt)}" width="700" height="933"${chargement}>`;

  const cases = [];

  for (let n = 1; n <= GALERIE_MAX; n++) {
    const nom = `galerie-${n}`;
    const photo = photos[nom];
    if (!photo?.url) continue;

    const apres = photos[`${nom}-apres`];
    const legende = legendes[nom] ?? '';

    // Toutes en chargement différé : la galerie n'est jamais dans le premier
    // écran. Voir le raisonnement dans src/lib/galerie.js — les charger tout
    // de suite faisait passer le LCP de 2,3 s à 3,9 s.
    const chargement = ' loading="lazy"';

    const images = apres?.url
      ? '<div class="galerie-paire">'
        + image(photo.url, descriptions[nom] ?? '', chargement)
        + image(apres.url, descriptions[`${nom}-apres`] ?? '', chargement)
        + '</div>'
      : image(photo.url, descriptions[nom] ?? '', chargement);

    cases.push(`<li class="galerie-case${apres?.url ? ' galerie-case-paire' : ''}" data-photo="${esc(nom)}">`
      + '<figure>'
      + images
      + (legende
        ? `<figcaption class="galerie-legende etiquette" data-legende="${esc(nom)}">${esc(legende)}</figcaption>`
        : '')
      + '</figure>'
      + '</li>');
  }

  // Aucune photo : on laisse ce que le serveur a écrit plutôt que de vider la
  // section. Une galerie vide vaut moins que pas de galerie du tout.
  if (cases.length) liste.innerHTML = cases.join('');
}

function peindrePhotos(config) {
  const photos = config.photos || {};
  const legendes = config.legendes || {};
  const descriptions = config.descriptions || {};

  // La galerie se redessine en entier : le nombre de cases dépend des photos
  // déposées, ce qu'une simple mise à jour des `src` ne saurait pas suivre.
  peindreGalerie(config);

  for (const case_ of $$('[data-photo]')) {
    // Les cases de la galerie viennent d'être réécrites en entier, images et
    // descriptions comprises : les reprendre ici ne ferait que du travail en
    // double, et poserait mal les paires avant/après (deux images, une seule
    // serait reprise).
    if (case_.closest('#galerie')) continue;

    const emplacement = case_.dataset.photo;
    const photo = photos[emplacement];
    const image = $('img', case_);

    // La reserve precedente est retiree avant tout : sans cela, deposer une
    // photo depuis les reglages laisserait l'aplat par-dessus.
    const reserve = $('.reserve', case_);
    if (reserve) reserve.remove();

    if (photo?.url && image) {
      image.setAttribute('src', photo.url);

      // LA DESCRIPTION LUE A VOIX HAUTE, posee en meme temps que l'adresse.
      // Les deux vont ensemble : une image sans `alt` est annoncee « image »
      // et rien de plus. Le serveur ne peut pas l'ecrire dans le HTML — c'est
      // ce meme code qui pose le `src` — donc elle arrive ici.
      const description = descriptions[emplacement];
      if (typeof description === 'string' && description) image.setAttribute('alt', description);

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
  // Apres `peindreAvis` : c'est elle qui montre ou masque la section entiere,
  // et la note ne doit pas reapparaitre dans une section masquee.
  peindreConfiance(config);
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
