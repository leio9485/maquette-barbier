// ---------------------------------------------------------------------------
// LES REGLAGES
//
// LE PRINCIPE : ON MODIFIE UN BROUILLON, PAS LA BASE.
//
// Chaque saisie ecrit dans `ESPACE.brouillon`, une copie complete des reglages.
// Rien ne part au serveur avant « Enregistrer ». Trois choses en decoulent, et
// ce sont exactement les trois que demande un commercant qui touche a ses
// tarifs un soir de fermeture :
//
//   - il voit qu'il a modifie quelque chose (la barre du bas reste visible) ;
//   - il peut tout annuler d'un bouton ;
//   - il ne peut pas casser son site a moitie — l'enregistrement est un tout,
//     accepte ou refuse par le serveur en bloc.
//
// LE FORMULAIRE EST ENGENDRE, PAS ECRIT. Treize prestations, quatre rayons,
// trois personnes : les ecrire a la main dans le HTML aurait fige leur nombre.
// ---------------------------------------------------------------------------

/** Une copie profonde, pour que modifier le brouillon ne touche jamais l'original. */
function copier(valeur) {
  return JSON.parse(JSON.stringify(valeur));
}

/** Les reglages en cours d'edition. */
function brouillon() {
  return ESPACE.brouillon;
}

/**
 * Signale qu'il y a des modifications non enregistrees.
 *
 * La barre reste collee en bas de l'ecran tant qu'elle est la : c'est ce qui
 * evite de quitter la page en croyant avoir enregistre.
 */
function marquerModifie() {
  montrer($('#brouillon'), true);
}

function marquerPropre() {
  montrer($('#brouillon'), false);
}

// --- Le chargement ----------------------------------------------------------

async function chargerReglages() {
  try {
    const reglages = await lireReglages();
    ESPACE.brouillon = copier(reglages);

    peindreReglages();
    marquerPropre();
    afficherMessage($('#messageReglages'), '');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageReglages'), erreur.message);
  }
}

function peindreReglages() {
  if (!brouillon()) return;

  peindreCoordonnees();
  peindreHorairesReglages();
  peindreCategoriesReglages();
  peindrePrestationsReglages();
  peindreEquipeReglages();
  peindreAvisReglages();
  peindrePhotosReglages();
}

// --- Les coordonnees --------------------------------------------------------

/** Un champ texte relie a un chemin du brouillon (« salon.name »). */
function champTexte(chemin, intitule, { type = 'text', aide = '' } = {}) {
  const valeur = chemin.split('.').reduce((objet, cle) => objet?.[cle], brouillon()) ?? '';

  return '<div class="champ">'
    + `<label for="reglage-${esc(chemin)}">${esc(intitule)}</label>`
    + `<input type="${esc(type)}" id="reglage-${esc(chemin)}" data-chemin="${esc(chemin)}" value="${esc(valeur)}">`
    + (aide ? `<p class="aide">${esc(aide)}</p>` : '')
    + '</div>';
}

function peindreCoordonnees() {
  const cible = $('#champsCoordonnees');
  if (!cible) return;

  cible.innerHTML = [
    champTexte('salon.name', 'Nom du commerce'),
    champTexte('salon.street', 'Rue'),
    champTexte('salon.postalCode', 'Code postal'),
    champTexte('salon.city', 'Ville'),
    champTexte('salon.phone', 'Téléphone', { type: 'tel' }),
    champTexte('salon.email', 'Courriel', { type: 'email' }),
    champTexte('salon.links.google', 'Lien de votre fiche Google', {
      type: 'url',
      aide: "Le lien le plus utile de tous : il relie ce site à votre fiche, et "
        + "c'est lui qu'ouvre « Lire les avis sur Google ». Sans lui, le site "
        + "renvoie vers une simple recherche à votre adresse.",
    }),
    // ⚠️ CE N'EST PAS LE MEME LIEN QUE CELUI DU DESSUS, et c'est le genre de
    //    distinction qu'un commercant ne fera pas tout seul : l'aide le dit.
    //    La fiche, on la LIT ; celui-ci OUVRE la fenêtre d'avis. Un client
    //    renvoyé vers la fiche doit encore trouver le bouton, faire défiler,
    //    choisir ses étoiles — la moitié abandonne en route.
    champTexte('salon.links.review', 'Lien pour laisser un avis', {
      type: 'url',
      aide: "Différent du précédent : celui-ci ouvre directement la fenêtre "
        + "« laisser un avis ». Google vous le donne dans votre fiche, sous "
        + "« Demander des avis ». C'est ce lien qu'envoie le bouton ci-dessous.",
    }),
    champTexte('salon.links.instagram', 'Instagram', { type: 'url' }),
    champTexte('salon.links.facebook', 'Facebook', { type: 'url' }),
  ].join('');
}

// --- Demander un avis -------------------------------------------------------

/**
 * Le message tout prêt, copié dans le presse-papier.
 *
 * Petit détail, gros effet en démonstration : le commerçant voit qu'il peut
 * demander un avis en trois secondes, sans rédiger et sans se tromper de lien.
 *
 * LE TEXTE EST COMPOSÉ PAR LE SERVEUR, comme les phrases du bandeau d'état :
 * une seule formulation existe dans le projet, et le jour où le SMS s'allumera,
 * c'est exactement celle-là qui partira.
 */
async function copierMessageAvis() {
  const bouton = $('#demanderAvis');
  const message = $('#messageReglages');

  bouton.disabled = true;

  try {
    const reponse = await lireMessageAvis();

    if (!reponse.pret) {
      afficherMessage(message, reponse.aide);
      return;
    }

    // `clipboard` peut échouer : navigateur ancien, page non sécurisée,
    // permission refusée. On ne laisse alors pas le commerçant sans rien —
    // on lui affiche le message, il le sélectionne à la main.
    try {
      await navigator.clipboard.writeText(reponse.message);
      afficherMessage(message, `Message copié : « ${reponse.message} »`, 'bon');
    } catch {
      afficherMessage(message, `À copier : ${reponse.message}`);
    }
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

// --- Les horaires -----------------------------------------------------------

function peindreHorairesReglages() {
  const cible = $('#champsHoraires');
  if (!cible) return;

  cible.innerHTML = SEMAINE.map((jour) => {
    const h = brouillon().hours[jour];
    const ouvert = Boolean(h);
    const nom = JOURS_LONGS[jour];

    const heure = (valeur, role, desactive) =>
      `<input type="time" data-jour="${jour}" data-role="${role}" value="${esc(valeur || '')}"`
      + (desactive ? ' disabled' : '') + ` aria-label="${esc(nom + ' — ' + role)}">`;

    return '<div class="horaire-jour">'
      + '<div class="horaire-nom">'
        + `<input type="checkbox" data-jour="${jour}" data-role="ouvert"${ouvert ? ' checked' : ''}`
          + ` id="jour-${jour}" aria-label="${esc('Ouvert le ' + nom)}">`
        + `<label for="jour-${jour}">${esc(nom.charAt(0).toUpperCase() + nom.slice(1))}</label>`
      + '</div>'
      + '<div class="horaire-plages">'
        + heure(h?.open, 'ouverture', !ouvert)
        + '<span class="horaire-sep">–</span>'
        + heure(h?.pause?.[0], 'pause-debut', !ouvert)
        + '<span class="horaire-sep">/</span>'
        + heure(h?.pause?.[1], 'pause-fin', !ouvert)
        + '<span class="horaire-sep">–</span>'
        + heure(h?.close, 'fermeture', !ouvert)
      + '</div>'
      + '</div>';
  }).join('');

  const pas = $('#reglagePas');
  if (pas) pas.value = String(brouillon().slotStep);

  const delai = $('#reglageDelai');
  if (delai) delai.value = String(brouillon().leadTimeMinutes);
}

/** Reconstruit l'horaire d'un jour depuis ses quatre champs. */
function relireHoraire(jour) {
  const ouvert = $(`input[data-jour="${jour}"][data-role="ouvert"]`)?.checked;
  if (!ouvert) return null;

  const valeur = (role) => $(`input[data-jour="${jour}"][data-role="${role}"]`)?.value || '';

  const horaire = { open: valeur('ouverture'), close: valeur('fermeture') };

  const debut = valeur('pause-debut');
  const fin = valeur('pause-fin');
  // Une pause n'existe que si ses deux bornes sont saisies : une seule des deux
  // ne veut rien dire, et le serveur la refuserait.
  if (debut && fin) horaire.pause = [debut, fin];

  return horaire;
}

// --- Les rayons -------------------------------------------------------------

/**
 * Les boutons d'ordre et de suppression d'une ligne.
 *
 * LES DEUX FLECHES GARDENT LEUR SYMBOLE, LA SUPPRESSION PREND UN MOT.
 *
 * Monter et descendre sont sans equivoque et sans consequence : on se trompe,
 * on reclique. La croix, elle, etait le seul bouton destructeur du formulaire
 * et le plus petit — 36 px, un caractere, a cote de deux fleches qui lui
 * ressemblaient. Le mot « Retirer » coute trois centimetres de largeur et
 * supprime la classe entiere des suppressions par erreur de visee.
 *
 * (Le retrait n'est de toute facon jamais immediat : il faut encore
 * enregistrer, et le serveur redemande confirmation quand des rendez-vous en
 * dependent.)
 */
function boutonsLigne(type, index, total) {
  return '<div class="reglages-ligne-actions">'
    + `<button type="button" class="reglages-bouton" data-monter="${type}" data-index="${index}"`
      + `${index === 0 ? ' disabled' : ''} aria-label="Monter">↑</button>`
    + `<button type="button" class="reglages-bouton" data-descendre="${type}" data-index="${index}"`
      + `${index === total - 1 ? ' disabled' : ''} aria-label="Descendre">↓</button>`
    + `<button type="button" class="reglages-bouton reglages-retirer" data-supprimer="${type}" data-index="${index}">`
      + 'Retirer</button>'
    + '</div>';
}

/**
 * Le numero d'ordre d'une ligne, en chasse fixe.
 *
 * C'est le repere du rail de la vitrine, applique aux formulaires : sur une
 * liste de treize prestations, savoir qu'on est a la neuvieme est ce qui permet
 * de s'y retrouver apres avoir fait defiler.
 */
function numeroLigne(index) {
  return `<span class="reglages-ligne-numero donnee">${String(index + 1).padStart(2, '0')}</span>`;
}

function peindreCategoriesReglages() {
  const cible = $('#champsCategories');
  if (!cible) return;

  const rayons = brouillon().categories;

  // Le titre de la ligne porte le NOM DU RAYON, pas « Rayon 3 ». Un intitule
  // qui ne dit que sa position oblige a lire le champ juste en dessous pour
  // savoir de quoi on parle — et il y en a quatre a la suite.
  cible.innerHTML = rayons.map((c, index) => {
    const dedans = brouillon().services.filter((s) => s.category === c.id).length;
    const compte = dedans > 1 ? `${dedans} prestations` : `${dedans} prestation`;

    return '<div class="reglages-ligne">'
    + '<div class="reglages-ligne-tete">'
      + numeroLigne(index)
      + `<span class="reglages-ligne-titre">${esc(c.name || 'Nouveau rayon')}</span>`
      + `<span class="reglages-ligne-appui donnee">${esc(compte)}</span>`
      + boutonsLigne('categorie', index, rayons.length)
    + '</div>'
    + '<div class="reglages-grille">'
      + '<div class="champ">'
        + `<label for="cat-nom-${index}">Nom</label>`
        + `<input type="text" id="cat-nom-${index}" data-liste="categories" data-index="${index}" data-cle="name" value="${esc(c.name)}">`
      + '</div>'
      + '<div class="champ">'
        + `<label for="cat-desc-${index}">Phrase</label>`
        + `<input type="text" id="cat-desc-${index}" data-liste="categories" data-index="${index}" data-cle="desc" value="${esc(c.desc || '')}">`
      + '</div>'
    + '</div>'
    + '</div>';
  }).join('');
}

// --- Les prestations --------------------------------------------------------

function peindrePrestationsReglages() {
  const cible = $('#champsPrestations');
  if (!cible) return;

  const prestations = brouillon().services;
  const rayons = brouillon().categories;

  cible.innerHTML = prestations.map((s, index) => {
    const options = ['<option value="">Sans rayon</option>']
      .concat(rayons.map((c) => `<option value="${esc(c.id)}"${c.id === s.category ? ' selected' : ''}>${esc(c.name)}</option>`))
      .join('');

    // La tete rappelle la duree et le tarif : ce sont les deux valeurs qu'on
    // vient verifier, et les relire dans la tete evite d'ouvrir les champs.
    const appui = [fmtDuree(s.duration), fmtPrix(s.price)].join(' · ');

    return `<div class="reglages-ligne"${s.active === false ? ' data-pause' : ''}>`
      + '<div class="reglages-ligne-tete">'
        + numeroLigne(index)
        + `<span class="reglages-ligne-titre">${esc(s.name || 'Nouvelle prestation')}</span>`
        + `<span class="reglages-ligne-appui donnee">${esc(appui)}</span>`
        + boutonsLigne('service', index, prestations.length)
      + '</div>'
      + '<div class="reglages-grille">'
        + champListe('services', index, 'name', 'Nom', s.name)
        + champListe('services', index, 'desc', 'Description', s.desc || '')
        + champListe('services', index, 'duration', 'Durée (minutes)', s.duration, 'number')
        + champListe('services', index, 'price', 'Tarif (euros)', s.price, 'number')
        + '<div class="champ">'
          + `<label for="svc-cat-${index}">Rayon</label>`
          + `<select id="svc-cat-${index}" data-liste="services" data-index="${index}" data-cle="category">${options}</select>`
        + '</div>'
        + '<div class="champ">'
          + `<label for="svc-actif-${index}">Proposée en ligne</label>`
          + `<select id="svc-actif-${index}" data-liste="services" data-index="${index}" data-cle="active" data-booleen>`
            + `<option value="oui"${s.active !== false ? ' selected' : ''}>Oui</option>`
            + `<option value="non"${s.active === false ? ' selected' : ''}>Non, en pause</option>`
          + '</select>'
        + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

/** Un champ relie a un element de liste du brouillon. */
function champListe(liste, index, cle, intitule, valeur, type = 'text') {
  const id = `${liste}-${index}-${cle}`;
  return '<div class="champ">'
    + `<label for="${esc(id)}">${esc(intitule)}</label>`
    + `<input type="${esc(type)}" id="${esc(id)}" data-liste="${esc(liste)}" data-index="${index}"`
      + ` data-cle="${esc(cle)}" value="${esc(valeur)}"${type === 'number' ? ' min="0" inputmode="numeric"' : ''}>`
    + '</div>';
}

// --- L'equipe ---------------------------------------------------------------

function peindreEquipeReglages() {
  const cible = $('#champsEquipe');
  if (!cible) return;

  const equipe = brouillon().staff;
  const prestations = brouillon().services;

  cible.innerHTML = equipe.map((p, index) => {
    const cases = prestations.map((s) => {
      const cochee = p.services.includes(s.id);
      return `<label class="reglages-case"><input type="checkbox" data-personne="${index}"`
        + ` data-service="${esc(s.id)}"${cochee ? ' checked' : ''}> ${esc(s.name)}</label>`;
    }).join('');

    // Les horaires propres. Absents = elle suit le commerce, et c'est le cas
    // courant : on ne montre les sept lignes que si elle en a.
    const horairesPropres = p.hours
      ? SEMAINE.map((jour) => {
        const h = p.hours[jour];
        return '<div class="horaire-jour">'
          + '<div class="horaire-nom">'
            + `<input type="checkbox" data-personne-jour="${index}" data-jour="${jour}" data-role="ouvert"${h ? ' checked' : ''}`
              + ` id="p${index}-j${jour}" aria-label="${esc(JOURS_LONGS[jour])}">`
            + `<label for="p${index}-j${jour}">${esc(JOURS_LONGS[jour])}</label>`
          + '</div>'
          + '<div class="horaire-plages">'
            + `<input type="time" data-personne-jour="${index}" data-jour="${jour}" data-role="ouverture" value="${esc(h?.open || '')}"${h ? '' : ' disabled'}>`
            + '<span class="horaire-sep">–</span>'
            + `<input type="time" data-personne-jour="${index}" data-jour="${jour}" data-role="fermeture" value="${esc(h?.close || '')}"${h ? '' : ' disabled'}>`
          + '</div>'
          + '</div>';
      }).join('')
      : '';

    return `<div class="reglages-ligne"${p.active === false ? ' data-pause' : ''}>`
      + '<div class="reglages-ligne-tete">'
        + numeroLigne(index)
        + `<span class="reglages-ligne-titre">${esc(p.name || 'Nouvelle personne')}</span>`
        + (p.role ? `<span class="reglages-ligne-appui donnee">${esc(p.role)}</span>` : '')
        + boutonsLigne('staff', index, equipe.length)
      + '</div>'
      + '<div class="reglages-grille">'
        + champListe('staff', index, 'name', 'Prénom', p.name)
        + champListe('staff', index, 'role', 'Rôle affiché', p.role || '')
        + '<div class="champ">'
          + `<label for="stf-actif-${index}">Visible sur le site</label>`
          + `<select id="stf-actif-${index}" data-liste="staff" data-index="${index}" data-cle="active" data-booleen>`
            + `<option value="oui"${p.active !== false ? ' selected' : ''}>Oui</option>`
            + `<option value="non"${p.active === false ? ' selected' : ''}>Non, en pause</option>`
          + '</select>'
        + '</div>'
        // LE PORTRAIT : apercu, bouton, retrait — la meme forme que la galerie.
        //
        // C'etait un `<input type="file">` nu, sans apercu : on deposait une
        // photo sans voir laquelle etait deja en place, ni ce que donnerait le
        // cadrage carre de la vitrine. Et le champ sortait au dessin du
        // navigateur, avec son « Aucun fichier selectionne » parfois en anglais.
        //
        // L'input est masque hors ecran et c'est son `<label>` qui fait le
        // bouton : un vrai declencheur natif, que le clavier atteint et qu'un
        // lecteur d'ecran annonce comme un champ de fichier.
        + '<div class="champ">'
          + `<span class="reglages-etiquette-champ">Portrait</span>`
          + '<div class="reglages-portrait">'
            + '<div class="reglages-portrait-apercu">'
              + (p.photo
                ? `<img src="${esc(p.photo)}" alt="">`
                : `<span class="reglages-portrait-vide donnee" aria-hidden="true">${esc(initiales(p.name))}</span>`)
            + '</div>'
            + '<div class="reglages-portrait-actions">'
              + `<input type="file" class="hors-ecran" id="stf-photo-${index}" accept="image/*" data-photo-personne="${index}">`
              + `<label class="action-douce" for="stf-photo-${index}">`
                + (p.photo ? 'Remplacer' : 'Choisir une photo')
              + '</label>'
              + (p.photo ? `<button type="button" class="lien-nu" data-retirer-portrait="${index}">Retirer</button>` : '')
              + '<p class="aide">Carrée de préférence. Elle est recadrée au centre.</p>'
            + '</div>'
          + '</div>'
        + '</div>'
      + '</div>'
      + '<p class="etiquette">Prestations assurées</p>'
      + `<div class="reglages-cases">${cases}</div>`
      + '<p class="aide">Aucune cochée : cette personne assure tout ce que personne d\'autre n\'a coché.</p>'
      + '<p class="etiquette">Horaires particuliers</p>'
      + `<label class="reglages-case"><input type="checkbox" data-horaires-propres="${index}"${p.hours ? ' checked' : ''}>`
        + ' Cette personne a ses propres horaires</label>'
      + horairesPropres
      + '</div>';
  }).join('');
}

// --- Les avis ---------------------------------------------------------------

function peindreAvisReglages() {
  const cible = $('#champsAvis');
  if (!cible) return;

  const avis = brouillon().testimonials;

  cible.innerHTML = avis.map((t, index) => '<div class="reglages-ligne">'
    + '<div class="reglages-ligne-tete">'
      + `<span class="reglages-ligne-titre">Avis ${index + 1}</span>`
      + boutonsLigne('avis', index, avis.length)
    + '</div>'
    + '<div class="champ">'
      + `<label for="avis-${index}-quote">Citation</label>`
      + `<textarea id="avis-${index}-quote" rows="3" data-liste="testimonials" data-index="${index}" data-cle="quote">${esc(t.quote)}</textarea>`
    + '</div>'
    + '<div class="reglages-grille">'
      + champListe('testimonials', index, 'author', 'Prénom et initiale', t.author)
      + champListe('testimonials', index, 'meta', 'Précision', t.meta || '')
    + '</div>'
    + '</div>').join('');
}

// --- Les photos -------------------------------------------------------------

async function peindrePhotosReglages() {
  const cible = $('#champsPhotos');
  if (!cible) return;

  let photos = {};
  try {
    const reponse = await lirePhotos();
    photos = reponse.photos ?? reponse;
  } catch {
    // Les photos vivent sur le disque, pas dans le brouillon : leur absence ne
    // doit pas empecher de regler le reste.
  }

  // Chaque emplacement porte son NOM D'USAGE et son cadrage, pas son
  // identifiant technique. « hero » et « galerie 1 » ne disent rien a un
  // barbier ; « la grande photo du haut » lui dit ou elle va apparaitre, et
  // c'est la seule chose qu'il a besoin de savoir pour choisir la bonne image.
  const emplacements = [
    { id: 'hero', nom: "Photo d'accueil", ou: 'La grande photo du haut, à côté du titre.', large: true },
    { id: 'galerie-1', nom: 'Galerie — 1', ou: 'Première vignette de la planche.' },
    { id: 'galerie-2', nom: 'Galerie — 2', ou: 'Deuxième vignette.' },
    { id: 'galerie-3', nom: 'Galerie — 3', ou: 'Troisième vignette.' },
    { id: 'galerie-4', nom: 'Galerie — 4', ou: 'Quatrième vignette.' },
  ];

  cible.innerHTML = emplacements.map((e) => {
    const photo = photos[e.id];
    const apercu = photo?.url
      ? `<img src="${esc(photo.url)}" alt="">`
      : '<p class="reserve">Aucune photo</p>';

    // L'INPUT DE FICHIER EST MASQUE, SON LABEL FAIT LE BOUTON. Un
    // `<input type="file">` nu est le seul controle de la page que le
    // navigateur dessine a sa facon — bouton gris systeme, texte « Aucun
    // fichier selectionne » en anglais sur certaines machines. Le label est un
    // vrai declencheur natif : le clic ouvre le selecteur, le clavier aussi
    // (l'input reste focusable, il est deplace hors ecran et non `hidden`), et
    // le lecteur d'ecran annonce toujours un champ de fichier.
    return `<div class="reglages-photo-case"${e.large ? ' data-large' : ''}>`
      + `<div class="reglages-photo-apercu"${e.large ? ' data-large' : ''}>${apercu}</div>`
      + '<div class="reglages-photo-corps">'
        + `<p class="reglages-photo-nom">${esc(e.nom)}</p>`
        + `<p class="reglages-photo-ou">${esc(e.ou)}</p>`
        + '<div class="reglages-photo-actions">'
          + `<input type="file" accept="image/*" class="hors-ecran" id="photo-${esc(e.id)}" data-photo-vitrine="${esc(e.id)}">`
          + `<label class="action-douce" for="photo-${esc(e.id)}">`
            + (photo?.url ? 'Remplacer' : 'Choisir une photo')
          + '</label>'
          + (photo?.url ? `<button type="button" class="lien-nu" data-retirer-photo="${esc(e.id)}">Retirer</button>` : '')
        + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

/**
 * Reduit une image AVANT de l'envoyer.
 *
 * Une photo de telephone fait cinq mega-octets ; ce qu'on en affiche fait
 * 750 px de large. La reduction se fait donc ici, dans le navigateur : le
 * serveur ne recoit qu'une vingtaine de kilo-octets, et le commercant n'attend
 * pas trois minutes sur une connexion de campagne.
 */
function reduireImage(fichier, largeurMax, hauteurMax) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();

    lecteur.onerror = () => rejeter(new Error("Cette image n'a pas pu être lue."));
    lecteur.onload = () => {
      const image = new Image();
      image.onerror = () => rejeter(new Error("Ce fichier n'est pas une image."));
      image.onload = () => {
        // On recadre au centre, comme le fait l'affichage : ce que voit le
        // commercant dans l'aperçu est ce qui sera sur le site.
        const ratio = Math.max(largeurMax / image.width, hauteurMax / image.height);
        const largeur = image.width * ratio;
        const hauteur = image.height * ratio;

        const toile = document.createElement('canvas');
        toile.width = largeurMax;
        toile.height = hauteurMax;

        const contexte = toile.getContext('2d');
        contexte.drawImage(image, (largeurMax - largeur) / 2, (hauteurMax - hauteur) / 2, largeur, hauteur);

        resoudre(toile.toDataURL('image/jpeg', 0.82));
      };
      image.src = lecteur.result;
    };

    lecteur.readAsDataURL(fichier);
  });
}

// --- L'enregistrement -------------------------------------------------------

async function envoyerReglages() {
  const message = $('#messageReglages');
  const bouton = $('#enregistrerReglages');

  // Les horaires sont relus au moment d'enregistrer plutot qu'a chaque frappe :
  // un champ `time` a moitie saisi ne veut rien dire.
  for (const jour of SEMAINE) brouillon().hours[jour] = relireHoraire(jour);

  brouillon().slotStep = Number($('#reglagePas')?.value) || 15;
  brouillon().leadTimeMinutes = Number($('#reglageDelai')?.value) || 0;

  bouton.disabled = true;
  poserTexte(bouton, 'Enregistrement…');

  try {
    await enregistrerReglages(brouillon());

    // On repart de ce que le serveur a REELLEMENT enregistre, et non du
    // brouillon : il a pu corriger, tronquer ou refuser un champ, et c'est sa
    // version qui fait foi.
    await chargerReglages();

    // On relit les reglages : tout ce qui suit — les tarifs proposes dans le
    // formulaire de rendez-vous, la liste de l'equipe — doit suivre.
    //
    // ⚠️ PLUS DE peindreVitrine() ICI. La vitrine est un autre document depuis
    //    le lot 4 : il n'y a rien a repeindre a l'ecran, et l'appeler levait
    //    une ReferenceError qui avalait le message de confirmation. Le
    //    commercant voyait « Enregistrer » redevenir cliquable sans savoir si
    //    quoi que ce soit avait ete enregistre. Trouve par le test du lot 4,
    //    pas a l'ecran.
    CONFIG = await lireConfig();

    afficherMessage(message, 'Enregistré. Le site est à jour.', 'bon');
    marquerPropre();
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  } finally {
    bouton.disabled = false;
    poserTexte(bouton, 'Enregistrer');
  }
}

async function demanderReinitialisation() {
  if (!window.confirm('Revenir aux valeurs d\'origine ? Vos réglages actuels seront remplacés. Les rendez-vous ne sont pas touchés.')) return;

  try {
    await reinitialiser();
    await chargerReglages();

    CONFIG = await lireConfig();

    afficherMessage($('#messageReglages'), 'Réglages remis aux valeurs d\'origine.', 'bon');
  } catch (erreur) {
    afficherMessage($('#messageReglages'), erreur.message);
  }
}

// --- Le branchement ---------------------------------------------------------

function brancherReglages() {
  // ⚠️ `section[data-volet=...]` ET PAS `[data-volet=...]` : l'onglet qui ouvre
  // ce volet porte le MEME attribut, et il vient avant dans le document. Sans le
  // `section`, tous les ecouteurs ci-dessous se posaient sur le bouton d'onglet
  // — aucune saisie n'arrivait jamais dans le brouillon, la barre « modifications
  // non enregistrees » ne s'affichait pas, et « Enregistrer » renvoyait au
  // serveur des reglages inchanges. Le tout sans la moindre erreur en console.
  const volet = $('section[data-volet="reglages"]');
  if (!volet) return;

  // Un seul ecouteur pour toutes les saisies : le formulaire est engendre, et
  // brancher chaque champ obligerait a le refaire a chaque repeinte.
  volet.addEventListener('input', (evenement) => {
    const champ = evenement.target;
    if (!brouillon()) return;

    // Un champ simple, designe par son chemin (« salon.name »).
    if (champ.dataset.chemin) {
      const cles = champ.dataset.chemin.split('.');
      const derniere = cles.pop();
      const objet = cles.reduce((o, c) => o[c], brouillon());
      objet[derniere] = champ.value;
      return marquerModifie();
    }

    // Un champ d'une liste (prestation, personne, avis, rayon).
    if (champ.dataset.liste) {
      const liste = brouillon()[champ.dataset.liste];
      const element = liste[Number(champ.dataset.index)];
      const cle = champ.dataset.cle;

      if (champ.dataset.booleen !== undefined) {
        element[cle] = champ.value === 'oui';
      } else if (champ.type === 'number') {
        element[cle] = Number(champ.value);
      } else {
        element[cle] = champ.value;
      }
      return marquerModifie();
    }

    if (champ.dataset.jour !== undefined || champ.dataset.personneJour !== undefined) {
      marquerModifie();
    }
  });

  volet.addEventListener('change', async (evenement) => {
    const champ = evenement.target;
    if (!brouillon()) return;

    // Ouvrir ou fermer un jour : les champs d'heures suivent.
    if (champ.dataset.role === 'ouvert' && champ.dataset.personneJour === undefined) {
      const jour = champ.dataset.jour;
      for (const heure of $$(`input[type="time"][data-jour="${jour}"]:not([data-personne-jour])`)) {
        heure.disabled = !champ.checked;
      }
      return marquerModifie();
    }

    // Les prestations qu'une personne assure.
    if (champ.dataset.personne !== undefined) {
      const personne = brouillon().staff[Number(champ.dataset.personne)];
      const id = champ.dataset.service;

      if (champ.checked) {
        if (!personne.services.includes(id)) personne.services.push(id);
      } else {
        personne.services = personne.services.filter((s) => s !== id);
      }
      return marquerModifie();
    }

    // Horaires particuliers : on part des horaires du commerce, que la personne
    // n'a plus qu'a reduire. Partir de sept jours vides l'obligerait a tout
    // ressaisir pour changer un seul soir.
    if (champ.dataset.horairesPropres !== undefined) {
      const personne = brouillon().staff[Number(champ.dataset.horairesPropres)];
      personne.hours = champ.checked ? copier(brouillon().hours) : null;
      peindreEquipeReglages();
      return marquerModifie();
    }

    // Une photo d'equipe.
    if (champ.dataset.photoPersonne !== undefined) {
      const fichier = champ.files?.[0];
      if (!fichier) return;
      try {
        const personne = brouillon().staff[Number(champ.dataset.photoPersonne)];
        personne.photo = await reduireImage(fichier, 240, 240);
        peindreEquipeReglages();
        marquerModifie();
      } catch (erreur) {
        afficherMessage($('#messageReglages'), erreur.message);
      }
      return;
    }

    // Une photo de la vitrine. Celle-ci part TOUT DE SUITE au serveur, sans
    // passer par le brouillon : les photos vivent sur le disque et non dans les
    // reglages, et les faire attendre l'enregistrement melangerait deux choses
    // qui n'ont pas le meme cycle de vie.
    if (champ.dataset.photoVitrine !== undefined) {
      const fichier = champ.files?.[0];
      if (!fichier) return;

      const emplacement = champ.dataset.photoVitrine;
      const grand = emplacement === 'hero';

      try {
        const image = await reduireImage(fichier, grand ? 1200 : 700, grand ? 675 : 933);
        await envoyerPhoto(emplacement, image);
        await peindrePhotosReglages();

        CONFIG = await lireConfig();
        peindrePhotos(CONFIG);

        afficherMessage($('#messageReglages'), 'Photo enregistrée.', 'bon');
      } catch (erreur) {
        afficherMessage($('#messageReglages'), erreur.message);
      }
    }
  });

  // Les boutons d'ordre, de suppression et d'ajout.
  volet.addEventListener('click', async (evenement) => {
    const cible = evenement.target.closest('button');
    if (!cible || !brouillon()) return;

    const listes = { categorie: 'categories', service: 'services', staff: 'staff', avis: 'testimonials' };

    for (const [type, nom] of Object.entries(listes)) {
      const index = Number(cible.dataset.index);

      if (cible.dataset.monter === type) {
        const liste = brouillon()[nom];
        [liste[index - 1], liste[index]] = [liste[index], liste[index - 1]];
        peindreReglages();
        return marquerModifie();
      }
      if (cible.dataset.descendre === type) {
        const liste = brouillon()[nom];
        [liste[index + 1], liste[index]] = [liste[index], liste[index + 1]];
        peindreReglages();
        return marquerModifie();
      }
      if (cible.dataset.supprimer === type) {
        brouillon()[nom].splice(index, 1);
        peindreReglages();
        return marquerModifie();
      }
    }

    if (cible.dataset.retirerPhoto) {
      try {
        await retirerPhoto(cible.dataset.retirerPhoto);
        await peindrePhotosReglages();
        CONFIG = await lireConfig();
        peindrePhotos(CONFIG);
      } catch (erreur) {
        afficherMessage($('#messageReglages'), erreur.message);
      }
    }

    // Retirer un portrait. Contrairement aux photos de la vitrine, il vit dans
    // les reglages : on le vide dans le brouillon, et il ne partira qu'a
    // l'enregistrement — comme le prenom ou le role juste a cote. On pouvait
    // deposer un portrait, on ne pouvait pas en enlever un.
    if (cible.dataset.retirerPortrait !== undefined) {
      const personne = brouillon().staff[Number(cible.dataset.retirerPortrait)];
      if (personne) {
        personne.photo = '';
        peindreEquipeReglages();
        marquerModifie();
      }
    }
  });

  $('#ajouterCategorie')?.addEventListener('click', () => {
    brouillon().categories.push({ id: '', name: 'Nouveau rayon', desc: '' });
    peindreReglages();
    marquerModifie();
  });

  $('#ajouterPrestation')?.addEventListener('click', () => {
    brouillon().services.push({
      id: '', name: 'Nouvelle prestation', desc: '',
      duration: 30, price: 20, active: true, category: '',
    });
    peindreReglages();
    marquerModifie();
  });

  $('#ajouterPersonne')?.addEventListener('click', () => {
    brouillon().staff.push({
      id: '', name: 'Nouvelle personne', role: '', color: '#24405C',
      active: true, services: [], hours: null, photo: null,
    });
    peindreReglages();
    marquerModifie();
  });

  $('#ajouterAvis')?.addEventListener('click', () => {
    brouillon().testimonials.push({ id: '', quote: '', author: '', meta: '', rating: 5 });
    peindreReglages();
    marquerModifie();
  });

  $('#enregistrerReglages')?.addEventListener('click', envoyerReglages);
  $('#annulerBrouillon')?.addEventListener('click', chargerReglages);
  $('#reinitialiserReglages')?.addEventListener('click', demanderReinitialisation);
  $('#demanderAvis')?.addEventListener('click', copierMessageAvis);

  // Quitter la page avec un brouillon non enregistre : le navigateur demande
  // confirmation. C'est le seul endroit du site ou l'on interrompt quelqu'un, et
  // c'est justifie — perdre vingt minutes de saisie de tarifs est le genre
  // d'incident qui fait abandonner un outil.
  window.addEventListener('beforeunload', (evenement) => {
    if ($('#brouillon') && !$('#brouillon').hidden) evenement.preventDefault();
  });
}
