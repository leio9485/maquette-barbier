// ---------------------------------------------------------------------------
// LA SECTION « AVIS », ECRITE DANS LA PAGE SERVIE
//
// Meme raison que pour les prestations (src/lib/catalogue.js), et meme
// mecanique : sans ce fichier, la vitrine partirait avec une liste VIDE,
// remplie par le JavaScript une fois /api/config recu. Les temoignages
// n'existeraient donc pas dans le fichier envoye, et un lecteur qui n'execute
// pas de code (moteur secondaire, apercu de lien, annuaire, agent) verrait un
// commerce sans aucun avis.
//
// CE FICHIER EST UN SECOND RENDU, ET C'EST ASSUME
//
// Il refait ce que `peindreAvis()` fait dans la page
// (src/page/js/04-contenu-statique.js). On ne peut pas partager le code : le
// site est envoye en une seule page, sans etape de construction, et son
// JavaScript vit dans le navigateur.
//
// >>> EN CAS DE MODIFICATION DE `peindreAvis()`, REPORTER LE CHANGEMENT ICI.
//     Un commentaire le rappelle des deux cotes, comme pour le catalogue. <<<
//
// LE COUT EST NEGLIGEABLE, contrairement a celui de l'equipe : trois
// temoignages font quelques centaines d'octets de texte, que la compression
// reprend presque entierement. Il n'y a ici ni image ni base64.
//
// NI ETOILES, NI PASTILLE A INITIALES, ET C'EST DELIBERE.
//
// Les etoiles d'abord : une note qu'un commerce se decerne sur son propre site
// n'a aucune valeur — Google les ignore depuis 2019 (voir src/lib/page.js) — et
// sur une demonstration, elle serait purement inventee. Une rangee d'etoiles est
// par ailleurs un pack d'icones, exactement le genre de detail qui date une page.
//
// La pastille ronde a initiales ensuite : c'est le faux avatar, present sur tous
// les sites de commerce local. Un prenom et un mois en chasse fixe disent la
// meme chose et ne ressemblent a rien d'autre.
//
// LA SECTION EST TOUJOURS ECRITE, MEME VIDE, et se masque alors par `hidden`.
// La retirer completement priverait la page d'un element a remplir : un commerce
// qui saisit son premier temoignage ne le verrait pas apparaitre avant d'avoir
// recharge.
// ---------------------------------------------------------------------------

/** Texte pose entre deux balises ou dans un attribut. Meme regle que `esc()` de la page. */
function esc(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Un temoignage.
 *
 * `<blockquote>` et `<cite>` plutot que des `<div>` : c'est litteralement une
 * citation attribuee, et le balisage juste est ce qui permet a un lecteur
 * d'ecran d'annoncer « citation » avant de la lire.
 */
function avis(t) {
  const attribution = [t.author, t.meta].filter(Boolean).map(esc);

  return '<li class="avis">'
    + `<blockquote class="avis-citation"><p>${esc(t.quote)}</p></blockquote>`
    + '<p class="avis-auteur donnee">'
      + `<cite>${attribution[0] ?? ''}</cite>`
      + (attribution[1] ? ` <span aria-hidden="true">·</span> ${attribution[1]}` : '')
    + '</p>'
    + '</li>';
}

/**
 * Toute la section « Avis », telle qu'elle part dans la page.
 *
 * Marqueurs compris dans la zone remplacee : c'est la section ENTIERE qui est
 * ecrite ici, `hidden` compris, et non son seul contenu — c'est ce qui permet
 * de la masquer sans avoir a toucher un attribut hors de la zone.
 */
export function sectionTemoignages(config) {
  const liste = config.testimonials ?? [];

  // LA NOTE GOOGLE ET LE LIEN VERS LA FICHE. Les deux se masquent seuls quand
  // le commerce n'a rien saisi, et ils sont ecrits ici plutot que laisses au
  // JavaScript pour la meme raison que les temoignages : un lecteur qui
  // n'execute pas de code doit voir la note.
  //
  // C'est la seule chose de cette section qui vaille une preuve. Trois
  // citations choisies par le commerce lui-meme ne prouvent rien — elles
  // donnent le ton. La note, elle, est comptee ailleurs, et le lien permet
  // d'aller le verifier.
  const note = Number(config.reviews?.rating) || 0;
  const nombre = Number(config.reviews?.count) || 0;
  const montrable = note > 0 && nombre > 0;

  const texteNote = String(note).replace('.', ',') + '/5';
  const texteNombre = nombre > 1 ? `· ${nombre} avis Google` : '· 1 avis Google';

  const google = config.salon?.links?.google || '';

  return `<section class="bloc sombre" id="avis"${liste.length ? '' : ' hidden'}>`
    + '<div class="bloc-corps">'
      + '<div class="rail">'
        + '<p class="etiquette"><span class="rail-numero">05</span> Avis</p>'
      + '</div>'
      + '<div class="contenu">'
        + '<h2>Ce qu\'en disent<br>les clients</h2>'
        + `<p class="avis-source" id="avisSource"${montrable ? '' : ' hidden'}>`
          + `<span class="avis-source-note donnee" id="avisSourceNote">${esc(texteNote)} ${esc(texteNombre)}</span>`
        + '</p>'
        + `<ul class="avis-liste" id="avisListe" data-nombre="${liste.length}">`
          + liste.map(avis).join('')
        + '</ul>'
        + `<p class="avis-pied" id="avisPied"${google ? '' : ' hidden'}>`
          + `<a id="avisLienGoogle" href="${esc(google || '#')}" target="_blank" rel="noopener">Lire les avis sur Google</a>`
        + '</p>'
      + '</div>'
    + '</div>'
    + '</section>';
}
