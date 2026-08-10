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
  //    pas la legende. « La devanture » sous la photo et « La devanture » dans
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
  verifie('la galerie emploie <figure>', compter(vitrine, 'figure') === 4,
    compter(vitrine, 'figure'));
  verifie('et <figcaption>, qui lie la legende a SON image',
    compter(vitrine, 'figcaption') === 4, compter(vitrine, 'figcaption'));
  verifie('les legendes ne sont plus des <p> orphelins',
    !vitrine.includes('<p class="galerie-legende'), 'balise <p> trouvee');
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
  verifie('le type est celui d\'un barbier, pas d\'un salon de coiffure',
    ld?.['@type'] === 'BarberShop', ld?.['@type']);
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

process.exitCode = bilan() === 0 ? 0 : 1;
