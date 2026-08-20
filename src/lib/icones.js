// ---------------------------------------------------------------------------
// LES ICONES DU SITE, DESSINEES PAR LE SERVEUR
//
// >>> « AJOUTER A L'ECRAN D'ACCUEIL » DONNAIT UNE ICONE VIDE. <<< Le site
// n'avait qu'un favicon en SVG dans un `data:` — parfait sur un ordinateur, et
// ignore par iOS, qui ne lit que `apple-touch-icon` et n'accepte pas le SVG.
// `/favicon.ico` et `/manifest.webmanifest` repondaient 404. Pour un outil de
// prise de rendez-vous qu'on consulte au telephone, c'est le raccourci qu'un
// client garde sur son ecran d'accueil qui n'a pas de visage.
//
// >>> POURQUOI DESSINER PLUTOT QUE LIVRER DES FICHIERS. <<<
//
//   - L'icone porte le MONOGRAMME, pas une image : quatre rectangles, les
//     memes que le favicon SVG de la page. Les dessiner coute une trentaine de
//     lignes ; les livrer coute cinq fichiers binaires a regenerer a la main le
//     jour ou une couleur de la charte bouge.
//   - AUCUNE DEPENDANCE AJOUTEE. Le projet en compte quatre, et une
//     bibliotheque de traitement d'image pour tracer des rectangles serait
//     hors de proportion. `zlib` est dans Node.
//
// ⚠️ LE DESSIN SUIT LA CHARTE, ET IL N'INVENTE RIEN. Encre, bleu de travail,
//    craie — trois des cinq couleurs de `02-jetons.css`, et rien d'autre :
//    ni ciseaux, ni enseigne tricolore, ni lettres. Le meme monogramme que le
//    favicon SVG, au pixel pres : une regle graduee, l'objet de l'etabli.
//
// ⚠️ SI CE DESSIN CHANGE, LE FAVICON SVG DES QUATRE SQUELETTES CHANGE AVEC.
//    Ils disent la meme chose dans deux langages ; un test compare les deux
//    geometries.
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';

/** Les couleurs de la charte employees ici, en RVB. */
const ENCRE = [0x16, 0x19, 0x1B];
const BLEU = [0x24, 0x40, 0x5C];
const CRAIE = [0xEF, 0xEE, 0xEA];

/**
 * Le monogramme, decrit dans une grille de 64 — exactement le `viewBox` du
 * favicon SVG des squelettes (src/page/*.html).
 *
 * Une barre verticale bleue a gauche, trois traits craie a droite : une regle
 * et ses graduations. C'est tout, et c'est le sujet — l'outil range.
 */
export const GRILLE = 64;

export const FORMES = [
  { x: 10, y: 14, l: 6, h: 36, couleur: BLEU },
  { x: 26, y: 14, l: 28, h: 6, couleur: CRAIE },
  { x: 26, y: 29, l: 28, h: 6, couleur: CRAIE },
  { x: 26, y: 44, l: 20, h: 6, couleur: CRAIE },
];

/**
 * Le calcul de CRC32 des morceaux d'un PNG.
 *
 * Ecrit ici plutot qu'importe : `zlib.crc32` n'existe que depuis Node 20.15, et
 * ce projet declare `>=20`. Une table de 256 entrees, calculee une fois.
 */
const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (const octet of buffer) c = TABLE_CRC[(c ^ octet) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Un morceau de PNG : longueur, type, donnees, controle. */
function morceau(type, donnees) {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(donnees.length, 0);
  entete.write(type, 4, 'ascii');

  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(Buffer.concat([entete.subarray(4), donnees])), 0);

  return Buffer.concat([entete, donnees, controle]);
}

/**
 * L'icone a la taille demandee, en PNG.
 *
 * Couleur vraie sans transparence (type 2) : le fond est un aplat encre plein,
 * il n'y a rien a laisser voir derriere. Les bords sont arrondis a l'entier le
 * plus proche plutot que calcules par pixel — le dessin n'a que des angles
 * droits, et c'est justement la charte : rayon 0 partout.
 */
export function dessinerIcone(taille) {
  const echelle = taille / GRILLE;
  const lignes = Buffer.alloc(taille * (1 + taille * 3));

  // Le fond, pose d'un coup : chaque ligne commence par son octet de filtre
  // (0 = aucun), puis les pixels.
  for (let y = 0; y < taille; y++) {
    const debut = y * (1 + taille * 3);
    lignes[debut] = 0;
    for (let x = 0; x < taille; x++) {
      const p = debut + 1 + x * 3;
      lignes[p] = ENCRE[0];
      lignes[p + 1] = ENCRE[1];
      lignes[p + 2] = ENCRE[2];
    }
  }

  for (const forme of FORMES) {
    const x0 = Math.round(forme.x * echelle);
    const x1 = Math.round((forme.x + forme.l) * echelle);
    const y0 = Math.round(forme.y * echelle);
    const y1 = Math.round((forme.y + forme.h) * echelle);

    for (let y = y0; y < y1; y++) {
      const debut = y * (1 + taille * 3);
      for (let x = x0; x < x1; x++) {
        const p = debut + 1 + x * 3;
        lignes[p] = forme.couleur[0];
        lignes[p + 1] = forme.couleur[1];
        lignes[p + 2] = forme.couleur[2];
      }
    }
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete[8] = 8;   // huit bits par canal
  entete[9] = 2;   // couleur vraie, sans transparence
  entete[10] = 0;  // compression standard
  entete[11] = 0;  // filtrage standard
  entete[12] = 0;  // pas d'entrelacement

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    morceau('IHDR', entete),
    morceau('IDAT', zlib.deflateSync(lignes, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Le fichier `.ico`, qui n'est qu'une enveloppe autour d'un PNG.
 *
 * Le format ICO accepte un PNG tel quel depuis Windows Vista, et tous les
 * navigateurs qui demandent encore `/favicon.ico` le comprennent. On evite
 * ainsi d'ecrire un encodeur BMP pour un fichier que personne ne regarde.
 *
 * ⚠️ POURQUOI SERVIR ENCORE CE FICHIER. La page declare son icone en SVG, que
 *    tous les navigateurs actuels preferent. Mais `/favicon.ico` est demande
 *    SANS que la page le declare — par les navigateurs anciens, et par les
 *    agregateurs de liens — et une 404 dans le journal du serveur a chaque
 *    visite est un bruit qu'on finit par ne plus lire.
 */
export function dessinerIco(taille = 32) {
  const png = dessinerIcone(taille);

  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);  // reserve
  entete.writeUInt16LE(1, 2);  // 1 = icone
  entete.writeUInt16LE(1, 4);  // une seule image

  const entree = Buffer.alloc(16);
  entree[0] = taille >= 256 ? 0 : taille;  // largeur (0 = 256)
  entree[1] = taille >= 256 ? 0 : taille;  // hauteur
  entree[2] = 0;   // pas de palette
  entree[3] = 0;   // reserve
  entree.writeUInt16LE(1, 4);   // plans
  entree.writeUInt16LE(24, 6);  // bits par pixel
  entree.writeUInt32LE(png.length, 8);
  entree.writeUInt32LE(22, 12); // le PNG commence apres l'en-tete et l'entree

  return Buffer.concat([entete, entree, png]);
}

/**
 * Le manifeste, engendre depuis les reglages.
 *
 * >>> LE NOM VIENT DU COMMERCE, PAS D'UNE CHAINE EN DUR. <<< C'est ce qui
 * s'affiche sous l'icone une fois le site pose sur l'ecran d'accueil : chez un
 * client, ce doit etre le nom de SA boutique.
 *
 * `display: standalone` : ouvert depuis l'ecran d'accueil, le site s'affiche
 * sans la barre d'adresse — c'est ce qui le fait ressembler a une application
 * plutot qu'a un onglet. `theme_color` reprend l'encre, deja posee en
 * `<meta name="theme-color">` par les quatre squelettes.
 *
 * ⚠️ `short_name` EST COUPE A DOUZE CARACTERES, ce que la plupart des systemes
 *    affichent sous une icone. Le couper ici plutot que de laisser le systeme
 *    le faire evite « L'Établi Coif… » avec des points de suspension a un
 *    endroit choisi par personne.
 */
export function manifeste(nomDuCommerce) {
  const nom = String(nomDuCommerce || '').trim() || 'Prendre rendez-vous';

  return {
    name: nom,
    short_name: nom.length > 12 ? nom.slice(0, 12).trim() : nom,
    description: 'Prendre rendez-vous, voir les horaires et les tarifs.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#16191B',
    theme_color: '#16191B',
    lang: 'fr',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icone-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}

/**
 * Les tailles servies, et rien d'autre.
 *
 * Liste fermee, meme raison que pour les photos (src/lib/photos.js) : une
 * taille recue du reseau ne doit pas pouvoir demander au serveur de dessiner
 * une image de 30 000 pixels de cote pour occuper sa memoire.
 */
export const TAILLES = new Set([180, 192, 512]);

/** Les icones deja dessinees, gardees en memoire : elles ne changent jamais. */
const CACHE = new Map();

export function icone(taille) {
  if (!TAILLES.has(taille)) return null;
  if (!CACHE.has(taille)) CACHE.set(taille, dessinerIcone(taille));
  return CACHE.get(taille);
}

let icoEnMemoire = null;

export function ico() {
  if (!icoEnMemoire) icoEnMemoire = dessinerIco(32);
  return icoEnMemoire;
}
