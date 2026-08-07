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
export const EMPLACEMENTS = {
  hero: {
    titre: "Photo d'accueil",
    format: 'Paysage',
    // `null` = cet emplacement n'affiche pas de legende. C'est le cas du visuel
    // d'accueil, qui occupe toute la largeur et ne porte aucun texte.
    legende: null,
    // Un 16:9, recadre a l'affichage : tres large sur grand ecran, presque
    // carre sur telephone (voir `object-fit: cover` dans 08-accueil.css). Le
    // sujet doit donc etre au centre — c'est ecrit dans public/photos/LISEZ-MOI.md.
    largeur: 1200,
    hauteur: 675,
  },
  // La galerie est en portrait 3:4 : c'est le cadrage d'une personne assise au
  // fauteuil et d'une main au travail, les deux sujets de ce commerce.
  'galerie-1': { titre: 'Galerie 1', format: 'Portrait', legende: 'La devanture', largeur: 700, hauteur: 933 },
  'galerie-2': { titre: 'Galerie 2', format: 'Portrait', legende: 'Le poste', largeur: 700, hauteur: 933 },
  'galerie-3': { titre: 'Galerie 3', format: 'Portrait', legende: 'La coupe', largeur: 700, hauteur: 933 },
  'galerie-4': { titre: 'Galerie 4', format: 'Portrait', legende: 'Le rasage', largeur: 700, hauteur: 933 },
};

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

/** Ce qui est reellement enregistre sur le disque, ou {} si rien. */
async function legendesEnregistrees() {
  try {
    const brut = JSON.parse(await readFile(FICHIER_LEGENDES, 'utf8'));
    return brut && typeof brut === 'object' ? brut : {};
  } catch {
    // Fichier absent (le cas normal) ou illisible : on retombe sur les legendes
    // livrees. Une legende ne vaut pas de faire echouer l'affichage du site.
    return {};
  }
}

/** La legende de chaque emplacement de galerie, saisie ou livree. */
export async function listerLegendes() {
  const sortie = {};
  for (const [nom, e] of Object.entries(EMPLACEMENTS)) {
    if (e.legende !== null) sortie[nom] = e.legende;
  }

  const saisies = await legendesEnregistrees();
  for (const [nom, texte] of Object.entries(saisies)) {
    if (emplacementLegendable(nom) && typeof texte === 'string') {
      sortie[nom] = texte.slice(0, LEGENDE_MAX);
    }
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

  const saisies = await legendesEnregistrees();
  saisies[emplacement] = texte.trim().slice(0, LEGENDE_MAX);

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
 */
export async function listerPhotos() {
  const sortie = {};

  await Promise.all(Object.keys(EMPLACEMENTS).map(async (emplacement) => {
    const photo = await trouverPhoto(emplacement);
    if (!photo) return;
    sortie[emplacement] = {
      url: `/photos/${emplacement}.jpg?v=${Math.round(photo.mtime)}`,
      source: photo.source,
    };
  }));

  return sortie;
}

/**
 * Enregistre une photo envoyee par le commercant.
 *
 * Renvoie `{ erreur }` si l'envoi est refuse — le message est affichable tel
 * quel — ou `{ ok: true }`.
 */
export async function deposerPhoto(emplacement, donnees) {
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

  await mkdir(PHOTOS_DIR, { recursive: true });

  // Ecriture en deux temps : un fichier temporaire, puis un renommage, qui est
  // instantane. Sans cela, un visiteur tombant au mauvais moment recevrait une
  // image a moitie ecrite — et le navigateur la garderait en cache telle quelle.
  //
  // Le nom du fichier temporaire est tire au hasard : deux envois qui se
  // croiseraient sur le meme emplacement s'ecriraient sinon l'un sur l'autre
  // avant d'etre renommes, et le resultat serait un melange des deux images.
  const definitif = cheminDepose(emplacement);
  const provisoire = `${definitif}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(provisoire, binaire);
    await rename(provisoire, definitif);
  } catch (erreur) {
    // Ne pas laisser trainer un fichier a moitie ecrit dans le dossier du client.
    await unlink(provisoire).catch(() => {});
    throw erreur;
  }

  return { ok: true };
}

/**
 * Retire la photo deposee. On retombe alors sur celle livree avec le site, ou
 * sur le degrade : c'est pourquoi ce geste ne demande pas de confirmation.
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

  return { ok: true };
}

/** Le contenu d'un fichier photo, pour la route qui le sert. */
export async function lirePhoto(emplacement) {
  const photo = await trouverPhoto(emplacement);
  if (!photo) return null;
  return { contenu: await readFile(photo.chemin), mtime: photo.mtime };
}
