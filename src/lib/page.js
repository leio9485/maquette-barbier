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

import { PUBLIC_URL, DEMO_MODE, HEBERGEUR_NOM, HEBERGEUR_PAYS, HEBERGEUR_URL, HEBERGEUR_UE } from '../config.js';
import { DEMO_USERNAME, DEMO_PASSWORD } from './demo.js';
import { etatDuMoment } from './etat.js';
import { paragrapheHebergement } from './hebergement.js';
import { loadConfig } from './settings.js';
import { minifierPage } from './minify.js';
import { listerPhotos, listerLegendes, listerDescriptions, sectionHero, preloadHero } from './photos.js';
import { sectionPrestations } from './catalogue.js';
import { sectionTemoignages } from './temoignages.js';
import { sectionGalerie } from './galerie.js';
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
  galerie: ['<!--@galerie-->', '<!--/@galerie-->'],
  hero: ['<!--@hero-->', '<!--/@hero-->'],
  // L'identite legale et l'hebergeur, dans la surimpression des mentions
  // legales. ECRITE PAR LE SERVEUR ET NON PEINTE : ce sont des obligations
  // legales, elles doivent exister dans le fichier envoye meme si rien ne
  // s'execute (c'est ce que dit parties/mentions-legales.html depuis le
  // premier jour, et le paragraphe d'hebergement, lui, ne vient pas des
  // reglages mais de la configuration de l'instance).
  legal: ['<!--@legal-->', '<!--/@legal-->'],
  // Le second document du site : /annuler. Son en-tete se resume au titre et a
  // la description — ni donnees structurees ni og:image, cette page ne se
  // partage pas et ne s'indexe pas.
  annulerEntete: ['<!--@annuler-entete-->', '<!--/@annuler-entete-->'],
  espaceEntete: ['<!--@espace-entete-->', '<!--/@espace-entete-->'],
  // Le quatrieme document : la page « adresse introuvable ». Son corps entier
  // est reecrit a chaque envoi — il porte le nom du commerce et son telephone,
  // et cette page-la n'execute aucun JavaScript qui pourrait les y poser.
  introuvableEntete: ['<!--@introuvable-entete-->', '<!--/@introuvable-entete-->'],
  introuvable: ['<!--@introuvable-->', '<!--/@introuvable-->'],
  espaceLien: ['<!--@espace-lien-->', '<!--/@espace-lien-->'],
  // Les identifiants de la demonstration, sur l'ecran de connexion. Ecrits ici
  // et non reveles par le navigateur : le motif complet est dans
  // parties/espace-commercant.html, c'etait le seul CLS du site.
  espaceDemo: ['<!--@espace-demo-->', '<!--/@espace-demo-->'],
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
function offresStructurees(config, idCommerce) {
  const offre = (s) => ({
    '@type': 'Offer',
    itemOffered: {
      '@type': 'Service',
      name: s.name,
      ...(s.desc ? { description: s.desc } : {}),
      // LA DUREE, au format ISO 8601 : « PT25M » pour vingt-cinq minutes.
      //
      // Elle vient de la prestation, jamais d'une valeur ecrite ici : c'est la
      // meme duree que celle qui reserve le creneau, et les deux ne peuvent
      // donc pas diverger. `provider` est le commerce lui-meme, ce que
      // schema.org attend sur un `Service` autonome.
      ...(s.duration ? { estimatedDuration: `PT${s.duration}M` } : {}),
      // >>> UNE REFERENCE, PAS UNE COPIE. <<<
      //
      // C'etait `{ '@type': …, name: … }` recopie a chaque prestation. Un objet
      // sans `@id` est un NOEUD NEUF pour un moteur : treize prestations
      // produisaient donc treize commerces de plus, chacun reduit a son nom.
      // Le Rich Results Test de Google le disait le 12 aout 2026 — quatorze
      // « Commerces et services a proximite » au lieu d'un, et 4 avertissements
      // par doublon (`priceRange`, `address`, `telephone`, `image` manquants),
      // soit cinquante-deux avertissements pour une seule cause.
      //
      // Avec `@id`, c'est un RENVOI vers la fiche de tete : le moteur relie les
      // deux noeuds au lieu d'en creer un second. Le commerce garde son adresse
      // et son telephone, ecrits une seule fois.
      provider: { '@id': idCommerce },
    },
    price: s.price.toFixed(2),
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
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
  // L'IDENTIFIANT DU COMMERCE, pour que le catalogue puisse le designer sans le
  // recopier (voir `provider` dans offresStructurees()).
  //
  // Absolu quand l'adresse publique est connue : un `@id` sert justement a
  // reconnaitre la meme entite d'un document a l'autre, et un identifiant
  // relatif perd ce pouvoir des qu'on lit le bloc hors de sa page. Relatif
  // sinon — sans PUBLIC_URL il n'y a de toute facon ni adresse canonique ni
  // base absolue, et `#commerce` se resout alors contre la page servie.
  const idCommerce = PUBLIC_URL ? `${PUBLIC_URL}/#commerce` : '#commerce';

  const fiche = {
    '@context': 'https://schema.org',
    '@id': idCommerce,
    // LE TYPE VIENT DES REGLAGES, il n'est plus ecrit ici.
    //
    // Une valeur dans les reglages (voir TYPES_DE_COMMERCE dans
    // src/lib/settings.js), et la meme base sert une onglerie ou un institut
    // sans qu'une ligne change ici.
    //
    // ⚠️ SCHEMA.ORG N'A PAS DE TYPE DISTINCT POUR UN BARBIER. `BarberShop` a
    //    ete la valeur par defaut de ce site pendant plusieurs lots — un type
    //    invente, jamais defini par schema.org (verifie : schema.org/BarberShop
    //    renvoie 404). `HairSalon` est le sous-type le plus proche, pour un
    //    barbier comme pour un salon de coiffure.
    '@type': config.salon.type,
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

  // La position exacte, quand le commercant l'a saisie. Facultative : l'adresse
  // postale ci-dessus est ce qui compte le plus pour un commerce local, et une
  // latitude approximative est pire qu'aucune — elle envoie les clients a cote.
  if (config.salon.geo?.lat !== null && config.salon.geo?.lon !== null) {
    fiche.geo = {
      '@type': 'GeoCoordinates',
      latitude: config.salon.geo.lat,
      longitude: config.salon.geo.lon,
    };
  }

  if (config.services.length) fiche.hasOfferCatalog = offresStructurees(config, idCommerce);

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

  // LA RESERVATION, DECLAREE COMME UNE ACTION.
  //
  // C'est ce qui permet a un moteur — ou a un assistant — de savoir que ce site
  // prend des rendez-vous, et ou. Sans elle, la page dit ce qu'elle vend et ses
  // horaires, mais rien ne dit qu'on peut y reserver.
  //
  // ⚠️ ADRESSE ABSOLUE, donc conditionnee a PUBLIC_URL, comme og:image et
  //    l'adresse canonique : cette fiche est lue ailleurs que sur le site, et
  //    « #reserver » tout seul n'y designe rien.
  //
  // `EntryPoint` avec `actionPlatform` : la reservation se fait dans un
  // navigateur, sur n'importe quel appareil. Les trois plateformes nommees sont
  // celles que schema.org reconnait ; les omettre laisse l'action sans support
  // declare.
  if (PUBLIC_URL) {
    fiche.potentialAction = {
      '@type': 'ReserveAction',
      name: 'Réserver un créneau',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${PUBLIC_URL}/#reserver`,
        inLanguage: 'fr-FR',
        actionPlatform: [
          'https://schema.org/DesktopWebPlatform',
          'https://schema.org/MobileWebPlatform',
          'https://schema.org/IOSPlatform',
        ],
      },
      result: { '@type': 'Reservation', name: 'Rendez-vous' },
    };
  }

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
/**
 * `vueLegal` : `'mentions'` ou `'confidentialite'` quand la page est servie
 * depuis /mentions-legales ou /confidentialite (lot D, point D3) — sinon
 * `undefined`. Change le titre, la description et l'adresse canonique ; le
 * reste de l'en-tete (JSON-LD, aperçu de lien) reste celui de la vitrine, ces
 * deux adresses servant le MEME document, la surimpression déjà ouverte.
 */
function enTete(config, photos, vueLegal) {
  const PAGES_LEGALES = {
    mentions: ['Mentions légales', '/mentions-legales'],
    confidentialite: ['Confidentialité', '/confidentialite'],
  };
  const [titreLegal, cheminLegal] = PAGES_LEGALES[vueLegal] ?? [];

  const titre = titreLegal
    ? `${titreLegal} — ${config.salon.name}`
    : `${config.salon.name} — Barbier à ${config.salon.city}`;
  const description = titreLegal
    ? `${titreLegal} de ${config.salon.name}, ${config.salon.city}.`
    : `${config.salon.name}, barbier à ${config.salon.city} : `
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
  // met le plus longtemps a afficher (le « LCP » des outils de mesure). Le
  // preload le lui annonce des la premiere ligne du fichier, pendant qu'il lit
  // encore le reste.
  //
  // >>> LA REGLE EST ECRITE A COTE DU `<picture>`, PAS ICI (src/lib/photos.js,
  // `preloadHero()`). <<< Les deux doivent demander RIGOUREUSEMENT la meme
  // image, `?v=` compris, sinon elle part deux fois — et c'est exactement ce
  // qui se passait : ce bloc ecrivait un preload JPEG pendant que le
  // `<picture>` affichait le WebP. Soixante kilo-octets pour rien a chaque
  // premiere visite. Deux endroits qui doivent dire la meme chose finissent
  // toujours par diverger : il n'y en a plus qu'un.
  const preload = preloadHero(photos);
  if (preload) lignes.push(preload);

  if (PUBLIC_URL) {
    const adresse = PUBLIC_URL + (cheminLegal ?? '');
    lignes.push(`<link rel="canonical" href="${attr(adresse)}">`);
    lignes.push(`<meta property="og:url" content="${attr(adresse)}">`);

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
 * L'identite legale du commerce et l'hebergeur, dans les mentions legales.
 *
 * DEUX CORRECTIFS TIENNENT DANS CETTE FONCTION.
 *
 *   - LE SIRET NE DIT PLUS « à compléter ». C'etait un gabarit visible sur une
 *     vitrine qu'on montre a des prospects. Renseigne, la ligne s'affiche ;
 *     vide, elle n'existe pas — une mention absente vaut mieux qu'une mention
 *     inachevee. Le `<p>` reste dans le document, masque : c'est lui que
 *     `peindreChamps()` leve quand le commercant saisit son numero sans
 *     recharger la page (js/04-contenu-statique.js).
 *
 *   - L'HEBERGEMENT N'AFFIRME QUE CE QUI EST CONFIGURE (src/lib/hebergement.js).
 *
 * Les deux autres lignes gardent leur repli d'origine : « Entreprise
 * individuelle » est le cas courant, et le directeur de la publication retombe
 * sur le nom du commerce — un independant qui publie sous son enseigne est son
 * propre directeur de publication.
 */
function blocLegal(config) {
  const legal = config.salon.legal ?? {};

  const siret = legal.siret
    ? `<p data-ligne="siret">SIRET : <span class="donnee" data-champ="siret">${texte(legal.siret)}</span></p>`
    : '<p data-ligne="siret" hidden>SIRET : <span class="donnee" data-champ="siret"></span></p>';

  return [
    `<p>Forme juridique : <span data-champ="forme-juridique">${texte(legal.form || 'Entreprise individuelle')}</span></p>`,
    siret,
    `<p>Directeur de la publication : <span data-champ="directeur-publication">${texte(legal.publicationDirector || config.salon.name)}</span></p>`,
    '',
    '<h3>Hébergement</h3>',
    paragrapheHebergement({
      nom: HEBERGEUR_NOM,
      pays: HEBERGEUR_PAYS,
      url: HEBERGEUR_URL,
      ue: HEBERGEUR_UE,
    }),
  ].join('\n');
}

/**
 * Ouvre la surimpression des mentions légales DANS LE HTML SERVI — lot D,
 * point D3.
 *
 * `/mentions-legales` et `/confidentialite` servent EXACTEMENT le même
 * document que `/` (voir renderIndex ci-dessous), la surimpression déjà
 * ouverte : « une adresse qui répond », plutôt qu'un second document qui
 * dupliquerait le tunnel, les prestations et les avis. Le JavaScript la
 * réouvre à l'identique une fois chargé (`ouvrirLegal()`, js/05-navigation.js)
 * — c'est ce qui permet l'INTERCEPTION AU CLIC : depuis une page déjà
 * ouverte, ces liens n'entraînent plus de rechargement.
 *
 * Remplacement de chaîne LITTÉRAL, pas une zone marquée : ce contenu est
 * statique (src/page/parties/mentions-legales.html), il n'a jamais eu besoin
 * d'être reconstruit depuis les réglages. `tests/seo.mjs` vérifie que ces deux
 * routes affichent bien le texte attendu, ce qui suffit à attraper un
 * changement de balisage qui casserait ce remplacement.
 */
function ouvrirLegalDansLaPage(html, vue) {
  let sortie = html.replace(
    '<div class="surimpression" id="surimpressionLegal" hidden>',
    '<div class="surimpression" id="surimpressionLegal">'
  );

  if (vue === 'confidentialite') {
    sortie = sortie
      .replace(
        '<h2 class="surimpression-titre" id="titreLegal">Mentions légales</h2>',
        '<h2 class="surimpression-titre" id="titreLegal">Confidentialité</h2>'
      )
      .replace('<div data-legal-vue="mentions">', '<div data-legal-vue="mentions" hidden>')
      .replace('<div data-legal-vue="confidentialite" hidden>', '<div data-legal-vue="confidentialite">');
  }

  return sortie;
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
export async function renderIndex(nonce, vueLegal) {
  const fichier = await lireFichier();
  const marquer = (html) => (nonce ? marquerScripts(html, nonce) : html);

  let config;
  let photos = {};
  let legendes = {};
  let descriptions = {};
  try {
    [config, photos, legendes, descriptions] = await Promise.all([
      loadConfig({ includeInactive: false }),
      listerPhotos(),
      listerLegendes(),
      listerDescriptions(),
    ]);
  } catch (erreur) {
    console.error('Page non mise a jour (reglages illisibles) :', erreur.message);
    return marquer(fichier);
  }

  let html = remplacerZone(fichier, 'reglages', enTete(config, photos, vueLegal));

  // LA GALERIE, ECRITE DANS LA PAGE plutot que peinte au chargement.
  //
  // Les images n'avaient AUCUN `src` dans le HTML servi : c'est le JavaScript
  // qui les posait. Un robot qui ne l'execute pas ne voyait donc pas une seule
  // image du site. Elles y sont maintenant des le premier octet — avec leur
  // description, et seulement pour les cases qui portent vraiment une photo
  // (jusqu'a douze, voir src/lib/galerie.js).
  html = remplacerZone(html, 'galerie', sectionGalerie({ photos, legendes, descriptions }));

  // LE VISUEL D'ACCUEIL, ECRIT DANS LA PAGE — lot D, point D2. C'etait la
  // derniere image de la vitrine sans `src` ni `alt` dans le HTML servi.
  html = remplacerZone(html, 'hero', sectionHero(photos, descriptions));

  // Les prestations dans le HTML lui-meme, et non plus seulement peintes par le
  // JavaScript de la page. La page les reecrira a l'identique au chargement :
  // ce qui est ecrit ici est ce que lisent ceux qui n'executent pas de code.
  html = remplacerZone(html, 'prestations', sectionPrestations(config));

  // Les avis, pour la même raison — avec une nuance : ils étaient DÉJÀ dans le
  // HTML avant d'être rendus modifiables (ils y étaient écrits en dur). Les
  // injecter ici n'est donc pas un gain, c'est ce qui évite une régression.
  html = remplacerZone(html, 'temoignages', sectionTemoignages(config));

  // L'identite legale et l'hebergeur : voir `blocLegal()`. Une mention legale
  // doit exister dans le fichier envoye, meme quand rien ne s'execute.
  html = remplacerZone(html, 'legal', blocLegal(config));

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

  // L'ENTRÉE DE L'ESPACE COMMERÇANT, EN BAS DE PAGE : SEULEMENT SUR LA
  // DÉMONSTRATION.
  //
  // Elle y est utile — un prospect qui ne verrait jamais l'agenda ni les
  // réglages ne verrait pas ce qu'on lui vend. Chez un vrai client, elle
  // n'apporte rien à ses clients et offre une porte à essayer à tous les
  // autres. Le commerçant, lui, arrive par /espace-salon mis en raccourci sur
  // son écran d'accueil : la session se renouvelle à l'usage, il ne resaisira
  // presque jamais son mot de passe.
  //
  // RETIRÉE DU DOCUMENT, ET PAS SEULEMENT MASQUÉE : un lien caché reste dans la
  // source, où le premier curieux le lit.
  if (!DEMO_MODE) html = remplacerZone(html, 'espaceLien', '');

  if (vueLegal === 'mentions' || vueLegal === 'confidentialite') {
    html = ouvrirLegalDansLaPage(html, vueLegal);
  }

  return marquer(html);
}

/**
 * L'espace commercant (/espace-salon), en-tete a jour.
 *
 * Aucun `og:*`, aucune adresse canonique, aucune donnee structuree : cette page
 * ne se partage pas et ne s'indexe pas. Le titre porte le nom du commerce, pour
 * que l'onglet garde en favori se reconnaisse.
 */
export async function renderEspace(nonce) {
  const fichier = await lireFichier('espace');
  const marquer = (html) => (nonce ? marquerScripts(html, nonce) : html);

  let config;
  try {
    config = await loadConfig({ includeInactive: false });
  } catch (erreur) {
    console.error('Espace non mis a jour (reglages illisibles) :', erreur.message);
    return marquer(fichier);
  }

  const entete = `<title>Espace commerçant — ${texte(config.salon.name)}</title>`;
  let html = remplacerZone(fichier, 'espaceEntete', entete);

  // Le bloc des identifiants de demonstration. Sur la demonstration il est
  // ecrit ici, donc present a la premiere peinture ; ailleurs la zone est
  // videe, exactement comme `espaceLien` sur la vitrine.
  //
  // Le balisage doit rester celui de parties/espace-commercant.html — c'est la
  // meme regle que pour les prestations et les avis, sauf qu'ici il n'y a plus
  // de second endroit qui l'ecrive : le navigateur ne fait plus que lire.
  html = remplacerZone(html, 'espaceDemo', DEMO_MODE ? blocDemo() : '');

  return marquer(html);
}

/**
 * Les identifiants de la demonstration, tels qu'ils s'affichent sur l'ecran de
 * connexion de /espace-salon.
 *
 * Ils ne sont pas un secret : la demonstration existe pour qu'on entre dedans,
 * et la page les affiche en clair depuis le premier jour. Ce qui change, c'est
 * qu'ils partent maintenant AVEC la page au lieu d'arriver apres elle.
 */
function blocDemo() {
  return '<div class="connexion-demo" id="connexionDemo">'
    + '<p class="etiquette">Démonstration</p>'
    + '<dl class="fiche">'
    + `<div><dt>Identifiant</dt><dd id="demoIdentifiant">${texte(DEMO_USERNAME)}</dd></div>`
    + `<div><dt>Mot de passe</dt><dd id="demoMotDePasse">${texte(DEMO_PASSWORD)}</dd></div>`
    + '</dl>'
    + '<p class="petit secondaire">Tout est remis à zéro chaque nuit. '
    + "Vous pouvez tout essayer, rien n'est définitif.</p>"
    + '</div>';
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

/**
 * Le corps de la page « adresse introuvable ».
 *
 * >>> LE NOM ET LE TELEPHONE VIENNENT DES REGLAGES, JAMAIS ECRITS EN DUR. <<<
 * C'est la seule raison pour laquelle cette page passe par le serveur plutot
 * que d'etre un fichier statique : chez un client, elle doit porter SON nom et
 * SON numero, sans qu'on ait a y toucher.
 *
 * Le balisage est celui de parties/introuvable.html — meme regle que pour les
 * prestations et les avis : ce qui est ecrit ici et ce qui est ecrit la-bas
 * doivent rester la meme page. La difference est qu'ici il n'y a pas de
 * second peintre : ce document n'execute aucun JavaScript, le repli du fichier
 * ne sert que si les reglages sont illisibles.
 */
function corpsIntrouvable(nom, telephone) {
  const compose = String(telephone ?? '').replace(/[^\d+]/g, '');

  return [
    '<header class="annuler-entete">',
    '  <div class="annuler-largeur">',
    '    <a class="annuler-retour" href="/">',
    `      <span class="annuler-marque">${texte(nom)}</span>`,
    '      <span class="annuler-retour-mot">Retour au site</span>',
    '    </a>',
    '  </div>',
    '</header>',
    '',
    '<main id="contenu" class="annuler-corps">',
    '  <div class="annuler-largeur">',
    '    <h1>Page introuvable</h1>',
    '',
    '    <section class="annuler-ecran">',
    '      <p class="intro">',
    "        Cette adresse n'existe pas, ou n'existe plus. Le site, lui, fonctionne :",
    '        revenez à l\'accueil, ou prenez rendez-vous directement.',
    '      </p>',
    '',
    '      <div class="actions-paire">',
    '        <a class="action" href="/#reserver">Prendre rendez-vous</a>',
    '        <a class="action-douce" href="/">Retour à l\'accueil</a>',
    '      </div>',
    '',
    '      <p class="annuler-secours">',
    '        Vous cherchiez autre chose ? Appelez le',
    `        <a class="donnee" href="tel:${attr(compose)}">${texte(telephone)}</a>.`,
    '      </p>',
    '    </section>',
    '  </div>',
    '</main>',
    '',
    '<footer class="annuler-pied">',
    '  <div class="annuler-largeur">',
    `    <p><span class="donnee">${texte(nom)}</span></p>`,
    '  </div>',
    '</footer>',
  ].join('\n');
}

/**
 * La page servie quand l'adresse demandee n'existe pas (src/server.js).
 *
 * Elle existe parce qu'Express, sans elle, repond `Cannot GET /adresse` : du
 * Times New Roman, en anglais, sur fond blanc, a quelqu'un qui vient de se
 * tromper d'une lettre dans l'adresse du salon. Les adresses en /api/, elles,
 * repondaient deja proprement en JSON.
 *
 * Meme discipline que les trois autres documents : reglages illisibles, on
 * envoie le fichier tel quel. Une page d'erreur qui echouerait a s'afficher
 * serait un comble.
 */
export async function renderIntrouvable(nonce) {
  const fichier = await lireFichier('introuvable');
  const marquer = (html) => (nonce ? marquerScripts(html, nonce) : html);

  let config;
  try {
    config = await loadConfig({ includeInactive: false });
  } catch (erreur) {
    console.error('Page introuvable non mise a jour (reglages illisibles) :', erreur.message);
    return marquer(fichier);
  }

  const entete = `<title>Page introuvable — ${texte(config.salon.name)}</title>`;

  let html = remplacerZone(fichier, 'introuvableEntete', entete);
  html = remplacerZone(html, 'introuvable', corpsIntrouvable(config.salon.name, config.salon.phone));

  return marquer(html);
}
