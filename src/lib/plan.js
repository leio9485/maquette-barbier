// ---------------------------------------------------------------------------
// LE PLAN DU QUARTIER
//
// La section « Venir » n'affichait qu'une adresse en texte. Elle porte
// desormais un plan des rues alentour, aux couleurs de la charte, sur lequel un
// clic propose un itineraire dans l'application de cartes du visiteur.
//
// POURQUOI PAS UNE IFRAME GOOGLE MAPS
//
// Elle depose des cookies google.com, ce qui obligerait le site a poser un
// bandeau de consentement — or « aucun bandeau cookies, et c'est justifie » est
// un des arguments de ce site. Elle charge aussi pres d'un mega-octet de
// JavaScript tiers sur une page qui en fait 36 compresses, et demande d'ouvrir
// la politique de contenu (`frame-src`), aujourd'hui fermee a toute adresse
// exterieure. Trop cher pour un plan.
//
// POURQUOI PAS UNE CAPTURE D'ECRAN NON PLUS
//
// Une capture de Google Maps republiee en image, recoloree, sort de leurs
// conditions d'utilisation : leur imagerie ne peut etre ni modifiee ni
// redistribuee hors de leurs services. Acceptable sur une demonstration,
// inacceptable sur le site d'un vrai commercant.
//
// CE QU'ON FAIT A LA PLACE : ON DESSINE LE PLAN
//
// Deux appels, faits UNE SEULE FOIS, au moment ou l'adresse change :
//   1. Nominatim (le geocodeur d'OpenStreetMap) traduit l'adresse en
//      coordonnees. Leur politique l'autorise explicitement a ce rythme, et
//      demande de mettre le resultat en cache : c'est ce qu'on fait.
//   2. Overpass rend les rues, l'eau et les espaces verts autour du point.
//
// On en tire un SVG, ecrit dans data/photos/, et PLUS RIEN NE SORT DU SERVEUR
// ensuite : le fichier est servi comme une photo, avec son numero de version et
// son cache d'un an. Les couleurs ne sont donc pas un filtre pose sur un plan
// gris — elles SONT le plan. Il pese une quinzaine de kilo-octets, reste net sur
// un ecran a haute densite, et ne demande ni cle d'API ni compte de facturation.
//
// TROIS ETAGES, COMME LES PHOTOS : le plan engendre, sinon rien — et la page
// garde alors son degrade, toujours cliquable. Un echec de reseau ne peut donc
// pas casser l'affichage, et le plan precedent n'est jamais efface avant que le
// nouveau ne soit ecrit.
//
// ATTRIBUTION : les donnees sont sous licence ODbL. Le credit
// « © OpenStreetMap » est affiche dans le bloc de la vitrine — il est
// obligatoire, ne pas le retirer.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { PHOTOS_DIR, PUBLIC_URL, ROOT_DIR } from '../config.js';

/** Le plan engendre, et la fiche qui dit pour quelle adresse il l'a ete. */
const FICHIER_PLAN = path.join(PHOTOS_DIR, 'plan.svg');
const FICHIER_ETAT = path.join(PHOTOS_DIR, 'plan.json');

/**
 * Ce que le serveur annonce de lui-meme aux deux services.
 *
 * La politique de Nominatim EXIGE un en-tete qui identifie l'application et
 * permette de la joindre : un appelant anonyme se fait bloquer, et il a raison
 * de l'etre. `PUBLIC_URL` la complete quand elle est connue.
 */
const AGENT = `LEtabliBarbier/1.0 (site vitrine de commerce local${PUBLIC_URL ? '; +' + PUBLIC_URL : ''})`;

/** Demi-cote du plan, en metres. 500 m = on voit le quartier, pas la ville. */
const RAYON_M = 500;

/** Les proportions du fichier engendre. Le bloc de la vitrine y decoupe. */
const LARGEUR = 900;
const HAUTEUR = 500;

/**
 * Au-dela, on abandonne et on garde le plan precedent.
 *
 * Overpass repond en cinq a dix secondes en temps normal, mais c'est un service
 * public gratuit : il lui arrive d'etre lent ou indisponible. Rien de ce qui se
 * passe ici ne doit faire attendre qui que ce soit.
 */
const DELAI_MS = 30000;

// --- Les rues, et lesquelles on garde --------------------------------------

/**
 * Trois epaisseurs, et une liste FERMEE de ce qu'on dessine.
 *
 * Ce qui est ecarte l'est a dessein : les trottoirs (`footway`), les escaliers
 * et les chemins forment plus de la moitie des tracés d'un centre-ville et
 * transforment un plan lisible en pelote. Les voies de service (parkings,
 * allees de livraison) aussi. On garde ce par quoi on arrive au salon.
 */
const RUES = {
  motorway: 'majeure', trunk: 'majeure', primary: 'majeure', secondary: 'majeure',
  motorway_link: 'majeure', trunk_link: 'majeure', primary_link: 'majeure', secondary_link: 'majeure',
  tertiary: 'moyenne', tertiary_link: 'moyenne', unclassified: 'moyenne',
  residential: 'moyenne', living_street: 'moyenne', busway: 'moyenne',
  pedestrian: 'petite',
};

/** L'epaisseur et le ton de chaque famille. L'encre de la charte, degradee. */
const TRAITS = {
  majeure: { largeur: 5.5, couleur: '#16191B', opacite: 0.5 },
  moyenne: { largeur: 3, couleur: '#16191B', opacite: 0.32 },
  petite: { largeur: 1.6, couleur: '#16191B', opacite: 0.22 },
};

/**
 * Les etendues qu'on remplit : le vert d'un cote, l'eau de l'autre.
 *
 * Listes fermees, pour la meme raison que `RUES` : Overpass nous envoie toutes
 * les valeurs de `landuse` et de `leisure` du carre — dont « parking »,
 * « industrial » ou « commercial », qui recouvriraient le plan de grandes
 * taches sans rien apprendre a qui cherche son chemin.
 */
const VERT = new Set([
  'grass', 'forest', 'meadow', 'cemetery', 'orchard', 'village_green', 'recreation_ground',
  'park', 'garden', 'pitch', 'golf_course', 'playground',
]);
const COURS_D_EAU = new Set(['river', 'canal', 'stream']);

// --- Geocodage --------------------------------------------------------------

/**
 * Une reponse HTTP, ou `null` si le service n'a pas repondu.
 *
 * Le code est TRACE en cas de refus, et ce n'est pas du confort : les deux
 * services publics d'OpenStreetMap repondent 429 quand on insiste, 504 quand
 * ils sont charges, et 406 quand l'appelant ne s'identifie pas. Sans cette
 * ligne, les trois se ressemblent — « le plan n'est pas apparu » — et le motif
 * reste introuvable.
 *
 * UN SEUL NOUVEL ESSAI, apres deux secondes : Overpass rend regulierement un
 * 504 passager sous la charge, et abandonner la ferait manquer un plan pour
 * rien. Au-dela, on renonce : le plan precedent reste en place.
 */
async function joindre(url, options = {}, essaisRestants = 1) {
  try {
    const reponse = await fetch(url, { ...options, signal: AbortSignal.timeout(DELAI_MS) });
    if (reponse.ok) return reponse;

    console.error(`Plan du quartier : ${new URL(url).host} a répondu ${reponse.status}.`);
    if (essaisRestants > 0 && (reponse.status === 504 || reponse.status === 503)) {
      await new Promise((suite) => setTimeout(suite, 2000));
      return joindre(url, options, essaisRestants - 1);
    }
    return null;
  } catch (erreur) {
    console.error(`Plan du quartier : ${new URL(url).host} injoignable (${erreur.message}).`);
    return null;
  }
}

/**
 * L'adresse traduite en coordonnees, par Nominatim.
 *
 * TROIS ESSAIS, DU PLUS PRECIS AU PLUS LARGE, et c'est necessaire : une adresse
 * peut fort bien ne pas figurer dans OpenStreetMap — la rue vient d'etre batie,
 * elle est mal orthographiee, ou (cas de la demonstration) elle est inventee. On
 * retombe alors sur le code postal, puis sur la seule ville. Un plan du centre
 * vaut infiniment mieux que pas de plan du tout.
 *
 * Une seconde entre deux essais : la politique de Nominatim demande de ne pas
 * depasser une requete par seconde.
 */
async function geocoder(salon) {
  const essais = [
    [salon.street, salon.postalCode, salon.city].filter(Boolean).join(', '),
    [salon.postalCode, salon.city].filter(Boolean).join(' '),
    salon.city,
  ].filter(Boolean);

  for (const [index, requete] of essais.entries()) {
    if (index > 0) await new Promise((suite) => setTimeout(suite, 1100));

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', requete);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');

    const reponse = await joindre(url, {
      headers: { 'User-Agent': AGENT, 'Accept-Language': 'fr' },
    });
    if (!reponse) continue;

    const trouve = (await reponse.json())[0];
    if (!trouve) continue;

    return {
      lat: Number(trouve.lat),
      lon: Number(trouve.lon),
      // Ce qui a reellement ete trouve : le journal le dit, pour qu'un plan
      // centre sur la mairie plutot que sur la rue ne reste pas inexplique.
      precision: index === 0 ? 'adresse' : (index === 1 ? 'code postal' : 'ville'),
      trouve: trouve.display_name,
    };
  }

  return null;
}

// --- Les traces -------------------------------------------------------------

/**
 * Overpass est un service public gratuit, et il lui arrive d'etre sature. On
 * essaie donc plusieurs installations, dans l'ordre : c'est la facon habituelle
 * de s'en servir, et cela ne coute rien puisqu'on s'arrete a la premiere qui
 * repond.
 */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * La requete Overpass : les rues, l'eau et le vert d'un carre de 1 km.
 *
 * /!\ ON DEMANDE LES CLES ENTIERES (`way["highway"]`) ET ON TRIE ICI, plutot
 *     que de laisser Overpass filtrer sur une expression reguliere. Ce n'est pas
 *     une simplification : mesure a l'appui, la version avec expression
 *     reguliere repondait 504 a tous les coups, la version ci-dessous 200 en
 *     cinq secondes. Une cle se lit dans un index ; une expression reguliere
 *     oblige a l'evaluer sur chaque trace du carre.
 *
 *     On recoit donc 750 ko la ou 300 auraient suffi. C'est la bonne affaire :
 *     ces octets-la sont pour nous, une seule fois par demenagement, et ils
 *     evitent de faire travailler un service gratuit pour rien.
 */
function requeteOverpass(boite) {
  const b = boite.join(',');
  return '[out:json][timeout:60];('
    + `way["highway"](${b});`
    + `way["waterway"](${b});`
    + `way["natural"="water"](${b});`
    + `way["landuse"](${b});`
    + `way["leisure"](${b});`
    + ');out geom;';
}

async function traces(boite) {
  const corps = requeteOverpass(boite);

  for (const service of OVERPASS) {
    const reponse = await joindre(service, {
      method: 'POST',
      headers: { 'User-Agent': AGENT, 'Content-Type': 'text/plain' },
      body: corps,
    });
    if (!reponse) continue;

    const donnees = await reponse.json();
    if (Array.isArray(donnees.elements)) return donnees.elements;
  }

  return null;
}

// --- Du globe au dessin -----------------------------------------------------

/**
 * La projection de Mercator, celle de tous les plans de rue.
 *
 * A l'echelle d'un quartier, sa seule vertu utile est de ne pas ecraser les
 * angles : une rue perpendiculaire a une autre le reste sur le dessin. Sans
 * elle, un plan de Maubeuge serait aplati d'un tiers.
 */
function mercator(lat, lon) {
  return {
    x: lon * (Math.PI / 180),
    y: Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

/**
 * De quoi transformer un point du globe en un point du dessin.
 *
 * Le carre de 1 km est centre, puis etire a la largeur du fichier ; la hauteur
 * suit la MEME echelle, ce qui la remplit par le haut et le bas. Un plan aux
 * proportions libres deformerait les rues.
 */
function projection(centre) {
  const dLat = RAYON_M / 111320;
  const dLon = RAYON_M / (111320 * Math.cos((centre.lat * Math.PI) / 180));

  const ouest = mercator(centre.lat, centre.lon - dLon);
  const est = mercator(centre.lat, centre.lon + dLon);
  const milieu = mercator(centre.lat, centre.lon);

  const echelle = LARGEUR / (est.x - ouest.x);

  return {
    boite: [centre.lat - dLat, centre.lon - dLon, centre.lat + dLat, centre.lon + dLon]
      .map((n) => n.toFixed(6)),
    point(lat, lon) {
      const m = mercator(lat, lon);
      return {
        x: LARGEUR / 2 + (m.x - milieu.x) * echelle,
        // L'axe des y d'un dessin descend, celui d'une latitude monte.
        y: HAUTEUR / 2 - (m.y - milieu.y) * echelle,
      };
    },
  };
}

/**
 * La marge, en pixels, au-dela du cadre.
 *
 * Un trait qui passe juste dehors doit rester dessine : sans marge, une rue
 * longeant le bord se terminerait net a un pixel du cadre, et ca se voit.
 */
const MARGE = 30;

/** Le point projete, arrondi au dixieme de pixel. */
function coordonnees(p) {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
}

/**
 * Deux allegements, et ils font tout le poids du fichier.
 *
 * 1. LES POINTS TROP RAPPROCHES SONT SAUTES. La geometrie d'OpenStreetMap est
 *    bien plus fine que ce qu'un plan de 900 px peut montrer : en dessous d'un
 *    pixel de deplacement, un sommet n'apporte rien.
 * 2. LES COORDONNEES SONT ARRONDIES au dixieme de pixel.
 *
 * S'y ajoute le decoupage ci-dessous, qui compte davantage encore : Overpass
 * renvoie la geometrie ENTIERE d'un trace des lors qu'il touche le carre
 * demande. Un seul cours d'eau — la Sambre — apportait ainsi des centaines de
 * points situes a des dizaines de kilometres du salon, invisibles et pourtant
 * ecrits dans le fichier.
 */
function points(geometrie, projeter) {
  const suite = [];
  let dernier = null;

  for (const sommet of geometrie) {
    const p = projeter(sommet.lat, sommet.lon);
    if (dernier && Math.abs(p.x - dernier.x) < 1 && Math.abs(p.y - dernier.y) < 1) continue;
    suite.push(p);
    dernier = p;
  }

  return suite;
}

function dansLeCadre(p) {
  return p.x > -MARGE && p.x < LARGEUR + MARGE && p.y > -MARGE && p.y < HAUTEUR + MARGE;
}

/**
 * Une ligne (rue, cours d'eau) devenue un trace SVG, decoupee au cadre.
 *
 * Un point est garde s'il est dans le cadre ou s'il touche un point qui y est —
 * de cette facon, la ligne rejoint bien le bord au lieu de s'arreter au dernier
 * sommet visible. Ce qui reste dehors est jete, et une ligne qui sort puis
 * revient donne plusieurs morceaux dans le meme `<path>` (un `M` par morceau).
 *
 * Renvoie `null` quand rien n'est visible.
 */
function traceLigne(geometrie, projeter) {
  const suite = points(geometrie, projeter);
  const dedans = suite.map(dansLeCadre);

  const morceaux = [];
  let courant = [];

  for (let i = 0; i < suite.length; i++) {
    if (dedans[i] || dedans[i - 1] || dedans[i + 1]) {
      courant.push(coordonnees(suite[i]));
      continue;
    }
    if (courant.length >= 2) morceaux.push('M' + courant.join('L'));
    courant = [];
  }
  if (courant.length >= 2) morceaux.push('M' + courant.join('L'));

  return morceaux.length ? morceaux.join('') : null;
}

/**
 * Une etendue (parc, plan d'eau) devenue un contour ferme.
 *
 * Ici on ne decoupe pas, on RAMENE les points au bord du cadre : un contour
 * ferme dont on retirerait des sommets changerait de forme, alors qu'un sommet
 * ramene au bord recouvre exactement la meme surface visible. C'est la
 * difference avec une ligne, et elle a son importance sur une foret qui deborde
 * de trois cotes.
 */
function traceSurface(geometrie, projeter) {
  const borne = (v, maxi) => Math.min(Math.max(v, -MARGE), maxi + MARGE);

  const suite = points(geometrie, projeter)
    .map((p) => ({ x: borne(p.x, LARGEUR), y: borne(p.y, HAUTEUR) }));

  // Entierement ramenee sur un seul bord : la surface est hors du cadre, elle
  // n'a plus d'aire et n'apporte rien.
  const visible = suite.some((p) => p.x > 0 && p.x < LARGEUR && p.y > 0 && p.y < HAUTEUR);
  if (suite.length < 3 || !visible) return null;

  return 'M' + suite.map(coordonnees).join('L') + 'Z';
}

// --- Le dessin --------------------------------------------------------------

/**
 * Le plan, en SVG, a partir de traces deja recuperes.
 *
 * Rien de ce qui depend des reglages n'y figure — ni le nom du salon, ni
 * l'epingle : ils sont poses par-dessus, en HTML, par la page. Le fichier reste
 * donc valable quand le commerce change de nom, et la page peut les traduire ou
 * les restyler sans qu'on ait a redessiner quoi que ce soit.
 *
 * EXPORTEE A PART DE `engendrerPlan()` pour une raison pratique : elle permet
 * d'eprouver le dessin sans toucher au reseau. Overpass est un service public
 * gratuit et regulierement sature — un test qui en dependrait echouerait un jour
 * sur deux, pour une raison etrangere au code.
 */
export function dessinerPlan(elements, centre) {
  return dessiner(elements, projection(centre).point);
}

function dessiner(elements, projeter) {
  const surfaces = [];
  const rues = { majeure: [], moyenne: [], petite: [] };
  const eau = [];

  // C'est ici qu'on trie, Overpass nous ayant tout envoye (voir
  // `requeteOverpass`). L'ordre des tests compte : une allee de parc porte a la
  // fois `highway` et se trouve dans un `leisure`, et c'est une rue.
  for (const element of elements) {
    if (!Array.isArray(element.geometry)) continue;
    const tags = element.tags ?? {};

    const famille = tags.highway ? RUES[tags.highway] : null;
    const estEau = tags.natural === 'water' || COURS_D_EAU.has(tags.waterway);
    const estVert = VERT.has(tags.landuse) || VERT.has(tags.leisure);
    if (!famille && !estEau && !estVert) continue;

    // Un cours d'eau est une ligne, un plan d'eau et un parc des contours
    // fermes : les seconds se remplissent, les premiers se tracent.
    const ligne = famille || tags.waterway;
    const d = ligne
      ? traceLigne(element.geometry, projeter)
      : traceSurface(element.geometry, projeter);
    if (!d) continue;

    if (famille) rues[famille].push(d);
    else if (tags.waterway) eau.push(d);
    else surfaces.push({ d, eau: estEau });
  }

  const groupe = (traces, attributs) => (traces.length
    ? `<g ${attributs}>${traces.map((d) => `<path d="${d}"/>`).join('')}</g>`
    : '');

  return '<svg xmlns="http://www.w3.org/2000/svg" '
    + `viewBox="0 0 ${LARGEUR} ${HAUTEUR}" width="${LARGEUR}" height="${HAUTEUR}" `
    + 'role="img" aria-label="Plan du quartier">'
    // LA CRAIE DE LA CHARTE, comme fond de page.
    //
    // Le plan emploie les couleurs du site, et rien d'autre : c'est la seule
    // facon qu'il ait de ne pas ressembler a une carte importee posee au milieu
    // de la page. Encre pour le bati, bleu de travail pour l'eau — pas de vert
    // pour les parcs, pas de bleu ciel pour les rivieres : la palette compte
    // cinq valeurs, un plan n'a pas le droit d'en inventer une sixieme.
    + `<rect width="${LARGEUR}" height="${HAUTEUR}" fill="#EFEEEA"/>`
    // Les surfaces d'abord : les rues passent par-dessus, comme sur un vrai plan.
    + groupe(surfaces.filter((s) => !s.eau).map((s) => s.d),
      'fill="#16191B" fill-opacity="0.055" stroke="none"')
    + groupe(surfaces.filter((s) => s.eau).map((s) => s.d),
      'fill="#24405C" fill-opacity="0.28" stroke="none"')
    + groupe(eau, 'fill="none" stroke="#24405C" stroke-width="3" stroke-opacity="0.45"')
    + ['petite', 'moyenne', 'majeure'].map((famille) => {
      const t = TRAITS[famille];
      return groupe(rues[famille], `fill="none" stroke="${t.couleur}" `
        + `stroke-width="${t.largeur}" stroke-opacity="${t.opacite}" `
        + 'stroke-linecap="round" stroke-linejoin="round"');
    }).join('')
    + '</svg>';
}

// --- Le fichier -------------------------------------------------------------

/** L'etat d'un plan : pour quelle adresse il a ete dessine, et quand. */
async function etatEnregistre(chemin = FICHIER_ETAT) {
  try {
    const brut = JSON.parse(await readFile(chemin, 'utf8'));
    return brut && typeof brut === 'object' ? brut : null;
  } catch {
    return null;
  }
}

/** L'adresse ramenee a une chaine comparable — c'est elle qui dit « a refaire ». */
function repere(salon) {
  return [salon.street, salon.postalCode, salon.city]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .join('|');
}

/** Ecriture en fichier temporaire puis renommage, comme pour les photos. */
async function ecrire(chemin, contenu) {
  const provisoire = `${chemin}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(provisoire, contenu, 'utf8');
    await rename(provisoire, chemin);
  } catch (erreur) {
    await unlink(provisoire).catch(() => {});
    throw erreur;
  }
}

/**
 * LE PLAN LIVRE AVEC LE SITE, deuxieme etage.
 *
 * Il n'existe que pour la demonstration, et pour une raison precise :
 * l'hebergement gratuit n'a pas de disque persistant, si bien que le plan
 * dessine disparait a chaque reveil du service. Il faut alors le redessiner, et
 * Overpass ne repond pas toujours — la vitrine qui sert a vendre se retrouvait
 * sans carte.
 *
 * A remplacer ou a supprimer pour un vrai client, comme le reste de
 * public/photos/. Le laisser ne casse rien : voir la regle ci-dessous.
 */
const PLAN_LIVRE = path.join(ROOT_DIR, 'public', 'photos', 'plan.svg');
const ETAT_LIVRE = path.join(ROOT_DIR, 'public', 'photos', 'plan.json');

/**
 * Le plan a servir pour cette adresse : le dessine, le livre, ou rien.
 *
 * /!\ UN PLAN N'EST SERVI QUE S'IL A ETE DESSINE POUR L'ADRESSE ACTUELLE, et la
 *     regle vaut pour LES DEUX etages. C'est la seule difference de fond avec
 *     `trouverPhoto()`, et elle est essentielle : une photo de galerie livree
 *     qui ne montre pas le salon est seulement generique, tandis qu'un plan
 *     d'une autre ville sous l'adresse d'un commerce est FAUX. Il affirme
 *     quelque chose, epingle a l'appui.
 *
 * Deux consequences a ne pas defaire :
 *   - le plan livre (Maubeuge) ne s'affiche JAMAIS chez un client d'ailleurs :
 *     son repere ne correspond pas, on retombe sur le degrade ;
 *   - apres un demenagement, tant que le nouveau plan n'est pas dessine, on
 *     n'affiche RIEN plutot que l'ancien quartier. Le fichier reste sur le
 *     disque — revenir a l'ancienne adresse le rend valable de nouveau — mais
 *     il n'est pas servi.
 *
 * Exportee pour etre eprouvee sans reseau, comme `dessinerPlan()`.
 */
export async function trouverPlan(salon) {
  const attendu = repere(salon);

  for (const [svg, json, source] of [
    [FICHIER_PLAN, FICHIER_ETAT, 'dessine'],
    [PLAN_LIVRE, ETAT_LIVRE, 'livre'],
  ]) {
    const etat = await etatEnregistre(json);
    if (etat?.repere !== attendu) continue;

    try {
      const infos = await stat(svg);
      if (infos.isFile()) return { chemin: svg, source, mtime: infos.mtimeMs };
    } catch { /* fichier absent : on passe a l'etage suivant */ }
  }

  return null;
}

/**
 * Ce que le site doit savoir du plan : son adresse, ou rien.
 *
 * Meme forme que `listerPhotos()`, numero de version compris — c'est lui qui
 * autorise le cache d'un an tout en remplacant le plan le jour ou le commerce
 * demenage.
 */
export async function listerPlan(salon) {
  const plan = await trouverPlan(salon);
  if (!plan) return null;
  return { url: `/plan.svg?v=${Math.round(plan.mtime)}`, source: plan.source };
}

/** Le contenu du plan, pour la route qui le sert. */
export async function lirePlan(salon) {
  const plan = await trouverPlan(salon);
  if (!plan) return null;
  return { contenu: await readFile(plan.chemin, 'utf8'), mtime: plan.mtime };
}

/**
 * Dessine le plan de cette adresse, si besoin.
 *
 * `force` refait le travail meme quand l'adresse n'a pas bouge (le bouton des
 * reglages). Sans lui, on ne redessine que si l'adresse a change ou si aucun
 * plan n'existe : deux appels aux services publics d'OpenStreetMap par
 * demenagement, pas davantage.
 *
 * NE LEVE JAMAIS, et n'efface jamais le plan precedent avant d'en avoir un
 * nouveau : un service indisponible laisse le site exactement comme il etait.
 */
export async function engendrerPlan(salon, { force = false } = {}) {
  const attendu = repere(salon);

  // On ne se satisfait QUE d'un plan dessine pour cette adresse-ci : le plan
  // livre, lui, ne dispense pas de dessiner le vrai. Chez un commerce de
  // Maubeuge — la demonstration — il correspond pourtant, et redessiner reste
  // utile : le plan livre vieillit, celui d'OpenStreetMap non.
  const dessine = await etatEnregistre();
  if (!force && dessine?.repere === attendu) {
    try {
      if ((await stat(FICHIER_PLAN)).isFile()) return { ok: true, inchange: true };
    } catch { /* la fiche est la, le dessin non : on redessine */ }
  }

  try {
    const centre = await geocoder(salon);
    if (!centre) {
      console.error('Plan du quartier : adresse introuvable, le plan precedent est conserve.');
      return { ok: false, erreur: "Cette adresse n'a pas été trouvée sur la carte." };
    }

    const projeter = projection(centre);
    const elements = await traces(projeter.boite);
    if (!elements) {
      console.error('Plan du quartier : service de cartographie indisponible.');
      return { ok: false, erreur: 'Le service de cartographie n\'a pas répondu. Réessayez plus tard.' };
    }

    const svg = dessiner(elements, projeter.point);

    await mkdir(PHOTOS_DIR, { recursive: true });
    // Le plan d'abord, sa fiche ensuite : si l'ecriture s'arrete entre les deux,
    // l'etat manquant fait simplement recommencer au prochain demarrage.
    await ecrire(FICHIER_PLAN, svg);
    await ecrire(FICHIER_ETAT, JSON.stringify({
      repere: attendu,
      lat: centre.lat,
      lon: centre.lon,
      precision: centre.precision,
      trouve: centre.trouve,
      genereLe: new Date().toISOString(),
      octets: Buffer.byteLength(svg),
    }, null, 2));

    console.log(`Plan du quartier redessine (${Math.round(Buffer.byteLength(svg) / 1024)} ko, `
      + `precision : ${centre.precision}).`);
    return { ok: true, precision: centre.precision, octets: Buffer.byteLength(svg) };
  } catch (erreur) {
    console.error('Plan du quartier : echec, le plan precedent est conserve.', erreur.message);
    return { ok: false, erreur: 'Le plan n\'a pas pu être dessiné.' };
  }
}

/**
 * Delai minimum entre deux dessins AUTOMATIQUES, et l'instant du dernier essai.
 *
 * Nominatim et Overpass sont des services publics gratuits. Le dessin ne part
 * deja que si l'adresse a change, ce qui le rend rare en usage normal — mais
 * rien n'empechait une rafale : la suite de tests modifie l'adresse plusieurs
 * fois par execution, et chacune declenchait deux appels reels. Un `npm test`
 * lance dix fois dans la journee, et l'on abuse d'un bien commun sans le
 * vouloir.
 *
 * En memoire, et c'est suffisant : ce qu'on veut arreter, ce sont les rafales
 * d'un meme processus. Un redemarrage remet le compteur a zero, ce qui est le
 * comportement voulu — sur un hebergement sans disque persistant, le premier
 * demarrage doit pouvoir dessiner.
 *
 * Le bouton « Redessiner le plan » passe outre (`force`) : c'est un geste
 * humain, delibere, et il attend sa reponse.
 */
const DELAI_ENTRE_DESSINS_MS = 5 * 60 * 1000;
let dernierEssai = 0;

/**
 * Lance le dessin sans faire attendre l'appelant.
 *
 * Appele apres un enregistrement des reglages et au demarrage. Le geocodage et
 * la recuperation des rues prennent une dizaine de secondes : les attendre
 * ferait patienter le commercant qui vient de corriger son numero de telephone,
 * pour un plan qu'il ne regarde pas a cet instant. Le fichier est remplace d'un
 * coup quand il est pret (renommage), donc personne ne voit d'etat intermediaire.
 */
export function planifierPlan(salon) {
  const depuis = Date.now() - dernierEssai;
  if (depuis < DELAI_ENTRE_DESSINS_MS) {
    console.log(`Plan du quartier : dessin differe (dernier essai il y a `
      + `${Math.round(depuis / 1000)} s). Il se refera au prochain changement.`);
    return;
  }
  dernierEssai = Date.now();

  engendrerPlan(salon).catch(() => {});
}
