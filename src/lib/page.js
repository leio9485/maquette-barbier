// ---------------------------------------------------------------------------
// LA PAGE, RENDUE PAR LE SERVEUR
//
// Le site est une seule page HTML, et il le reste — ses morceaux sont recolles
// par src/lib/assemblage.js avant tout ce qui suit. Mais l'en-tete de cette
// page — le titre de l'onglet, la description, les donnees structurees que
// lisent les moteurs de recherche — contenait des valeurs ecrites en dur.
//
// Le probleme n'etait pas theorique : le commercant pouvait changer son adresse
// ou ses horaires depuis son espace, voir le site se mettre a jour sous ses
// yeux, et Google continuer d'afficher l'ancienne fiche. Le JavaScript de la
// page corrige bien le titre et la description au chargement, mais les donnees
// structurees, elles, doivent etre justes AVANT que la page ne s'anime : c'est
// ce que lit un robot, un apercu de lien dans un message, un partage sur les
// reseaux.
//
// Ce fichier remplace donc, a chaque envoi de la page, le bloc marque
// <!--@reglages--> ... <!--/@reglages--> par sa version a jour. Si les
// marqueurs sont absents, ou si la base ne repond pas, la page est envoyee
// telle quelle : le site reste consultable, avec son contenu de secours.
// ---------------------------------------------------------------------------

import { PUBLIC_URL } from '../config.js';
import { etatDuMoment } from './etat.js';
import { loadConfig } from './settings.js';
import { minifierPage } from './minify.js';
import { listerPhotos } from './photos.js';
import { sectionPrestations } from './catalogue.js';
import { sectionTemoignages } from './temoignages.js';
import { assemblerPage } from './assemblage.js';

/**
 * Les zones de la page remplacees a chaque envoi.
 *
 * `reglages` est dans le <head> : titre, description, donnees structurees.
 * `prestations` est le corps de la section des tarifs, jusqu'ici peint par le
 * seul JavaScript de la page (voir src/lib/catalogue.js).
 * `temoignages` est la section « Avis » ENTIERE, `<section>` compris : elle se
 * masque quand le salon n'a saisi aucun temoignage, et cet attribut-la ne
 * pourrait pas etre pose depuis l'interieur de la zone (voir
 * src/lib/temoignages.js).
 *
 * Meme discipline pour les trois : marqueurs absents, la zone est laissee telle
 * quelle. Un site qui affiche un contenu un peu ancien vaut mieux qu'un site
 * indisponible.
 */
const ZONES = {
  reglages: ['<!--@reglages-->', '<!--/@reglages-->'],
  prestations: ['<!--@prestations-->', '<!--/@prestations-->'],
  temoignages: ['<!--@temoignages-->', '<!--/@temoignages-->'],
  bandeau: ['<!--@bandeau-->', '<!--/@bandeau-->'],
  // Le second document du site : /annuler. Son en-tete se resume au titre et a
  // la description — ni donnees structurees ni og:image, cette page ne se
  // partage pas et ne s'indexe pas.
  annulerEntete: ['<!--@annuler-entete-->', '<!--/@annuler-entete-->'],
};

/**
 * Remplace le contenu d'une zone balisee, marqueurs conserves.
 *
 * Renvoie le HTML inchange si les marqueurs manquent, sont dans le desordre, ou
 * si `contenu` est nul — les trois cas se traitent pareil : on ne touche a rien.
 */
function remplacerZone(html, zone, contenu) {
  if (contenu === null || contenu === undefined) return html;

  const [ouvrant, fermant] = ZONES[zone];
  const debut = html.indexOf(ouvrant);
  const fin = html.indexOf(fermant);
  if (debut === -1 || fin === -1 || fin < debut) return html;

  return html.slice(0, debut + ouvrant.length) + '\n' + contenu + '\n' + html.slice(fin);
}

const JOURS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- Le fichier, garde en memoire -----------------------------------------

/**
 * La page, morceaux recolles, gardee en memoire.
 *
 * La page ne s'ecrit plus dans un seul fichier : elle est repartie en morceaux
 * dans src/page/ (un fichier par section de style, par bloc de la vitrine et
 * par section du JavaScript), que `assemblerPage()` recolle. Le resultat est
 * exactement ce qu'etait public/index.html — voir src/lib/assemblage.js pour la
 * raison de ce recollage plutot qu'un decoupage en fichiers servis a part.
 *
 * L'assemblage est fait une seule fois, puis garde : c'est le meme cache
 * qu'avant, avec la meme verification des dates de modification pendant le
 * developpement, pour ne pas avoir a redemarrer le serveur a chaque retouche.
 *
 * C'est aussi la, et une seule fois par version des fichiers, que le style et
 * le JavaScript sont alleges (src/lib/minify.js) : la source garde ses
 * commentaires et son indentation, la copie envoyee s'en passe.
 */
function lireFichier(nom = 'index') {
  return assemblerPage(minifierPage, nom);
}

// --- Echappement -----------------------------------------------------------

/** Texte pose dans un attribut HTML (content="..."). */
function attr(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Texte pose entre deux balises. */
function texte(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * JSON pose a l'interieur d'une balise <script>.
 *
 * Le `<` est neutralise : sans cela, un nom de commerce contenant "</script>"
 * refermerait la balise et le reste passerait pour du code a executer.
 */
function json(valeur) {
  return JSON.stringify(valeur, null, 2).replaceAll('<', '\\u003c');
}

// --- Donnees structurees ---------------------------------------------------

/**
 * Les horaires au format attendu par schema.org.
 *
 * Une pause dejeuner coupe la journee en deux plages : c'est la seule facon
 * honnete de la decrire ici, ce format ne sachant pas exprimer un trou. Les
 * jours qui partagent exactement les memes heures sont regroupes, pour ne pas
 * repeter sept fois la meme ligne.
 */
function horairesStructures(hours) {
  const groupes = new Map();

  for (let jour = 0; jour < 7; jour++) {
    const h = hours[jour];
    if (!h) continue;

    const plages = h.pause
      ? [[h.open, h.pause[0]], [h.pause[1], h.close]]
      : [[h.open, h.close]];

    for (const [ouverture, fermeture] of plages) {
      const cle = `${ouverture}-${fermeture}`;
      if (!groupes.has(cle)) groupes.set(cle, { opens: ouverture, closes: fermeture, jours: [] });
      groupes.get(cle).jours.push(JOURS_EN[jour]);
    }
  }

  return [...groupes.values()].map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.jours,
    opens: g.opens,
    closes: g.closes,
  }));
}

/**
 * Le catalogue de prestations, en donnees structurees.
 *
 * C'est ce qui permet a un moteur d'afficher "Coupe & Brushing — 32 €" sans que
 * personne n'ait ouvert le site. Le gain est proportionnel a la taille du
 * catalogue : anecdotique a trois prestations, considerable a vingt-six.
 *
 * Les rayons deviennent des `OfferCatalog` imbriques quand le commerce en a
 * defini ; sinon, les offres sont posees a plat, exactement comme avant leur
 * arrivee. Un rayon vide est saute — une categorie sans offre n'apprend rien.
 */
function offresStructurees(config) {
  const offre = (s) => ({
    '@type': 'Offer',
    itemOffered: {
      '@type': 'Service',
      name: s.name,
      ...(s.desc ? { description: s.desc } : {}),
    },
    price: s.price.toFixed(2),
    priceCurrency: 'EUR',
  });

  if (!config.categories.length) {
    return {
      '@type': 'OfferCatalog',
      name: 'Prestations',
      itemListElement: config.services.map(offre),
    };
  }

  const rayons = config.categories
    .map((c) => ({ nom: c.name, prestations: config.services.filter((s) => s.category === c.id) }))
    .filter((r) => r.prestations.length);

  const sansRayon = config.services.filter(
    (s) => !config.categories.some((c) => c.id === s.category)
  );
  if (sansRayon.length) rayons.push({ nom: 'Autres prestations', prestations: sansRayon });

  return {
    '@type': 'OfferCatalog',
    name: 'Prestations',
    itemListElement: rayons.map((r) => ({
      '@type': 'OfferCatalog',
      name: r.nom,
      itemListElement: r.prestations.map(offre),
    })),
  };
}

function donneesStructurees(config, photos) {
  const fiche = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: config.salon.name,
    email: config.salon.email,
    telephone: config.salon.phone,
    priceRange: '€€',
    address: {
      '@type': 'PostalAddress',
      streetAddress: config.salon.street,
      postalCode: config.salon.postalCode,
      addressLocality: config.salon.city,
      addressCountry: 'FR',
    },
    openingHoursSpecification: horairesStructures(config.hours),
  };

  if (config.services.length) fiche.hasOfferCatalog = offresStructurees(config);

  if (PUBLIC_URL) fiche.url = PUBLIC_URL;

  // Les adresses du commerce ailleurs sur le web.
  //
  // `sameAs` est ce qui dit a un moteur « ce site et cette fiche Google sont le
  // MEME commerce ». Pour un commerce local, c'est le lien le plus utile de
  // tout ce bloc : la fiche Google Business Profile pese souvent plus lourd que
  // le site lui-meme, et rien ne les reliait jusqu'ici.
  //
  // Vide = la cle n'apparait pas du tout. Un `sameAs: []` n'apprend rien a
  // personne, et un commerce sans reseaux sociaux est le cas courant.
  const liens = [config.salon.links.google, config.salon.links.instagram, config.salon.links.facebook]
    .filter(Boolean);
  if (liens.length) fiche.sameAs = liens;

  // La photo du commerce. Recommandee par Google pour une fiche de commerce
  // local, et c'est celle que le commercant a lui-meme deposee.
  //
  // Adresse ABSOLUE obligatoire — cette fiche est lue ailleurs que sur le site —
  // d'ou la dependance a PUBLIC_URL, exactement comme og:image.
  if (PUBLIC_URL && photos?.hero?.url) fiche.image = PUBLIC_URL + photos.hero.url;

  // PAS D'`aggregateRating` ICI, ET C'EST DELIBERE.
  //
  // La note et le nombre d'avis restent affiches sur la vitrine — ils rassurent,
  // c'est leur role — mais ils ne sont plus publies en donnees structurees.
  //
  // Google ignore depuis 2019 les avis dits « auto-decernes » : ceux qu'un
  // commerce publie a son propos sur son propre site. Une note posee ici
  // n'aurait donc AUCUN effet sur les resultats de recherche, tout en exposant
  // a un avertissement dans la Search Console — et, si les chiffres etaient
  // approximatifs, a une affirmation invitee de nulle part.
  //
  // Les vrais avis Google sont deja rattaches a la fiche Google Business
  // Profile du commerce, que `sameAs` ci-dessus relie desormais a ce site.
  // C'est la, et seulement la, qu'ils comptent.

  return fiche;
}

// --- L'en-tete -------------------------------------------------------------

/**
 * Le bloc d'en-tete, construit depuis les reglages.
 *
 * ATTENTION : le titre et la description sont aussi reecrits cote navigateur
 * par `hydrateStatic()` (src/page/js/04-contenu-statique.js), pour qu'un enregistrement des
 * reglages se voie sans recharger la page. Les deux formulations doivent rester
 * identiques — si vous en changez une, changez l'autre.
 */
function enTete(config, photos) {
  const titre = `${config.salon.name} — Barbier à ${config.salon.city}`;
  const description = `${config.salon.name}, barbier à ${config.salon.city} : `
    + 'coupe, barbe, rasage au coupe-chou. Réservez votre créneau en ligne, à toute heure.';

  const lignes = [
    `<title>${texte(titre)}</title>`,
    `<meta name="description" content="${attr(description)}">`,
    `<meta property="og:title" content="${attr(titre)}">`,
    '<meta property="og:description" content="Coupe, barbe, rasage au coupe-chou. '
      + 'Réservez votre créneau en ligne, à toute heure.">',
  ];

  // La photo d'accueil, annoncee des l'en-tete.
  //
  // C'est le plus gros element du premier ecran, donc celui que le navigateur
  // met le plus longtemps a afficher (le "LCP" des outils de mesure). Le
  // probleme : elle n'est pas dans le HTML. C'est `paintPhotos()` qui la pose,
  // en fond de `.hero-visual`, une fois le JavaScript execute et les reglages
  // recus — le navigateur ne pouvait donc PAS la deviner en lisant la page, et
  // ne commencait a la telecharger que tres tard.
  //
  // Ce `preload` la lui annonce des la premiere ligne du fichier : il la demande
  // pendant qu'il lit encore le reste. Quand `paintPhotos()` la reclame enfin,
  // elle est deja la.
  //
  // L'adresse doit etre RIGOUREUSEMENT la meme que celle appliquee ensuite,
  // `?v=` compris : au moindre ecart, l'image serait telechargee deux fois.
  // C'est la meme valeur, prise a la meme source (listerPhotos()), donc elle
  // suit d'elle-meme un changement de photo.
  //
  // Adresse relative : contrairement a og:image, un preload est lu par le
  // navigateur qui a la page sous les yeux. Pas besoin de PUBLIC_URL.
  if (photos?.hero?.url) {
    lignes.push(
      `<link rel="preload" as="image" href="${attr(photos.hero.url)}" fetchpriority="high">`
    );
  }

  if (PUBLIC_URL) {
    lignes.push(`<link rel="canonical" href="${attr(PUBLIC_URL)}">`);
    lignes.push(`<meta property="og:url" content="${attr(PUBLIC_URL)}">`);

    // L'image de l'apercu, celle qui s'affiche quand on envoie l'adresse du
    // salon par SMS ou qu'on la partage. C'est la photo d'accueil : la seule
    // grande image de la page, et celle que le commercant a choisie.
    //
    // Adresse ABSOLUE obligatoire — un apercu se fabrique ailleurs que sur le
    // site — d'ou la dependance a PUBLIC_URL. Sans elle, pas d'og:image :
    // une adresse relative serait ignoree, au mieux.
    if (photos?.hero?.url) {
      lignes.push(`<meta property="og:image" content="${attr(PUBLIC_URL + photos.hero.url)}">`);
    }
  }

  lignes.push('<script type="application/ld+json">');
  lignes.push(json(donneesStructurees(config, photos)));
  lignes.push('</script>');

  return lignes.join('\n');
}

// --- Le bandeau d'etat -----------------------------------------------------

/**
 * Le contenu du bandeau, en trois morceaux separes par un point median.
 *
 * Les phrases arrivent toutes faites de src/lib/etat.js : ici, on ne fait que
 * les poser dans des balises. C'est ce qui garantit que la page envoyee et
 * /api/status disent exactement la meme chose, dans les memes mots.
 *
 * Renvoie `null` si l'etat n'a pas pu etre calcule — `remplacerZone` laisse
 * alors le contenu de secours ecrit dans parties/bandeau-etat.html, qui annonce
 * les horaires et rien de plus.
 *
 * `data-etat` porte l'information a la place de la couleur : c'est lui que le
 * style lit pour teinter « OUVERT » en vert, et lui que le JavaScript remet a
 * jour. La couleur n'est jamais le seul porteur du sens — le mot est ecrit.
 */
function bandeauEtat(etat) {
  if (!etat) return null;

  const separateur = '<span class="bandeau-sep" aria-hidden="true">·</span>';

  const morceaux = [
    `<span class="bandeau-mot" data-etat="${etat.ouvert ? 'ouvert' : 'ferme'}">${texte(etat.etat)}</span>`,
  ];

  if (etat.suite) morceaux.push(`<span class="bandeau-suite">${texte(etat.suite)}</span>`);
  if (etat.prochain) morceaux.push(`<span class="bandeau-prochain">${texte(etat.prochain)}</span>`);

  return morceaux.join(separateur);
}

/**
 * Pose le numero du jour (nonce) sur les balises <script> de la page.
 *
 * La politique de contenu n'autorise que les scripts qui le portent. Ce marquage
 * est fait a part de l'injection des reglages, et sans dependre de ses
 * marqueurs : meme si la base ne repond pas et que la page part telle quelle,
 * son JavaScript doit s'executer.
 */
function marquerScripts(html, nonce) {
  return html.replaceAll('<script', `<script nonce="${nonce}"`);
}

// --- Rendu -----------------------------------------------------------------

/**
 * La page complete, en-tete a jour.
 *
 * Tout echec renvoie le fichier tel quel plutot qu'une erreur : mieux vaut un
 * site affiche avec un en-tete un peu ancien qu'un site indisponible.
 */
export async function renderIndex(nonce) {
  const fichier = await lireFichier();
  const marquer = (html) => (nonce ? marquerScripts(html, nonce) : html);

  let config;
  let photos = {};
  try {
    [config, photos] = await Promise.all([
      loadConfig({ includeInactive: false }),
      listerPhotos(),
    ]);
  } catch (erreur) {
    console.error('Page non mise a jour (reglages illisibles) :', erreur.message);
    return marquer(fichier);
  }

  let html = remplacerZone(fichier, 'reglages', enTete(config, photos));

  // Les prestations dans le HTML lui-meme, et non plus seulement peintes par le
  // JavaScript de la page. La page les reecrira a l'identique au chargement :
  // ce qui est ecrit ici est ce que lisent ceux qui n'executent pas de code.
  html = remplacerZone(html, 'prestations', sectionPrestations(config));

  // Les avis, pour la même raison — avec une nuance : ils étaient DÉJÀ dans le
  // HTML avant d'être rendus modifiables (ils y étaient écrits en dur). Les
  // injecter ici n'est donc pas un gain, c'est ce qui évite une régression.
  html = remplacerZone(html, 'temoignages', sectionTemoignages(config));

  // Le bandeau d'état, écrit dans la page plutôt que peint au chargement.
  //
  // C'EST CE QUI LE REND HONNÊTE. Peint par le JavaScript, il aurait affiché un
  // vide, puis un état — et rien du tout pour qui n'exécute pas de code, ou pour
  // qui arrive sur une connexion qui traîne. Écrit ici, il est juste à la
  // première image, et le rafraîchissement qui suit ne fait que le maintenir à
  // jour.
  //
  // C'est aussi ce qui permet la dégradation propre exigée : si /api/status ne
  // répond pas, ce texte-ci reste, et il dit la vérité de l'instant où la page a
  // été envoyée.
  html = remplacerZone(html, 'bandeau', bandeauEtat(await etatDuMoment()));

  return marquer(html);
}

/**
 * La page d'annulation (/annuler), en-tete a jour.
 *
 * Beaucoup plus courte que celle de la vitrine, et c'est le sujet : cette page
 * ne se partage pas, ne s'indexe pas, et n'a rien a dire a un moteur de
 * recherche. Elle n'a donc ni og:*, ni adresse canonique, ni donnees
 * structurees — seulement un titre qui porte le nom du commerce, pour que le
 * client sache dans quel onglet il se trouve.
 *
 * Meme discipline que ci-dessus : la base illisible renvoie le fichier tel
 * quel, avec son contenu de secours.
 */
export async function renderAnnuler(nonce) {
  const fichier = await lireFichier('annuler');
  const marquer = (html) => (nonce ? marquerScripts(html, nonce) : html);

  let config;
  try {
    config = await loadConfig({ includeInactive: false });
  } catch (erreur) {
    console.error('Page d\'annulation non mise a jour (reglages illisibles) :', erreur.message);
    return marquer(fichier);
  }

  const titre = `Annuler un rendez-vous — ${config.salon.name}`;
  const entete = [
    `<title>${texte(titre)}</title>`,
    '<meta name="description" content="Annulez ou déplacez votre rendez-vous avec votre référence.">',
  ].join('\n');

  return marquer(remplacerZone(fichier, 'annulerEntete', entete));
}
