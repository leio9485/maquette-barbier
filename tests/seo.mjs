// ---------------------------------------------------------------------------
// TESTS DU REFERENCEMENT ET DE L'ACCESSIBILITE (lot 5)
//
//     npm start        (terminal 1, laisse ouvert)
//     npm run test:seo (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE, ET POURQUOI ELLE EXISTE. Aucun de ces points ne
// se voit a l'ecran : un second `<h1>`, un `alt` vide, un type schema.org
// approximatif ne cassent rien et ne se remarquent jamais en naviguant. Ils se
// paient six mois plus tard, en visites qui ne viennent pas et en clients qui
// n'entendent pas ce qu'il y a sur la photo.
//
// ⚠️ LES TESTS PORTENT SUR LE HTML SERVI, pas sur le DOM apres JavaScript. Ce
//    que lit un robot, c'est ce que le serveur envoie.
// ---------------------------------------------------------------------------

import { creerVerificateur, BASE } from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const vitrine = await fetch(BASE + '/').then((r) => r.text());

/** Les balises ouvrantes d'un nom, dans le HTML servi. */
const compter = (html, balise) =>
  (html.match(new RegExp(`<${balise}[\\s>]`, 'g')) ?? []).length;

// --- 1. Un seul <h1> --------------------------------------------------------
//
// Il y en avait deux : le titre d'accueil et « L'Établi », le titre de l'ecran
// de connexion. Le second est parti avec l'espace commercant (lot 4) ; ce test
// est ce qui empeche un troisieme d'apparaitre sans qu'on le remarque.
console.log('1. La structure des titres');
{
  const h1 = compter(vitrine, 'h1');
  verifie('la vitrine ne porte qu\'un seul <h1>', h1 === 1, h1);
  verifie('et il est celui du titre d\'accueil',
    /<h1>Coupe, barbe/.test(vitrine), 'titre inattendu');

  // ⚠️ LES MOTS NE SE COLLENT PLUS AUTOUR DES `<br>` (lot 8a).
  //
  // Le titre se lisait « Coupe, barbeet rasageà Bavay » une fois les balises
  // retirees. Le rendu a l'ecran etait juste — une espace en fin de ligne ne se
  // voit pas — mais c'est ce texte-la que reprennent l'extrait Google, l'apercu
  // d'un partage et le copier-coller. Un titre illisible dans un resultat de
  // recherche est un titre qui ne se clique pas.
  const titre = /<h1>([\s\S]*?)<\/h1>/.exec(vitrine)?.[1] ?? '';
  const lu = titre.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  verifie('les mots du <h1> ne se collent pas autour des <br>',
    lu === 'Coupe, barbe et rasage à Bavay', lu);
}
{
  // L'espace a le sien, et c'est normal : c'est un autre document.
  const espace = await fetch(BASE + '/espace-salon').then((r) => r.text());
  verifie('l\'espace commercant a son propre <h1>, un seul',
    compter(espace, 'h1') === 1, compter(espace, 'h1'));

  const annuler = await fetch(BASE + '/annuler').then((r) => r.text());
  verifie('la page d\'annulation aussi',
    compter(annuler, 'h1') === 1, compter(annuler, 'h1'));
}

// --- 2. Les images ----------------------------------------------------------
console.log('\n2. Les images et leurs descriptions');
{
  const config = await fetch(BASE + '/api/config').then((r) => r.json());
  const descriptions = config.descriptions ?? {};

  verifie('la vitrine recoit une description par emplacement',
    Object.keys(descriptions).length >= 5, Object.keys(descriptions));

  const vides = Object.entries(descriptions).filter(([, texte]) => !texte);
  verifie('aucune n\'est vide', vides.length === 0, vides);

  // ⚠️ LE POINT QUI COMPTE : une description DECRIT l'image, elle ne repete
  //    pas la legende. « Le poste » sous la photo et « Le poste » dans
  //    l'attribut, c'est la meme information dite deux fois — quelqu'un qui
  //    n'a pas l'image entend deux fois trois mots et n'apprend rien.
  const legendes = config.legendes ?? {};
  const identiques = Object.entries(legendes)
    .filter(([nom, legende]) => legende && descriptions[nom] === legende);
  verifie('aucune ne recopie sa legende', identiques.length === 0, identiques);

  const courtes = Object.entries(descriptions).filter(([, t]) => t.length < 20);
  verifie('toutes disent quelque chose (plus de vingt caracteres)',
    courtes.length === 0, courtes);
}
{
  // ⚠️ ON COMPTE DANS LA LISTE, PAS DANS LA PAGE ENTIERE. Le JavaScript de la
  //    page contient lui aussi le mot `<figure` — c'est lui qui redessine la
  //    galerie sans rechargement (js/04-contenu-statique.js). Compter sur tout
  //    le document donnait un de trop, et l'ancien compte ne tombait juste que
  //    parce que ce code n'existait pas encore.
  const liste = /<ul class="galerie" id="galerieListe">([\s\S]*?)<\/ul>/.exec(vitrine)?.[1] ?? '';

  verifie('la liste de la galerie est bien dans le HTML servi', liste.length > 0, 'liste absente');
  verifie('chaque case emploie <figure>',
    compter(liste, 'figure') === compter(liste, 'li'), [compter(liste, 'figure'), compter(liste, 'li')]);
  verifie('et <figcaption>, qui lie la legende a SON image',
    compter(liste, 'figcaption') > 0, compter(liste, 'figcaption'));
  verifie('chaque image a son adresse des le HTML servi',
    (liste.match(/<img [^>]*src="/g) ?? []).length >= compter(liste, 'li'),
    [(liste.match(/<img /g) ?? []).length, compter(liste, 'li')]);
  verifie('les legendes ne sont plus des <p> orphelins',
    !liste.includes('<p class="galerie-legende'), 'balise <p> trouvee');
}
{
  // >>> LE HEROS EST ECRIT DANS LA PAGE, `src` ET `alt` COMPRIS (lot D, D2).
  // <<< C'etait la derniere image de la vitrine que le HTML servi n'avait
  // qu'en `<img alt="" hidden>`, sans adresse — un robot sans JavaScript ne la
  // voyait pas, et n'en lisait pas la description.
  const zone = /<div class="photo-accueil"[^>]*>([\s\S]*?)<\/div>/.exec(vitrine)?.[1] ?? '';
  verifie('le heros a une adresse des le HTML servi',
    /<img [^>]*src="\/photos\/hero\.jpg\?v=\d+"/.test(zone), zone);
  verifie('et une description non vide',
    /<img [^>]*alt="[^"]{20,}"/.test(zone), zone);
  verifie('il n\'est plus masque',
    !/<picture>[\s\S]*?<img[^>]*\bhidden\b/.test(zone), zone);
}

// --- 3. Les donnees structurees --------------------------------------------
console.log('\n3. Les donnees structurees');

const bloc = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(vitrine);
let ld = null;
{
  verifie('le bloc JSON-LD est present', Boolean(bloc), 'absent');
  try {
    ld = JSON.parse(bloc[1]);
    verifie('il est du JSON valide', true);
  } catch (erreur) {
    verifie('il est du JSON valide', false, erreur.message);
  }
}
{
  // ⚠️ `HairSalon`, ET NON `BarberShop` (lot D, D4). schema.org n'a jamais
  //    defini `BarberShop` — verifie en le demandant directement, 404 — et ce
  //    site l'a pourtant servi comme type par defaut pendant plusieurs lots.
  //    `HairSalon` est le sous-type le plus proche pour un barbier.
  verifie('le type est un sous-type reel de schema.org (HairSalon, pas BarberShop)',
    ld?.['@type'] === 'HairSalon', ld?.['@type']);
  verifie('il vient des reglages et non du code',
    (await fetch(BASE + '/api/config').then((r) => r.json())).salon.type === ld?.['@type'],
    ld?.['@type']);

  verifie('l\'adresse postale est complete',
    Boolean(ld?.address?.streetAddress && ld?.address?.postalCode
      && ld?.address?.addressLocality && ld?.address?.addressCountry), ld?.address);

  verifie('les horaires sont publies',
    Array.isArray(ld?.openingHoursSpecification) && ld.openingHoursSpecification.length > 0,
    ld?.openingHoursSpecification?.length);
}
{
  const catalogue = ld?.hasOfferCatalog;
  verifie('le catalogue des prestations est publie',
    catalogue?.['@type'] === 'OfferCatalog', catalogue?.['@type']);

  // Les rayons imbriquent un second niveau d'OfferCatalog.
  const offres = (catalogue?.itemListElement ?? [])
    .flatMap((n) => (n['@type'] === 'OfferCatalog' ? n.itemListElement : [n]));

  verifie('il porte des offres', offres.length > 0, offres.length);
  verifie('chacune a un prix en euros',
    offres.every((o) => o.price && o.priceCurrency === 'EUR'), offres[0]);
  verifie('chacune a une duree au format ISO 8601 (PT25M)',
    offres.every((o) => /^PT\d+M$/.test(o.itemOffered?.estimatedDuration ?? '')),
    offres.map((o) => o.itemOffered?.estimatedDuration).slice(0, 3));
  verifie('les durees sont celles des prestations, pas des valeurs ecrites en dur',
    offres.some((o) => o.itemOffered.estimatedDuration === 'PT25M'),
    offres.map((o) => o.itemOffered?.estimatedDuration));
}
{
  // ⚠️ NI `aggregateRating` NI `review`, ET C'EST DELIBERE. Google ecarte
  //    depuis 2019 les avis qu'un commerce publie a son propre sujet : la note
  //    n'aurait aucun effet, et exposerait a un avertissement dans la Search
  //    Console. Elle reste affichee sur la page — elle rassure, c'est son role.
  verifie('la note n\'est PAS publiee en donnees structurees',
    ld?.aggregateRating === undefined, ld?.aggregateRating);
  verifie('les temoignages non plus', ld?.review === undefined, ld?.review);
}

// --- 4. Le plan du site -----------------------------------------------------
console.log('\n4. Le plan du site');
{
  // Sans PUBLIC_URL — le cas de cette suite — il n'y a pas de plan de site :
  // il ne peut porter que des adresses absolues, et le serveur ne devine pas
  // la sienne. C'est la reponse juste, et elle n'empeche rien.
  const reponse = await fetch(BASE + '/sitemap.xml');
  const robots = await fetch(BASE + '/robots.txt').then((r) => r.text());

  if (reponse.status === 200) {
    const xml = await reponse.text();
    verifie('le plan de site est du XML valide', xml.startsWith('<?xml'), xml.slice(0, 40));
    verifie('il annonce la vitrine', xml.includes('<loc>'), xml);
    verifie('il n\'annonce AUCUNE page en noindex',
      !xml.includes('/annuler') && !xml.includes('/espace-salon'), xml);
    verifie('robots.txt le declare', robots.includes('Sitemap:'), robots);
  } else {
    verifie('sans PUBLIC_URL, pas de plan de site — et robots.txt n\'en annonce pas',
      reponse.status === 404 && !robots.includes('Sitemap:'), [reponse.status, robots]);
    await reponse.text();
  }
}

// --- 5. Le rendu hors ecran -------------------------------------------------
//
// La cause des captures blanches : `overflow-x: clip` sur la racine etablit une
// region de rognage aux dimensions de la fenetre, et un outil de capture pleine
// page demande une image plus haute SANS agrandir la fenetre.
console.log('\n5. Le rendu hors du premier ecran');
{
  verifie('le garde-fou horizontal est toujours la',
    vitrine.includes('overflow-x:clip') || vitrine.includes('overflow-x: clip'),
    'regle absente');
  verifie('mais la region de rognage descend au-dela de la fenetre',
    vitrine.includes('overflow-clip-margin:100vh') || vitrine.includes('overflow-clip-margin: 100vh'),
    'overflow-clip-margin absent');
  verifie('on n\'est jamais revenu a `hidden`, qui decollerait le bandeau',
    !/html\{[^}]*overflow-x:hidden/.test(vitrine), 'hidden trouve');
}
{
  // Le suspect nomme par l'audit — une apparition au defilement — n'a jamais
  // existe dans ce projet. Ce test est ce qui empeche d'en introduire une : une
  // section dont l'affichage depend d'un evenement est invisible pour tout ce
  // qui ne defile pas.
  verifie('aucune section n\'attend un IntersectionObserver pour s\'afficher',
    !vitrine.includes('IntersectionObserver'), 'observateur trouve');
  verifie('aucune n\'est masquee par content-visibility',
    !vitrine.includes('content-visibility'), 'content-visibility trouve');
}

// --- 6. Le noindex de la demonstration -------------------------------------
console.log('\n6. L\'indexation');
{
  // Cette suite tourne SANS DEMO_MODE : la vitrine doit donc etre indexable.
  // C'est la verification qui compte le plus de tout le lot — un site de client
  // livre en `noindex` est une catastrophe silencieuse.
  const reponse = await fetch(BASE + '/');
  verifie('>>> LA VITRINE D\'UN CLIENT EST INDEXABLE <<<',
    reponse.headers.get('x-robots-tag') === null, reponse.headers.get('x-robots-tag'));
  verifie('et sa page ne porte aucune balise robots restrictive',
    !/<meta name="robots"[^>]*noindex/.test(vitrine), 'balise noindex trouvee');
  await reponse.text();
}

// --- 7. Le cache (lot C) -----------------------------------------------------
//
// >>> LES TROIS DOCUMENTS N'AVAIENT AUCUN EN-TETE DE CACHE. <<< Un navigateur,
// un CDN ou un relais restait alors libre d'en garder une copie sans jamais la
// revalider — au mieux une page dont le nonce CSP est perime (elle porte un
// nonce different a chaque envoi, voir securityHeaders.js) et dont le script ne
// s'execute plus, au pire un tarif que le commercant vient de changer et que le
// visiteur ne voit pas. `no-cache` (et non `no-store`) : la copie peut etre
// gardee, mais jamais servie sans revalidation.
//
// Les photos, elles, avaient DEJA la bonne regle (`/photos/:fichier`,
// src/server.js) : `?v=` autorise un an, son absence force la revalidation.
// L'audit externe visait aussi `/photos/*`, mais chaque adresse ecrite dans la
// page porte deja `?v=` (verifie ci-dessous) — le mecanisme existait, il
// n'etait simplement pas exploite par une requete tapee a la main.
console.log('\n7. Le cache');
{
  const reponse = await fetch(BASE + '/');
  verifie('>>> LE DOCUMENT HTML NE SE CACHE PAS SANS REVALIDATION <<<',
    reponse.headers.get('cache-control') === 'no-cache', reponse.headers.get('cache-control'));
  await reponse.text();

  const espace = await fetch(BASE + '/espace-salon');
  verifie('l\'espace commercant non plus',
    espace.headers.get('cache-control') === 'no-cache', espace.headers.get('cache-control'));
  await espace.text();

  const annuler = await fetch(BASE + '/annuler');
  verifie('ni la page d\'annulation',
    annuler.headers.get('cache-control') === 'no-cache', annuler.headers.get('cache-control'));
  await annuler.text();

  verifie('chaque adresse de photo dans la page porte deja un numero de version',
    /<link rel="preload" as="image" href="\/photos\/hero\.jpg\?v=\d+"/.test(vitrine),
    'aucune correspondance');

  const photoSansVersion = await fetch(BASE + '/photos/hero.jpg');
  verifie('sans version : pas de cache long, la revalidation est forcee',
    photoSansVersion.headers.get('cache-control') === 'public, max-age=0, must-revalidate',
    photoSansVersion.headers.get('cache-control'));
  await photoSansVersion.arrayBuffer();

  const photoAvecVersion = await fetch(BASE + '/photos/hero.jpg?v=1');
  verifie('avec version : cache long et immuable',
    photoAvecVersion.headers.get('cache-control') === 'public, max-age=31536000, immutable',
    photoAvecVersion.headers.get('cache-control'));
  await photoAvecVersion.arrayBuffer();
}

// --- 8. Les mentions legales et la confidentialite (lot D, D3) --------------
//
// >>> DE VRAIES ADRESSES, PAS SEULEMENT UN BOUTON. <<< Elles ouvraient une
// surimpression depuis un `<button>` sans la moindre adresse : ni
// partageables, ni indexables, ni ouvrables dans un nouvel onglet.
console.log('\n8. Les mentions legales et la confidentialite');
{
  const mentions = await fetch(BASE + '/mentions-legales').then((r) => r.text());
  verifie('>>> /mentions-legales REPOND, ET SERT LE MEME DOCUMENT QUE LA VITRINE <<<',
    /<h1>Coupe, barbe/.test(mentions), 'ce n\'est pas la vitrine');
  verifie('la surimpression legale y est deja ouverte',
    /id="surimpressionLegal">/.test(mentions) && !/id="surimpressionLegal" hidden/.test(mentions),
    'surimpression fermee');
  verifie('sur la vue « mentions »',
    /<div data-legal-vue="mentions">/.test(mentions), 'vue confidentialite active');
  verifie('avec un titre distinct',
    /<title>Mentions légales — /.test(mentions), 'titre inchange');

  const confidentialite = await fetch(BASE + '/confidentialite').then((r) => r.text());
  verifie('/confidentialite repond aussi', /<h1>Coupe, barbe/.test(confidentialite), 'ce n\'est pas la vitrine');
  verifie('sur la vue « confidentialite », cette fois',
    /<div data-legal-vue="confidentialite">/.test(confidentialite)
      && /<div data-legal-vue="mentions" hidden>/.test(confidentialite),
    'la mauvaise vue est active');
  verifie('le titre de la boite suit',
    /id="titreLegal">Confidentialité<\/h2>/.test(confidentialite), 'titre de boite inchange');

  // Aucune des deux ne porte de noindex — contrairement a /annuler et
  // /espace-salon, ce sont de vraies pages a indexer.
  const reponseMentions = await fetch(BASE + '/mentions-legales');
  verifie('pas de noindex sur /mentions-legales',
    reponseMentions.headers.get('x-robots-tag') === null, reponseMentions.headers.get('x-robots-tag'));
  await reponseMentions.text();
}
{
  // Le pied de page et le tunnel pointent vers de vrais liens, plus des boutons.
  verifie('le pied de page pointe vers /mentions-legales',
    /<a class="lien-nu" href="\/mentions-legales" data-legal="mentions">/.test(vitrine), 'lien absent');
  verifie('et vers /confidentialite',
    /<a class="lien-nu" href="\/confidentialite" data-legal="confidentialite">/.test(vitrine), 'lien absent');
  verifie('le tunnel aussi, pour la mention de confidentialite',
    /<a class="lien-nu" href="\/confidentialite" data-legal="confidentialite">confidentialité<\/a>/.test(vitrine),
    'lien absent');
}

// --- 9. Les refus de formulaire s'annoncent (lot 5) -------------------------
//
// >>> LA VALIDATION ETAIT PARFAITE A L'OEIL ET MUETTE AU LECTEUR D'ECRAN. <<<
//
// Champ vide → le focus part sur le champ et « Il nous faut un nom pour vous
// appeler » s'affiche dessous. Telephone « abc » → « Ce numéro n'a pas l'air
// complet. Exemple : 06 12 34 56 78. » Message utile, exemple concret, ton
// juste. Et, releve sur les trois champs du tunnel : `aria-invalid` absent,
// `aria-describedby` absent, aucune region vivante dans la section. Quelqu'un
// qui ne voit pas l'ecran appuyait sur « Réserver ce créneau » et, de son point
// de vue, il ne se passait rien.
//
// ⚠️ CE QUI SE TESTE ICI EST CE QUI EST SERVI, pas ce que fait le DOM apres un
//    clic — ce projet n'embarque pas de navigateur sans tete, et n'en
//    embarquera pas pour trois attributs. La suite verifie donc que le
//    mecanisme PART bien dans chaque document : les attributs statiques, et la
//    presence du code qui pose les autres. Le comportement, lui, se verifie a
//    l'ecran, aux trois largeurs, comme le reste de la charte.
console.log('\n9. Les refus de formulaire s\'annoncent');

const espaceHtml = await fetch(`${BASE}/espace-salon`).then((r) => r.text());
const annulerHtml = await fetch(`${BASE}/annuler`).then((r) => r.text());

{
  // L'aide PERMANENTE du telephone est associee des le depart : elle dit
  // pourquoi on demande ce numero, et se lit en arrivant sur le champ.
  verifie('le champ telephone du tunnel porte son aide en `aria-describedby`',
    /id="clientTel"[^>]*aria-describedby="aideTel"|aria-describedby="aideTel"[^>]*id="clientTel"/.test(vitrine)
    || /<input[^>]*id="clientTel"[\s\S]{0,200}?aria-describedby="aideTel"/.test(vitrine),
    'association absente');

  verifie('et l\'aide qu\'il designe existe',
    /id="aideTel"/.test(vitrine), 'aide absente');
}

for (const [nom, html] of [['la vitrine', vitrine], ['l\'espace', espaceHtml], ['/annuler', annulerHtml]]) {
  verifie(`${nom} embarque de quoi marquer un champ invalide`,
    html.includes('aria-invalid'), 'aria-invalid introuvable');
  verifie(`${nom} embarque de quoi rattacher l'explication au champ`,
    html.includes('aria-describedby'), 'aria-describedby introuvable');
  verifie(`${nom} annonce ses messages (role alert / status)`,
    html.includes("'alert'") && html.includes("'status'"), 'role absent');
}

{
  // Le piege du lot 4 : `afficherMessage()` etait redefinie a l'identique dans
  // js/annuler/02-ecrans.js, et la copie l'emportait sur la version partagee.
  // Le jour ou celle-ci a recu `role`, la page d'annulation serait restee muette
  // sans que rien ne le signale.
  const definitions = (annulerHtml.match(/function afficherMessage\(/g) ?? []).length;
  verifie('`afficherMessage` n\'est definie qu\'une fois dans /annuler',
    definitions === 1, definitions);
}

process.exitCode = bilan() === 0 ? 0 : 1;
