// ---------------------------------------------------------------------------
// LES PHOTOS DE LA VITRINE
//
// Le visuel d'accueil et les quatre cases de la galerie. Le commercant les
// depose lui-meme depuis son espace, sans repasser par nous.
//
// POURQUOI PAS COMME LES PHOTOS DE L'EQUIPE ?
//
// Celles de l'equipe sont ecrites dans la base, en texte, avec le reste des
// reglages : une pastille ronde de 76 pixels pese une vingtaine de kilo-octets,
// on peut se le permettre. Une photo de galerie en pese dix fois plus. Les cinq
// images ajouteraient environ 500 ko A CHAQUE CHARGEMENT de la page, sans que
// le navigateur puisse les garder en cache — elles voyageraient dans la reponse
// des reglages, qui change tout le temps. D'ou le passage par des fichiers :
// le navigateur les met en cache, les charge en parallele, et la reponse des
// reglages reste legere.
//
// TROIS ETAGES, DU PLUS FORT AU PLUS FAIBLE
//
//   1. la photo DEPOSEE par le commercant       data/photos/<emplacement>.jpg
//   2. sinon, la photo LIVREE avec le site      public/photos/<emplacement>.jpg
//   3. sinon, rien : la page garde ses degrades
//
// Rien ne peut donc casser l'affichage, et "retirer ma photo" ne laisse pas un
// trou : on retombe simplement sur celle qui etait livree.
//
// L'ENVOI se fait par le meme tuyau JSON que le reste du site (une "data:URL",
// exactement comme les photos d'equipe) : pas de brique supplementaire a
// installer pour recevoir des fichiers. Le serveur decode et ecrit lui-meme.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { ROOT_DIR, PHOTOS_DIR } from '../config.js';

/**
 * Les emplacements, et eux seuls.
 *
 * Liste fermee, pour deux raisons : la page sait exactement quoi afficher et
 * ou, et un nom recu du reseau ne peut jamais designer un fichier ailleurs sur
 * le disque (« ../../.env » n'est pas dans cette liste, donc il est refuse).
 * Chaque entree porte aussi les dimensions attendues, dont se sert le
 * navigateur pour reduire la photo avant de l'envoyer.
 */
/** Combien de cases la galerie peut porter au maximum. */
export const GALERIE_MAX = 12;

export const EMPLACEMENTS = {
  hero: {
    titre: "Photo d'accueil",
    format: 'Paysage',
    // `null` = cet emplacement n'affiche pas de legende. C'est le cas du visuel
    // d'accueil, qui occupe toute la largeur et ne porte aucun texte.
    legende: null,
    // LA DESCRIPTION LUE A VOIX HAUTE (l'attribut `alt`), qui n'est PAS la
    // legende. Les cinq photos du site avaient `alt=""`, c'est-a-dire « cette
    // image n'apporte rien » — ce qui est faux pour la devanture d'un commerce.
    //
    // ⚠️ ELLE DECRIT L'IMAGE, ELLE NE REPETE PAS LA LEGENDE. « La devanture »
    //    sous la photo et « La devanture » dans l'attribut, c'est la meme
    //    information dite deux fois : quelqu'un qui n'a pas l'image entend deux
    //    fois trois mots et n'apprend rien.
    //
    // Volontairement GENERIQUE et sans nom de commerce : ce fichier sert toutes
    // les instances. Le commercant ecrit la sienne depuis les reglages, et
    // c'est elle qui l'emporte alors.
    alt: "Un client dans le fauteuil du barbier, pendant une coupe aux ciseaux.",
    // Un 16:9, recadre a l'affichage : tres large sur grand ecran, presque
    // carre sur telephone (voir `object-fit: cover` dans 08-accueil.css). Le
    // sujet doit donc etre au centre — c'est ecrit dans public/photos/LISEZ-MOI.md.
    largeur: 1200,
    hauteur: 675,
  },
  // La galerie est en portrait 3:4 : c'est le cadrage d'une personne assise au
  // fauteuil et d'une main au travail, les deux sujets de ce commerce.
  ...galerie(),
};

/**
 * Les douze cases de la galerie, et leur seconde photo « après ».
 *
 * >>> QUATRE, C'ETAIT TROP PEU POUR UN BARBIER. <<< Quatre photos, c'est ce
 * qu'on montre quand on ouvre ; un commerce qui tourne depuis deux ans en a
 * trente, et n'a aucune raison d'en cacher vingt-six. La grille s'adapte au
 * nombre reellement depose (voir styles/11-galerie.css) : trois, quatre, huit
 * ou douze tiennent sans qu'on y touche.
 *
 * LES TROIS PREMIERES SONT LIVREES avec le site et portent une legende ; les
 * neuf suivantes arrivent vides et n'apparaissent que si le commercant y met
 * quelque chose. C'est ce qui evite qu'une nouvelle instance affiche neuf
 * rectangles gris.
 *
 * >>> ELLES ETAIENT QUATRE. LA PREMIERE A ETE RETIREE. <<< C'etait un interieur
 * de grand salon americain : enseigne BARBERSHOP en lettres d'un metre, panier
 * de basket, planches de skate, panneau « SORRY WE'RE CLOSED ». Elle etait
 * legendee « La devanture » alors qu'elle montrait un interieur, et elle
 * contredisait frontalement la direction du site — le monde de reference est
 * l'atelier d'artisan, pas le barbershop (voir CLAUDE.md). Aucune photo de
 * remplacement n'etant disponible dans le depot, la galerie en montre trois :
 * mieux vaut trois photos justes qu'une quatrieme qui vend un autre commerce.
 *
 * LA SECONDE PHOTO (« -apres ») est facultative et ne s'affiche jamais seule :
 * sans la premiere, la case n'existe pas. C'est ce qui rend le mode
 * avant/apres indolore — un commerce qui n'en veut pas ne rencontre jamais la
 * notion.
 */
function galerie() {
  const livrees = [
    ['Le poste', "Un fauteuil de barbier en cuir et chrome, devant le miroir du poste."],
    ['La coupe', "Les mains du barbier dégradant une nuque à la tondeuse et au peigne."],
    ['La barbe', "Une barbe taillée aux ciseaux, le client allongé sous la serviette."],
  ];

  const cases = {};

  for (let n = 1; n <= GALERIE_MAX; n++) {
    const [legende, alt] = livrees[n - 1] ?? ['', ''];

    cases[`galerie-${n}`] = {
      titre: `Galerie ${n}`,
      format: 'Portrait',
      legende,
      alt: alt || `Photo ${n} de la galerie du salon.`,
      largeur: 700,
      hauteur: 933,
    };

    // La seconde photo d'un avant/apres. Pas de legende propre : c'est celle de
    // la case qui legende les deux, sans quoi on lirait deux titres sous une
    // seule idee.
    cases[`galerie-${n}-apres`] = {
      titre: `Galerie ${n} — après`,
      format: 'Portrait',
      legende: null,
      alt: `Le résultat, après la prestation (photo ${n}).`,
      largeur: 700,
      hauteur: 933,
      apres: true,
    };
  }

  return cases;
}

/**
 * Les legendes de la galerie, ecrites par le commercant.
 *
 * MEME LOGIQUE A TROIS ETAGES QUE LES PHOTOS : la legende saisie l'emporte, a
 * defaut celle livree avec le site, et une legende volontairement videe
 * n'affiche rien. C'etait auparavant du texte ecrit en dur dans le HTML — un
 * salon qui remplacait la photo « La coupe » par une photo de son bac se
 * retrouvait avec une legende qui mentait.
 *
 * Elles vivent A COTE DES PHOTOS, dans data/photos/, et non dans la base : ce
 * sont les photos qu'elles decrivent, elles se sauvegardent avec elles, et
 * "sauvegarder un client = copier data/" reste vrai.
 */
const FICHIER_LEGENDES = path.join(PHOTOS_DIR, 'legendes.json');

/** Une legende tient sur une ligne, sous une vignette : inutile d'en accepter plus. */
const LEGENDE_MAX = 60;

/** Les emplacements qui portent une legende (ceux de la galerie). */
function emplacementLegendable(nom) {
  return emplacementConnu(nom) && EMPLACEMENTS[nom].legende !== null;
}

/**
 * Une description tient en une phrase : c'est ce que lit un lecteur d'ecran
 * a la place de l'image, et une phrase interminable y est pire que courte.
 */
const DESCRIPTION_MAX = 160;

/**
 * Ce qui est reellement enregistre sur le disque, ou {} si rien.
 *
 * ⚠️ DEUX FORMATS SE LISENT ICI, et le premier ne disparaitra pas de sitot.
 *    Le fichier ne contenait qu'une legende par emplacement, en texte brut :
 *
 *        { "galerie-1": "Notre bac" }
 *
 *    Il porte desormais aussi la description lue a voix haute :
 *
 *        { "galerie-1": { "legende": "Notre bac", "alt": "Un bac …" } }
 *
 *    Une instance deja en ligne a le premier format sur son disque. On le lit
 *    donc tel quel et on le convertit en memoire : personne n'a de migration a
 *    lancer, et rien ne se perd au premier enregistrement.
 */
async function textesEnregistres() {
  let brut;
  try {
    brut = JSON.parse(await readFile(FICHIER_LEGENDES, 'utf8'));
  } catch {
    // Fichier absent (le cas normal) ou illisible : on retombe sur les textes
    // livres. Une legende ne vaut pas de faire echouer l'affichage du site.
    return {};
  }

  if (!brut || typeof brut !== 'object') return {};

  const sortie = {};
  for (const [nom, valeur] of Object.entries(brut)) {
    if (typeof valeur === 'string') sortie[nom] = { legende: valeur };
    else if (valeur && typeof valeur === 'object') sortie[nom] = valeur;
  }
  return sortie;
}

/** La legende de chaque emplacement de galerie, saisie ou livree. */
export async function listerLegendes() {
  const sortie = {};
  for (const [nom, e] of Object.entries(EMPLACEMENTS)) {
    if (e.legende !== null) sortie[nom] = e.legende;
  }

  const saisies = await textesEnregistres();
  for (const [nom, valeur] of Object.entries(saisies)) {
    if (emplacementLegendable(nom) && typeof valeur.legende === 'string') {
      sortie[nom] = valeur.legende.slice(0, LEGENDE_MAX);
    }
  }

  return sortie;
}

/**
 * La description de chaque photo — l'attribut `alt`.
 *
 * TOUS les emplacements en ont une, le visuel d'accueil compris : lui n'a pas
 * de legende, mais c'est la plus grande image du site et la premiere que
 * rencontre quelqu'un qui l'ecoute.
 *
 * ⚠️ UNE DESCRIPTION N'EST JAMAIS VIDE ICI. La chaine vide saisie par le
 *    commercant retombe sur celle livree, contrairement a la legende ou le vide
 *    veut dire « pas de legende ». La raison : `alt=""` a un sens precis en
 *    HTML — « cette image est purement decorative, ne l'annonce pas » — et ce
 *    n'est vrai d'aucune photo de ce site. Laisser un champ vide effacer la
 *    description reviendrait a rendre le site moins accessible d'un coup de
 *    touche « suppr ».
 */
export async function listerDescriptions() {
  const sortie = {};
  for (const [nom, e] of Object.entries(EMPLACEMENTS)) {
    sortie[nom] = e.alt ?? '';
  }

  const saisies = await textesEnregistres();
  for (const [nom, valeur] of Object.entries(saisies)) {
    const propre = typeof valeur.alt === 'string' ? valeur.alt.trim() : '';
    if (emplacementConnu(nom) && propre) sortie[nom] = propre.slice(0, DESCRIPTION_MAX);
  }

  return sortie;
}

/**
 * Enregistre une legende. La chaine vide est une valeur valable : elle signifie
 * « pas de legende sur cette photo », et se distingue de l'absence de reglage,
 * qui rend celle livree avec le site.
 */
export async function ecrireLegende(emplacement, texte) {
  if (!emplacementLegendable(emplacement)) {
    return { erreur: 'Emplacement inconnu, ou sans légende.' };
  }
  if (typeof texte !== 'string') return { erreur: 'Légende attendue.' };

  return ecrireTexte(emplacement, { legende: texte.trim().slice(0, LEGENDE_MAX) });
}

/**
 * Enregistre la description lue a voix haute d'une photo.
 *
 * TOUS les emplacements l'acceptent, y compris le visuel d'accueil : il n'a pas
 * de legende, mais il a besoin d'un `alt` plus que les autres.
 */
export async function ecrireDescription(emplacement, texte) {
  if (!emplacementConnu(emplacement)) return { erreur: 'Emplacement inconnu.' };
  if (typeof texte !== 'string') return { erreur: 'Description attendue.' };

  return ecrireTexte(emplacement, { alt: texte.trim().slice(0, DESCRIPTION_MAX) });
}

/**
 * Ecrit un ou plusieurs champs de texte d'un emplacement, les autres conserves.
 *
 * Un seul point d'ecriture pour les deux : sans lui, enregistrer une legende
 * effacerait la description saisie a cote — le genre de perte qu'on ne
 * remarque qu'en relisant son site des semaines plus tard.
 */
async function ecrireTexte(emplacement, champs) {
  const saisies = await textesEnregistres();
  saisies[emplacement] = { ...(saisies[emplacement] ?? {}), ...champs };

  await mkdir(PHOTOS_DIR, { recursive: true });

  // Meme precaution que pour les images : fichier temporaire puis renommage,
  // sinon une lecture tombant au mauvais moment trouverait un JSON tronque.
  const provisoire = `${FICHIER_LEGENDES}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(provisoire, JSON.stringify(saisies, null, 2), 'utf8');
    await rename(provisoire, FICHIER_LEGENDES);
  } catch (erreur) {
    await unlink(provisoire).catch(() => {});
    throw erreur;
  }

  return { ok: true };
}

/** Le dossier des photos livrees avec le site (celles du depart). */
const DOSSIER_LIVRE = path.join(ROOT_DIR, 'public', 'photos');

// ---------------------------------------------------------------------------
// LES VARIANTES — largeurs reduites et WebP (lot C, point C2)
//
// >>> AUCUNE IMAGE N'AVAIT DE `srcset`, NI DE VARIANTE MODERNE. <<< Le heros
// est un JPEG de 1200 px servi tel quel a un telephone de 390 : l'ecran en
// affiche moins du tiers, et le visiteur en telecharge la totalite.
//
// LA CONTRAINTE QUI FACONNE TOUT CE QUI SUIT : ce projet n'a AUCUNE dependance
// de traitement d'image (les quatre du projet sont Express et Prisma), et pas
// d'etape de build. Redimensionner et encoder en WebP cote serveur demanderait
// d'en ajouter une — refuse sans validation. La reduction se fait donc DANS LE
// NAVIGATEUR, exactement comme le fait deja `reduireImage()` avant l'envoi
// (js/08-reglages.js) : celui qui depose une photo produit lui-meme, en plus
// du fichier plein format, une ou deux largeurs reduites et leurs equivalents
// WebP, et les envoie tous ensemble. Le serveur ne fait que les ranger et les
// servir — voir `deposerPhoto()` plus bas.
//
// Les QUATRE PHOTOS LIVREES avec le site (public/photos/) portent leurs
// variantes toutes generees d'avance, par le meme procede (un navigateur, pas
// un serveur) : voir public/photos/LISEZ-MOI.md.
// ---------------------------------------------------------------------------

/**
 * Les largeurs reduites proposees pour un emplacement, EN PLUS de la largeur
 * pleine (celle du fichier principal, sans suffixe).
 *
 * Le visuel d'accueil est affiche beaucoup plus grand a l'ecran qu'une
 * vignette de galerie (il occupe une colonne entiere a partir de 1000 px) :
 * il justifie une largeur intermediaire de plus.
 */
function largeursReduites(emplacement) {
  return emplacement === 'hero' ? [400, 800] : [350];
}

/**
 * Le hint `sizes` d'un emplacement — la largeur d'AFFICHAGE attendue, pas la
 * largeur du fichier. Ecrit ici et une seule fois : la page (rendue par le
 * serveur) et le JavaScript (qui repeint apres coup) lisent tous deux
 * `photo.sizes` plutot que de deviner chacun le meme reglage CSS.
 *
 * Des approximations, assumees : le heros passe de 100 % de la largeur a une
 * demi-colonne a partir de 1000 px (08-accueil.css) ; une vignette de galerie
 * grandit avec le nombre de colonnes que la grille `auto-fit` retient, ce qui
 * depend du nombre de photos deposees et ne se resout qu'a l'affichage. Une
 * `sizes` imprecise ne casse rien : au pire, le navigateur choisit une image
 * un cran plus grande que necessaire.
 */
const SIZES = {
  hero: '(min-width: 1000px) 50vw, 100vw',
  galerie: '(min-width: 560px) 30vw, 45vw',
};

function sizesDe(emplacement) {
  return emplacement === 'hero' ? SIZES.hero : SIZES.galerie;
}

/** Le nom de fichier d'une variante : `hero-800.jpg`, `hero.webp` (pleine largeur). */
function nomVariante(emplacement, largeur, format) {
  return `${emplacement}${largeur ? `-${largeur}` : ''}.${format}`;
}

/**
 * Toutes les variantes qu'un emplacement PEUT porter : chaque largeur reduite
 * en JPEG et en WebP, plus la largeur pleine en WebP (le fichier principal
 * couvre deja la largeur pleine en JPEG).
 */
function variantesPossibles(emplacement) {
  const sortie = [];
  for (const largeur of largeursReduites(emplacement)) {
    sortie.push({ largeur, format: 'jpg' });
    sortie.push({ largeur, format: 'webp' });
  }
  sortie.push({ largeur: null, format: 'webp' });
  return sortie;
}

/** Le fichier d'une variante dans UN etage donne (jamais les deux melanges). */
async function trouverFichierVariante(emplacement, tier, largeur, format) {
  const dossier = tier === 'deposee' ? PHOTOS_DIR : DOSSIER_LIVRE;
  const chemin = path.join(dossier, nomVariante(emplacement, largeur, format));
  const s = await infos(chemin);
  return s ? { chemin, mtime: s.mtimeMs } : null;
}

/**
 * Meme garde-fous que pour les photos d'equipe (voir src/lib/settings.js), avec
 * une limite plus haute : ces images-ci s'affichent en grand.
 *
 * 400 000 caracteres ~ 300 ko. Le navigateur en produit environ 100 ko ; la
 * marge laisse passer une photo tres detaillee sans laisser passer un fichier
 * brut sorti d'un appareil.
 */
const MAX_CARACTERES = 400000;
const FORMAT = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Vrai si cet emplacement existe. Tout le reste est refuse. */
export function emplacementConnu(nom) {
  return Object.prototype.hasOwnProperty.call(EMPLACEMENTS, nom);
}

/** Le fichier depose pour cet emplacement (qu'il existe ou non). */
function cheminDepose(emplacement) {
  return path.join(PHOTOS_DIR, `${emplacement}.jpg`);
}

/** Le fichier livre avec le site (qu'il existe ou non). */
function cheminLivre(emplacement) {
  return path.join(DOSSIER_LIVRE, `${emplacement}.jpg`);
}

/** Les informations d'un fichier, ou null s'il n'existe pas. */
async function infos(chemin) {
  try {
    const s = await stat(chemin);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Le fichier a servir pour cet emplacement : le depose s'il existe, le livre
 * sinon, et `null` si aucun des deux.
 *
 * C'est la seule fonction qui connaisse l'ordre des trois etages ; la route qui
 * sert les photos et celle qui les liste s'appuient toutes deux dessus.
 */
export async function trouverPhoto(emplacement) {
  if (!emplacementConnu(emplacement)) return null;

  const depose = cheminDepose(emplacement);
  const infosDepose = await infos(depose);
  if (infosDepose) return { chemin: depose, source: 'deposee', mtime: infosDepose.mtimeMs };

  const livre = cheminLivre(emplacement);
  const infosLivre = await infos(livre);
  if (infosLivre) return { chemin: livre, source: 'livree', mtime: infosLivre.mtimeMs };

  return null;
}

/**
 * Ce que le site doit savoir : pour chaque emplacement pourvu, son adresse et
 * d'ou elle vient. Un emplacement absent de cet objet n'a pas de photo, et la
 * page garde son degrade.
 *
 * L'adresse porte un numero de version (la date du fichier) : il permet de
 * demander au navigateur de garder l'image pour toujours, tout en la
 * remplacant immediatement le jour ou le commercant en depose une autre.
 *
 * `srcsetJpg` / `srcsetWebp` / `sizes` — QUAND DES VARIANTES EXISTENT
 * REELLEMENT SUR LE DISQUE, jamais devinees. Un emplacement livre sans
 * variantes (une instance dont les photos n'ont pas encore ete regenerees) ou
 * deposee par un navigateur incapable d'encoder du WebP n'a que `url` : la
 * page retombe alors sur un simple `<img src>`, exactement comme avant ce lot.
 * `srcsetJpg` REPREND `url` A LA LARGEUR PLEINE — un `srcset` sans son plus
 * grand palier choisirait toujours une image trop petite sur un ecran large.
 */
export async function listerPhotos() {
  const sortie = {};

  await Promise.all(Object.keys(EMPLACEMENTS).map(async (emplacement) => {
    const photo = await trouverPhoto(emplacement);
    if (!photo) return;

    const largeurPleine = EMPLACEMENTS[emplacement].largeur;
    const url = `/photos/${emplacement}.jpg?v=${Math.round(photo.mtime)}`;
    const entree = { url, source: photo.source };

    const variantesTrouvees = await Promise.all(variantesPossibles(emplacement).map(async ({ largeur, format }) => {
      const fichier = await trouverFichierVariante(emplacement, photo.source, largeur, format);
      if (!fichier) return null;
      return {
        largeur: largeur ?? largeurPleine,
        format,
        url: `/photos/${nomVariante(emplacement, largeur, format)}?v=${Math.round(fichier.mtime)}`,
      };
    }));

    const versSrcset = (liste) => liste.map((v) => `${v.url} ${v.largeur}w`).join(', ');

    const jpgReduits = variantesTrouvees.filter((v) => v?.format === 'jpg');
    if (jpgReduits.length) {
      entree.srcsetJpg = versSrcset([...jpgReduits, { url, largeur: largeurPleine }]);
    }

    const webp = variantesTrouvees.filter((v) => v?.format === 'webp');
    if (webp.length) entree.srcsetWebp = versSrcset(webp);

    if (entree.srcsetJpg || entree.srcsetWebp) entree.sizes = sizesDe(emplacement);

    sortie[emplacement] = entree;
  }));

  return sortie;
}

/**
 * Enregistre une photo envoyee par le commercant, et ses variantes eventuelles
 * (largeurs reduites, WebP — voir plus haut). `variantes` est une liste de
 * `{ largeur, format, donnees }` ; tout element hors de ce qu'attend cet
 * emplacement, ou dont le contenu ne correspond pas au format annonce, est
 * simplement IGNORE — jamais un refus. Un navigateur incapable d'encoder du
 * WebP, par exemple, n'en enverra aucun : la photo se depose quand meme.
 *
 * Renvoie `{ erreur }` si l'envoi est refuse — le message est affichable tel
 * quel — ou `{ ok: true }`.
 */
export async function deposerPhoto(emplacement, donnees, variantes) {
  if (!emplacementConnu(emplacement)) {
    return { erreur: 'Emplacement inconnu.' };
  }
  if (typeof donnees !== 'string' || !donnees) {
    return { erreur: 'Aucune image reçue.' };
  }
  if (donnees.length > MAX_CARACTERES) {
    return { erreur: 'Cette photo est trop lourde. Choisissez-en une plus légère.' };
  }

  const reconnue = FORMAT.exec(donnees);
  if (!reconnue) {
    return { erreur: "Cette image n'est pas dans un format accepté (JPEG, PNG ou WebP)." };
  }

  const binaire = Buffer.from(reconnue[2], 'base64');
  if (!binaire.length) return { erreur: 'Cette image est vide.' };

  // Les variantes sont VALIDEES ICI, AVANT LA MOINDRE ECRITURE : un depot qui
  // s'arreterait a mi-chemin laisserait une vignette reduite d'une photo a
  // cote du plein format d'une autre.
  const permises = new Set(variantesPossibles(emplacement).map((v) => `${v.largeur}:${v.format}`));
  const aEcrire = [];

  if (Array.isArray(variantes)) {
    for (const v of variantes) {
      if (!v || typeof v.donnees !== 'string') continue;
      if (!permises.has(`${v.largeur ?? null}:${v.format}`)) continue;
      if (v.donnees.length > MAX_CARACTERES) continue;

      const m = FORMAT.exec(v.donnees);
      if (!m) continue;
      // Le contenu doit correspondre a l'extension qu'il portera : un fichier
      // `.webp` qui contiendrait en realite du JPEG tromperait le navigateur,
      // qui decide du decodage a partir du `Content-Type` que le serveur pose
      // depuis l'EXTENSION (voir la route dans src/server.js).
      if ((v.format === 'webp') !== (m[1] === 'webp')) continue;
      if (v.format === 'jpg' && m[1] !== 'jpeg') continue;

      const bin = Buffer.from(m[2], 'base64');
      if (!bin.length) continue;

      aEcrire.push({ chemin: path.join(PHOTOS_DIR, nomVariante(emplacement, v.largeur ?? null, v.format)), binaire: bin });
    }
  }

  await mkdir(PHOTOS_DIR, { recursive: true });

  // On efface D'ABORD toute variante deposee precedemment, y compris celles
  // qu'on ne va pas remplacer. Sans ce menage, remplacer une photo depuis un
  // navigateur incapable d'encoder du WebP garderait le WebP de l'ANCIENNE
  // photo : la page servirait alors deux images differentes selon le format
  // que le navigateur du visiteur demande.
  await Promise.all(variantesPossibles(emplacement).map(({ largeur, format }) =>
    unlink(path.join(PHOTOS_DIR, nomVariante(emplacement, largeur, format))).catch(() => {})));

  // Ecriture en deux temps : un fichier temporaire, puis un renommage, qui est
  // instantane. Sans cela, un visiteur tombant au mauvais moment recevrait une
  // image a moitie ecrite — et le navigateur la garderait en cache telle quelle.
  //
  // Le nom du fichier temporaire est tire au hasard : deux envois qui se
  // croiseraient sur le meme emplacement s'ecriraient sinon l'un sur l'autre
  // avant d'etre renommes, et le resultat serait un melange des deux images.
  const ecrire = async (definitif, contenu) => {
    const provisoire = `${definitif}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(provisoire, contenu);
      await rename(provisoire, definitif);
    } catch (erreur) {
      // Ne pas laisser trainer un fichier a moitie ecrit dans le dossier du client.
      await unlink(provisoire).catch(() => {});
      throw erreur;
    }
  };

  await ecrire(cheminDepose(emplacement), binaire);
  await Promise.all(aEcrire.map((v) => ecrire(v.chemin, v.binaire)));

  return { ok: true };
}

/**
 * Retire la photo deposee, ET SES VARIANTES. On retombe alors sur celle livree
 * avec le site, ou sur le degrade : c'est pourquoi ce geste ne demande pas de
 * confirmation.
 *
 * La photo livree, elle, ne se supprime pas — elle fait partie du site, pas des
 * donnees du commerce.
 */
export async function retirerPhoto(emplacement) {
  if (!emplacementConnu(emplacement)) return { erreur: 'Emplacement inconnu.' };

  try {
    await unlink(cheminDepose(emplacement));
  } catch (erreur) {
    // Deja absente : le resultat voulu est atteint, ce n'est pas une erreur.
    if (erreur.code !== 'ENOENT') throw erreur;
  }

  await Promise.all(variantesPossibles(emplacement).map(({ largeur, format }) =>
    unlink(path.join(PHOTOS_DIR, nomVariante(emplacement, largeur, format))).catch(() => {})));

  return { ok: true };
}

/** Le contenu d'un fichier photo, pour la route qui le sert. */
export async function lirePhoto(emplacement) {
  const photo = await trouverPhoto(emplacement);
  if (!photo) return null;
  return { contenu: await readFile(photo.chemin), mtime: photo.mtime };
}

/**
 * Le contenu d'UNE VARIANTE (`largeur` reduite et/ou `format` WebP), pour la
 * route qui la sert. `largeur: null, format: 'jpg'` designe le fichier
 * principal — meme chose que `lirePhoto()`.
 *
 * >>> LA VARIANTE EST CHERCHEE DANS LE MEME ETAGE QUE LA PHOTO PRINCIPALE,
 * JAMAIS DANS L'AUTRE. <<< Si le commercant a depose une photo mais que sa
 * variante WebP a echoue a s'ecrire (ou que son navigateur ne sait pas
 * l'encoder), on ne va pas chercher le WebP LIVRE a la place : ce serait
 * montrer, sous un meme format, le sujet de deux photos differentes. Une
 * variante absente de l'etage courant est simplement absente — voir
 * `listerPhotos()`, qui ne l'annonce alors pas dans `srcset`.
 */
export async function lireVariante(emplacement, largeur, format) {
  if (!emplacementConnu(emplacement)) return null;
  if (!largeur && format === 'jpg') return lirePhoto(emplacement);

  const photo = await trouverPhoto(emplacement);
  if (!photo) return null;

  const fichier = await trouverFichierVariante(emplacement, photo.source, largeur, format);
  if (!fichier) return null;

  return { contenu: await readFile(fichier.chemin), mtime: fichier.mtime };
}

/** Meme echappement que dans src/lib/galerie.js. Les deux doivent coincider. */
function esc(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Le `<picture>` du visuel d'accueil, ECRIT DANS LA PAGE SERVIE plutot que
 * peint au chargement (lot D, point D2).
 *
 * >>> C'ETAIT LA DERNIERE IMAGE DE LA VITRINE SANS `src` NI `alt` DANS LE HTML
 * SERVI. <<< Le lot 6 avait fait ce geste pour la galerie ; le heros y avait
 * echappe parce qu'il n'est pas dans une liste repetee — mais c'est la PLUS
 * GRANDE image de la page, et celle qu'un robot sans JavaScript rencontre en
 * premier. Sans ce geste, il ne lisait ni l'image ni sa description.
 *
 * Renvoie `null` si aucune photo n'est deposee ou livree : `remplacerZone()`
 * laisse alors le squelette du fichier (`hidden`, sans `src`) tel quel — la
 * page garde le degrade de la charte plutot qu'un `<img>` casse.
 *
 * ⚠️ MEME BALISAGE QUE CE QUE `peindrePhotos()` produit au chargement
 * (js/04-contenu-statique.js, la fonction `poserSrcset()`) : la page le
 * repeint a l'identique une fois le JavaScript execute.
 */
export function sectionHero(photos, descriptions) {
  const photo = photos?.hero;
  if (!photo?.url) return null;

  const alt = descriptions?.hero ?? '';
  const dims = EMPLACEMENTS.hero;

  const source = photo.srcsetWebp
    ? `<source type="image/webp" srcset="${esc(photo.srcsetWebp)}" sizes="${esc(photo.sizes)}">`
    : '<source type="image/webp">';
  const srcset = photo.srcsetJpg ? ` srcset="${esc(photo.srcsetJpg)}" sizes="${esc(photo.sizes)}"` : '';

  return `<picture>${source}<img src="${esc(photo.url)}" alt="${esc(alt)}" width="${dims.largeur}" height="${dims.hauteur}"${srcset}></picture>`;
}
