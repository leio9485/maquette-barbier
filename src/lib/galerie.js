// ---------------------------------------------------------------------------
// LA GALERIE, ECRITE PAR LE SERVEUR
//
// Elle etait quatre cases ecrites en dur dans parties/galerie.html. Deux
// raisons de la faire produire ici :
//
//   1. QUATRE PHOTOS, C'EST TROP PEU POUR UN BARBIER. Un commerce qui tourne
//      depuis deux ans en a trente. La galerie accepte douze cases, et
//      n'affiche que celles qui portent reellement une photo — une nouvelle
//      instance ne montre donc jamais huit rectangles gris.
//
//   2. Les images n'avaient pas de `src` dans le HTML servi : c'est le
//      JavaScript qui les posait. Un robot qui ne l'execute pas ne voyait
//      aucune image, et l'audit l'a releve. Ecrites ici, elles sont dans la
//      page des le premier octet.
//
// LE MODE AVANT/APRES. Une case peut porter une seconde photo. Les deux
// s'affichent alors cote a cote dans la MEME `<figure>`, sous la meme legende :
// c'est une seule idee — « voila ce que ca donne » — et deux titres sous une
// seule idee se lisent mal. La seconde ne s'affiche jamais seule.
//
// ⚠️ CE FICHIER PRODUIT EXACTEMENT LE MEME BALISAGE QUE `peindreGalerie()`
//    (src/page/js/04-contenu-statique.js). Meme regle que pour les prestations
//    et les avis : le serveur ecrit pour ceux qui n'executent pas de code, la
//    page reecrit pour la mise a jour sans rechargement, et un test verifie que
//    les deux coincident. Si vous changez l'un, changez l'autre.
// ---------------------------------------------------------------------------

import { GALERIE_MAX } from './photos.js';

/** Meme echappement que `esc()` cote page. Les deux doivent coincider. */
function esc(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Les cases a afficher, dans l'ordre, avec ce qu'il faut pour les dessiner.
 *
 * Une case n'existe que si sa photo « avant » existe. C'est ce qui fait que la
 * galerie se remplit et se vide toute seule, sans que le commercant ait a
 * declarer combien de photos il veut.
 */
export function casesGalerie({ photos = {}, legendes = {}, descriptions = {} } = {}) {
  const cases = [];

  for (let n = 1; n <= GALERIE_MAX; n++) {
    const nom = `galerie-${n}`;
    const photo = photos[nom];
    if (!photo?.url) continue;

    const apres = photos[`${nom}-apres`];

    cases.push({
      nom,
      url: photo.url,
      alt: descriptions[nom] ?? '',
      legende: legendes[nom] ?? '',
      apres: apres?.url
        ? { url: apres.url, alt: descriptions[`${nom}-apres`] ?? '' }
        : null,
    });
  }

  return cases;
}

/** Une image de la galerie. */
function image(url, alt, chargement) {
  return `<img src="${esc(url)}" alt="${esc(alt)}" width="700" height="933"${chargement}>`;
}

/**
 * Le contenu de la liste, entre ses marqueurs.
 *
 * Renvoie `null` quand aucune photo n'est deposee : `remplacerZone()` laisse
 * alors le contenu de secours du fichier, et la section garde quelque chose
 * a montrer plutot que de s'afficher vide.
 */
export function sectionGalerie(donnees) {
  const cases = casesGalerie(donnees);
  if (!cases.length) return null;

  return cases.map((c) => {
    // >>> TOUTES EN CHARGEMENT DIFFERE, SANS EXCEPTION. <<<
    //
    // Une premiere version chargeait les quatre premieres tout de suite, par
    // analogie avec la photo d'accueil. C'etait faux, et Lighthouse l'a dit :
    // LA GALERIE N'EST JAMAIS DANS LE PREMIER ECRAN — elle est la quatrieme
    // section de la page. Ces quatre images (354 Kio) partaient donc en meme
    // temps que la photo d'accueil et lui disputaient la bande passante. Le
    // LCP est passe de 2,3 s a 3,9 s pour des photos que personne ne regardait
    // encore.
    //
    // `loading="lazy"` ne se justifie que sous le premier ecran ; ici, tout y
    // est.
    const chargement = ' loading="lazy"';

    const images = c.apres
      ? '<div class="galerie-paire">'
        + image(c.url, c.alt, chargement)
        + image(c.apres.url, c.apres.alt, chargement)
        + '</div>'
      : image(c.url, c.alt, chargement);

    return `<li class="galerie-case${c.apres ? ' galerie-case-paire' : ''}" data-photo="${esc(c.nom)}">`
      + '<figure>'
      + images
      + (c.legende
        ? `<figcaption class="galerie-legende etiquette" data-legende="${esc(c.nom)}">${esc(c.legende)}</figcaption>`
        : '')
      + '</figure>'
      + '</li>';
  }).join('');
}
