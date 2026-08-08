// ---------------------------------------------------------------------------
// TESTS DE L'API DES REGLAGES
//
// Le serveur doit tourner AVANT de lancer ces tests. Dans deux terminaux :
//     npm start               (terminal 1, laisse ouvert)
//     npm run test:settings   (terminal 2)
//
// Les tests prennent une photo des reglages au demarrage et la remettent en
// place a la fin : la base retrouve son etat initial, meme en cas d'echec.
// ---------------------------------------------------------------------------

import {
  BASE,
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  sectionServie,
  avisServis,
} from './helpers.mjs';

import { prisma } from '../src/db.js';
import { purgeOldBookings, dateLimite, CONSERVATION_MOIS } from '../src/lib/retention.js';
import { dessinerPlan, trouverPlan } from '../src/lib/plan.js';

const { verifie, bilan } = creerVerificateur();

/** Meme calcul que src/lib/time.js, redit ici pour ne rien importer de plus. */
const addJours = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** La page d'accueil telle qu'elle part sur le reseau, sans passer par un navigateur. */
async function lirePage() {
  const reponse = await fetch(BASE + '/');
  return reponse.text();
}


/**
 * Les donnees structurees extraites de la page, ou null si elles sont illisibles.
 * La balise porte d'autres attributs (le nonce de la politique de contenu) :
 * on ne peut donc pas la chercher a l'identique.
 */
function donneesStructurees(page) {
  const bloc = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(page);
  if (!bloc) return null;
  try {
    return JSON.parse(bloc[1]);
  } catch {
    return null;
  }
}

/** Les jours d'ouverture annonces par la fiche, une pause pouvant en dedoubler un. */
function joursOuverts(fiche) {
  const jours = new Set();
  for (const spec of [].concat(fiche?.openingHoursSpecification ?? [])) {
    for (const jour of [].concat(spec.dayOfWeek ?? [])) jours.add(jour);
  }
  return [...jours].sort();
}

const visiteur = creerClient();
const salon = await clientConnecte();

/** Copie profonde, pour modifier un brouillon sans toucher a la photo d'origine. */
const copie = (o) => JSON.parse(JSON.stringify(o));

const JOUR = prochainJourOuvert();

// --- Photo de depart ------------------------------------------------------

const depart = await salon.appel('GET', '/api/admin/settings');
if (depart.status !== 200) {
  console.error('Impossible de lire les reglages. Le serveur tourne-t-il ?', depart);
  await supprimerCompteDeTest();
  process.exit(1);
}
const ORIGINE = copie(depart.donnees);

async function restaurer() {
  return salon.appel('PUT', '/api/admin/settings', { ...ORIGINE, confirmRemovals: true });
}

try {
  // --- 1. Lecture publique ------------------------------------------------
  console.log('1. Lecture publique');
  {
    const r = await visiteur.appel('GET', '/api/config');
    verifie('les reglages publics sont lisibles sans connexion', r.status === 200, r.status);
    verifie('la forme reprend celle de CONFIG',
      Boolean(r.donnees?.salon?.name && r.donnees?.hours && Array.isArray(r.donnees?.services)),
      Object.keys(r.donnees ?? {}));
    verifie('les horaires couvrent les 7 jours',
      [0, 1, 2, 3, 4, 5, 6].every((j) => j in r.donnees.hours));
    verifie('les prix sont en euros, pas en centimes',
      r.donnees.services.every((s) => s.price < 1000), r.donnees.services.map((s) => s.price));
  }

  // --- 2. Les reglages ne sont pas modifiables sans connexion -------------
  console.log('\n2. Verrou de l\'espace commercant');
  {
    const r = await visiteur.appel('GET', '/api/admin/settings');
    verifie('lire les reglages complets sans connexion est refuse', r.status === 401, r.status);
  }
  {
    const brouillon = copie(ORIGINE);
    brouillon.salon.name = 'Salon pirate';
    const r = await visiteur.appel('PUT', '/api/admin/settings', brouillon);
    verifie('les modifier sans connexion est refuse', r.status === 401, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/admin/settings/reset', {});
    verifie('les reinitialiser sans connexion est refuse', r.status === 401, r.status);
  }
  {
    const r = await visiteur.appel('GET', '/api/config');
    verifie('le nom du commerce est intact', r.donnees.salon.name === ORIGINE.salon.name, r.donnees.salon.name);
  }

  // --- 3. Refus des reglages incoherents ----------------------------------
  console.log('\n3. Refus des reglages incoherents');

  const cas = [
    ['nom du commerce vide', (d) => { d.salon.name = ''; }],
    ['adresse incomplete', (d) => { d.salon.city = ''; }],
    ['email sans arobase', (d) => { d.salon.email = 'contact.studio.fr'; }],
    ['note superieure a 5', (d) => { d.reviews.rating = 7; }],
    ['note negative', (d) => { d.reviews.rating = -1; }],
    ['aucune prestation', (d) => { d.services = []; }],
    ['aucune prestation proposee en ligne', (d) => { d.services.forEach((s) => { s.active = false; }); }],
    ['prestation sans nom', (d) => { d.services[0].name = ''; }],
    ['duree nulle', (d) => { d.services[0].duration = 0; }],
    ['tarif negatif', (d) => { d.services[0].price = -5; }],
    ['ferme toute la semaine', (d) => { for (let j = 0; j < 7; j++) d.hours[j] = null; }],
    ['ouverture apres fermeture', (d) => { d.hours[2] = { open: '19:00', close: '09:00', pause: null }; }],
    ['pause hors des horaires', (d) => { d.hours[2] = { open: '09:30', close: '18:30', pause: ['08:00', '09:00'] }; }],
    ["pause a l'envers", (d) => { d.hours[2] = { open: '09:30', close: '18:30', pause: ['15:00', '13:00'] }; }],
    ['duree depassant la plus longue plage', (d) => { d.services[0].duration = 600; }],
  ];

  for (const [titre, modifier] of cas) {
    const brouillon = copie(ORIGINE);
    modifier(brouillon);
    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie(titre + ' : refuse', r.status === 400 && Boolean(r.donnees?.error), r);
  }

  {
    const r = await salon.appel('GET', '/api/admin/settings');
    verifie("aucun refus n'a modifie la base",
      r.donnees.salon.name === ORIGINE.salon.name && r.donnees.services.length === ORIGINE.services.length,
      { nom: r.donnees.salon.name, prestations: r.donnees.services.length });
  }

  // --- 4. Enregistrement valide -------------------------------------------
  console.log('\n4. Enregistrement valide');
  {
    const brouillon = copie(ORIGINE);
    brouillon.salon.phone = '03 27 11 22 33';
    brouillon.reviews.rating = 4.7;
    brouillon.services[0].price = 32.5;          // tarif a virgule
    brouillon.hours[3] = { open: '10:00', close: '19:00', pause: null };  // mercredi sans pause

    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('les reglages sont acceptes', r.status === 200, r);
    verifie('le telephone est enregistre', r.donnees?.salon?.phone === '03 27 11 22 33', r.donnees?.salon?.phone);
    verifie('la note est enregistree', r.donnees?.reviews?.rating === 4.7, r.donnees?.reviews?.rating);
    verifie("le tarif a virgule survit a l'aller-retour", r.donnees?.services?.[0]?.price === 32.5, r.donnees?.services?.[0]?.price);
    verifie('la journee sans pause est enregistree', r.donnees?.hours?.[3]?.pause === null, r.donnees?.hours?.[3]);
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('les creneaux suivent les nouveaux horaires', r.status === 200 && r.donnees.slots.length > 0);
  }

  // --- 5. Mise en pause ---------------------------------------------------
  console.log("\n5. Mise en pause d'une prestation");
  {
    const brouillon = copie(ORIGINE);
    // Designee par son identifiant, et non par sa position : le catalogue
    // d'origine compte desormais plusieurs dizaines de prestations rangees par
    // rayon, et `services[2]` n'est plus le Soin Reparateur.
    brouillon.services.find((s) => s.id === 'soin-visage').active = false;
    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la mise en pause est acceptee', r.status === 200, r);
  }
  {
    const publique = await visiteur.appel('GET', '/api/config');
    verifie('la prestation en pause disparait du site',
      !publique.donnees.services.some((s) => s.id === 'soin-visage'),
      publique.donnees.services.map((s) => s.id));

    const admin = await salon.appel('GET', '/api/admin/settings');
    verifie('elle reste visible par le commercant',
      admin.donnees.services.some((s) => s.id === 'soin-visage' && s.active === false));
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=soin-visage`);
    verifie("elle n'est plus reservable en ligne", r.status === 409, r);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: 630, serviceId: 'soin-visage', name: 'Test', phone: '0600000000',
    });
    verifie('une reservation en ligne dessus est refusee', r.status === 409, r);
  }

  // --- 6. Suppression d'une prestation qui porte des rendez-vous ----------
  console.log("\n6. Suppression d'une prestation attendue");

  let idRdv = null;
  {
    const brouillon = copie(ORIGINE);
    brouillon.services.push({
      id: 'svc-temporaire', name: 'Prestation de test', desc: 'temporaire',
      duration: 30, price: 10, active: true,
    });
    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la prestation temporaire est creee',
      r.status === 200 && r.donnees.services.some((s) => s.id === 'svc-temporaire'), r.status);
  }
  {
    const creneaux = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=svc-temporaire`);
    const libre = creneaux.donnees.slots.find((c) => c.free);
    const r = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: libre.start, serviceId: 'svc-temporaire', name: 'Cliente test', phone: '0600000000',
    });
    verifie('un rendez-vous est pris dessus', r.status === 201, r);
    idRdv = r.donnees?.id;
  }
  {
    const admin = await salon.appel('GET', '/api/admin/settings');
    const temporaire = admin.donnees.services.find((s) => s.id === 'svc-temporaire');
    verifie('le commercant voit le nombre de rendez-vous a venir', temporaire?.upcoming === 1, temporaire?.upcoming);
  }
  {
    const brouillon = copie(ORIGINE);   // sans la prestation temporaire
    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la suppression demande confirmation',
      r.status === 409 && r.donnees?.needsConfirmation === true, r);
    verifie('la prestation menacee est nommee',
      r.donnees?.removals?.some((s) => s.id === 'svc-temporaire' && s.upcoming === 1), r.donnees?.removals);
  }
  {
    const admin = await salon.appel('GET', '/api/admin/settings');
    verifie("rien n'a ete supprime tant que ce n'est pas confirme",
      admin.donnees.services.some((s) => s.id === 'svc-temporaire'));
  }
  {
    const brouillon = copie(ORIGINE);
    brouillon.confirmRemovals = true;
    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la suppression confirmee aboutit',
      r.status === 200 && !r.donnees.services.some((s) => s.id === 'svc-temporaire'), r.status);
  }
  {
    const r = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
    const rdv = r.donnees.bookings.find((b) => b.id === idRdv);
    verifie('le rendez-vous survit a la suppression de sa prestation', Boolean(rdv), idRdv);
    verifie('il a perdu son lien vers la prestation (« Prestation retirée »)',
      rdv && rdv.serviceId === null, rdv?.serviceId);
    verifie('il garde la duree convenue', rdv?.duration === 30, rdv?.duration);
  }

  // --- 7. Retour aux valeurs d'origine ------------------------------------
  console.log("\n7. Retour aux valeurs d'origine");
  {
    await salon.appel('DELETE', `/api/admin/bookings/${idRdv}`);
    const r = await salon.appel('POST', '/api/admin/settings/reset', { confirmRemovals: true });
    verifie('la reinitialisation aboutit', r.status === 200, r.status);
    verifie("le nom d'origine est revenu", r.donnees?.salon?.name === "L'Établi", r.donnees?.salon?.name);
    // Comparees a l'etat de depart plutot qu'a un nombre ecrit en dur : le
    // catalogue d'origine change d'un client a l'autre (src/lib/defaults.js).
    verifie("les prestations d'origine sont revenues",
      r.donnees?.services?.length === ORIGINE.services.length, r.donnees?.services?.length);
    verifie('toutes sont de nouveau proposees', r.donnees?.services?.every((s) => s.active));
    verifie("les categories d'origine aussi",
      r.donnees?.categories?.length === ORIGINE.categories.length, r.donnees?.categories?.length);
  }
  // --- 8. En-tetes de securite --------------------------------------------
  //
  // Ces consignes accompagnent chaque reponse. Les verifier ici evite qu'elles
  // disparaissent sans bruit : une CSP absente ne casse rien, elle protege
  // simplement de moins en moins.
  console.log('\n8. En-tetes de securite');
  {
    const reponse = await fetch(BASE + '/');
    const csp = reponse.headers.get('content-security-policy') ?? '';

    verifie('la politique de contenu est posee', csp.length > 0, csp);
    verifie("les scripts exterieurs sont refuses", csp.includes("script-src 'self'"), csp);
    // Ce qui protege vraiment, c'est le nonce : un script injecte ne peut pas
    // deviner le numero du jour. `'unsafe-inline'` l'accompagne desormais, mais
    // un navigateur qui comprend les nonces DOIT l'ignorer (CSP niveau 2) — il
    // ne sert qu'aux navigateurs trop anciens, qui sans lui n'executeraient
    // rien du tout. C'est donc la presence du nonce qu'il faut verifier ici,
    // et le fait qu'il change a chaque reponse.
    verifie('les scripts sont reconnus a un nonce',
      /script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/.test(csp), csp);
    verifie("le site ne peut pas etre affiche dans un cadre",
      csp.includes("frame-ancestors 'none'"), csp);
    verifie("les ecritures de HTML passent par une politique declaree",
      csp.includes("require-trusted-types-for 'script'")
      && csp.includes('trusted-types default'), csp);
    // Les polices sont servies par le site lui-meme (public/fonts/). Plus aucune
    // adresse exterieure n'a de raison d'etre autorisee : on verifie donc
    // l'inverse de ce que ce test verifiait avant, a savoir qu'il n'en reste
    // aucune. Une adresse exterieure qui reapparaitrait ici serait soit un
    // oubli, soit une dependance qu'on ne s'est pas vu ajouter.
    verifie('aucune adresse exterieure n\'est autorisee',
      !csp.includes('http://') && !csp.includes('https://'), csp);
    verifie('les polices ne viennent que du site',
      csp.includes("font-src 'self'"), csp);

    verifie('le type annonce fait foi',
      reponse.headers.get('x-content-type-options') === 'nosniff');
    verifie("l'affichage en cadre est refuse aussi par l'ancien en-tete",
      reponse.headers.get('x-frame-options') === 'DENY');
    verifie("l'adresse des pages ne fuit pas vers l'exterieur",
      reponse.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
    verifie('position, micro et camera sont refuses',
      (reponse.headers.get('permissions-policy') ?? '').includes('geolocation=()'));
    verifie("une page tierce ne partage pas notre contexte de fenetre",
      reponse.headers.get('cross-origin-opener-policy') === 'same-origin');

    // HSTS n'a de sens qu'en ligne : pose en local, il rendrait http://localhost
    // inaccessible dans le navigateur, durablement et pour tous les projets.
    verifie('HSTS reste eteint hors production',
      reponse.headers.get('strict-transport-security') === null,
      reponse.headers.get('strict-transport-security'));

    const page = await reponse.text();
    const balises = page.match(/<script[^>]*>/g) ?? [];
    const numero = /nonce-([^']+)'/.exec(csp)?.[1];
    verifie('chaque balise script porte le numero du jour',
      balises.length > 0 && balises.every((b) => b.includes(`nonce="${numero}"`)), balises);

    const seconde = await fetch(BASE + '/');
    const autreNumero = /nonce-([^']+)'/.exec(seconde.headers.get('content-security-policy'))?.[1];
    verifie('le numero change a chaque visite', numero !== autreNumero, { numero, autreNumero });
  }
  {
    const reponse = await fetch(BASE + '/api/config');
    verifie('les reponses de l\'API portent aussi ces en-tetes',
      reponse.headers.get('x-content-type-options') === 'nosniff');
  }

  // --- 9. Le mode demonstration est bien eteint ---------------------------
  //
  // Ces tests tournent sur une instance ordinaire, donc DEMO_MODE absent. Ils
  // verifient qu'aucune trace de la vitrine de demonstration ne subsiste chez
  // un vrai client : y publier un compte d'acces reviendrait a ouvrir a tous
  // l'agenda de ses clientes.
  console.log('\n9. Le mode demonstration est bien eteint');
  {
    const r = await visiteur.appel('GET', '/api/config');
    verifie('aucun identifiant de demonstration n\'est publie',
      r.donnees.demo === undefined, r.donnees.demo);
  }
  {
    const r = await salon.appel('POST', '/api/admin/demo/reset');
    verifie('la remise a zero de demonstration n\'existe pas', r.status === 404, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/admin/login',
      { username: 'demo', password: 'demonstration' });
    verifie('le compte de demonstration n\'existe pas', r.status === 401, r.status);
  }
  {
    // Le site d'un client doit etre indexe : c'est tout l'interet d'en avoir un.
    // Seule la vitrine de demonstration se retire des moteurs de recherche, et
    // elle le fait par un en-tete, pose sur chaque reponse.
    const reponse = await fetch(BASE + '/');
    verifie('le site d\'un client reste indexable',
      reponse.headers.get('x-robots-tag') === null, reponse.headers.get('x-robots-tag'));
    await reponse.text();
  }
  {
    const reponse = await fetch(BASE + '/robots.txt');
    const contenu = await reponse.text();
    verifie('robots.txt est servi et n\'interdit rien',
      reponse.status === 200 && contenu.includes('Allow: /') && !contenu.includes('Disallow'),
      contenu);
  }

  // --- 10. La page servie suit les reglages -------------------------------
  //
  // L'en-tete de la page (titre, description, donnees structurees) est produit
  // par le serveur : c'est ce que lisent les moteurs de recherche et les
  // apercus de lien, qui n'executent pas forcement le JavaScript de la page.
  console.log('\n10. La page servie suit les reglages');
  {
    const page = await lirePage();
    verifie('la page est servie', page.length > 1000, page.length);
    verifie("les marqueurs d'injection n'apparaissent pas en double",
      page.split('<!--@reglages-->').length === 2, page.split('<!--@reglages-->').length - 1);

    // Le recollage des morceaux de src/page/ (voir src/lib/assemblage.js).
    //
    // Ces trois verifications sont le filet du decoupage : un appel `@inclure`
    // mal ecrit laisserait un trou dans la page sans que rien ne le dise, et un
    // commentaire de maintenance non referme partirait chez le visiteur avec
    // toute l'explication qu'il porte. Le second cas est arrive au premier
    // essai, et c'est ce test-ci qui l'a signale.
    verifie('tous les appels @inclure ont ete resolus',
      !page.includes('@inclure'), page.includes('@inclure'));
    verifie('aucun commentaire de maintenance ne part chez le visiteur',
      !page.includes('<!--#'), page.includes('<!--#'));
    verifie('la page recollee est complete',
      page.startsWith('<!DOCTYPE html>') && page.trimEnd().endsWith('</html>')
        && page.split('<script').length - 1 === 2,
      page.slice(0, 40));

    const fiche = donneesStructurees(page);
    verifie('les donnees structurees sont un JSON valide', Boolean(fiche), fiche);
    verifie('le nom du commerce y figure', fiche?.name === ORIGINE.salon.name, fiche?.name);
    verifie('le telephone aussi', fiche?.telephone === ORIGINE.salon.phone, fiche?.telephone);
    verifie('la ville aussi', fiche?.address?.addressLocality === ORIGINE.salon.city,
      fiche?.address?.addressLocality);

    const joursAttendus = [0, 1, 2, 3, 4, 5, 6]
      .filter((j) => ORIGINE.hours[j])
      .map((j) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][j])
      .sort();
    verifie('les jours d\'ouverture correspondent',
      joursOuverts(fiche).join(',') === joursAttendus.join(','), joursOuverts(fiche));

    const avecPause = [0, 1, 2, 3, 4, 5, 6].some((j) => ORIGINE.hours[j]?.pause);
    verifie('une pause dejeuner donne deux plages, pas une journee continue',
      !avecPause || [].concat(fiche.openingHoursSpecification).length >= 2,
      fiche.openingHoursSpecification);
  }
  {
    // Le test qui compte : le commercant demenage, la fiche suit.
    const brouillon = copie(ORIGINE);
    brouillon.salon.city = 'Valenciennes';
    brouillon.salon.street = '3 place du Marche';
    brouillon.reviews.count = 7;

    const enregistre = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('le demenagement est enregistre', enregistre.status === 200, enregistre.status);

    const page = await lirePage();
    const fiche = donneesStructurees(page);
    verifie('la fiche servie annonce la nouvelle ville',
      fiche?.address?.addressLocality === 'Valenciennes', fiche?.address?.addressLocality);
    verifie('et la nouvelle rue', fiche?.address?.streetAddress === '3 place du Marche',
      fiche?.address?.streetAddress);
    verifie('le titre de la page suit aussi',
      /<title>[^<]*Valenciennes[^<]*<\/title>/.test(page),
      page.match(/<title>[^<]*<\/title>/)?.[0]);
    verifie('la description suit aussi', page.includes('barbier à Valenciennes'));

    await restaurer();
    const revenue = donneesStructurees(await lirePage());
    verifie('et revient en arriere avec les reglages',
      revenue?.address?.addressLocality === ORIGINE.salon.city, revenue?.address?.addressLocality);
  }
  {
    // LA NOTE N'EST JAMAIS PUBLIEE EN DONNEES STRUCTUREES, quelle qu'elle soit.
    //
    // Google ignore depuis 2019 les avis qu'un commerce se decerne a lui-meme
    // sur son propre site : une note posee la n'aurait aucun effet sur les
    // resultats de recherche, et exposerait a un avertissement dans la Search
    // Console. Elle reste affichee sur la vitrine, ou elle rassure — c'est son
    // seul role. Voir src/lib/page.js.
    const avecAvis = donneesStructurees(await lirePage());
    verifie('la note n\'est pas publiee en donnees structurees',
      avecAvis?.aggregateRating === undefined, avecAvis?.aggregateRating);
    // Ce commerce-ci n'a AUCUNE note, et c'est volontaire : il n'existe pas,
    // il n'a donc pas de fiche Google, et inventer « 4,9 sur 120 avis » sur une
    // demonstration serait un chiffre faux affiche en grand (voir
    // src/lib/defaults.js). On verifie donc que le champ existe et se transporte,
    // pas qu'il porte une valeur.
    verifie('le champ existe et se transporte',
      typeof ORIGINE.reviews?.count === 'number' && typeof ORIGINE.reviews?.rating === 'number',
      ORIGINE.reviews);

    const brouillon = copie(ORIGINE);
    brouillon.reviews.count = 0;
    await salon.appel('PUT', '/api/admin/settings', brouillon);

    const fiche = donneesStructurees(await lirePage());
    verifie('sans aucun avis non plus', fiche?.aggregateRating === undefined,
      fiche?.aggregateRating);

    await restaurer();
  }
  {
    // Les liens du commerce : `sameAs` est ce qui relie ce site a la fiche
    // Google Business Profile du salon — le signal le plus utile de tout le
    // bloc pour un commerce local.
    const brouillon = copie(ORIGINE);
    brouillon.salon.links = {
      google: 'https://maps.app.goo.gl/exemple',
      instagram: 'instagram.com/studio-cassandre',   // sans protocole, exprès
      facebook: '',
    };
    const enregistre = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('les liens du salon sont enregistres', enregistre.status === 200, enregistre.status);
    verifie('une adresse tapee sans https:// est completee, pas refusee',
      enregistre.donnees?.salon?.links?.instagram === 'https://instagram.com/studio-cassandre',
      enregistre.donnees?.salon?.links?.instagram);

    const fiche = donneesStructurees(await lirePage());
    verifie('la fiche Google est publiee en sameAs',
      [].concat(fiche?.sameAs || []).includes('https://maps.app.goo.gl/exemple'), fiche?.sameAs);
    verifie('un lien vide n\'y figure pas',
      [].concat(fiche?.sameAs || []).length === 2, fiche?.sameAs);

    const publique = await visiteur.appel('GET', '/api/config');
    verifie('le site public recoit les liens',
      publique.donnees?.salon?.links?.google === 'https://maps.app.goo.gl/exemple',
      publique.donnees?.salon?.links);

    // Ces adresses deviennent des `href` sur la vitrine : un « javascript: »
    // colle dans le champ Instagram ferait executer du code chez le visiteur
    // qui cliquerait dessus. Le serveur est le seul controle incontournable.
    const piege = copie(ORIGINE);
    piege.salon.links = { google: 'javascript:alert(1)', instagram: '', facebook: '' };
    const refus = await salon.appel('PUT', '/api/admin/settings', piege);
    verifie('une adresse qui n\'est pas http(s) est refusee', refus.status === 400, refus.status);

    // Aucun lien saisi : la cle `sameAs` ne doit pas exister du tout, plutot
    // que d'exister vide.
    //
    // ⚠️ L'ETAT EST POSE EXPLICITEMENT, pas obtenu par `restaurer()`. Ce test
    //    reposait sur le fait que les reglages livres n'avaient aucun lien —
    //    il verifiait donc une valeur de defaults.js autant que le
    //    comportement du code, et il a casse le jour ou la demonstration s'est
    //    vu attribuer une fiche Google. Ce qu'on veut savoir ici est « sans
    //    lien, pas de sameAs » : autant le dire.
    const sansLien = copie(ORIGINE);
    sansLien.salon.links = { google: '', instagram: '', facebook: '' };
    await salon.appel('PUT', '/api/admin/settings', sansLien);

    const revenue = donneesStructurees(await lirePage());
    verifie('sans aucun lien, la cle sameAs disparait',
      revenue?.sameAs === undefined, revenue?.sameAs);

    await restaurer();
  }
  {
    // LE CATALOGUE DANS LA PAGE SERVIE.
    //
    // C'est le filet qui rend tenable le second rendu de src/lib/catalogue.js :
    // il refait ce que `hydrateServices()` fait dans la page, et rien n'empeche
    // les deux de diverger — sauf ceci. On ne compare pas le balisage caractere
    // par caractere (il changera), mais le CONTRAT : tout ce qui est propose
    // doit etre lisible sans executer une ligne de JavaScript.
    const page = await lirePage();
    const section = sectionServie(page);
    verifie('la section des prestations est bien injectee', section.length > 500, section.length);

    // Les noms traversent `esc()` avant d'etre poses dans la page : « Coupe &
    // Brushing » y devient « Coupe &amp; Brushing ». On cherche donc la forme
    // echappee — c'est bien elle qui doit s'y trouver.
    const esc = (t) => String(t)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

    const manquantes = ORIGINE.services
      .filter((s) => s.active !== false)
      .filter((s) => !section.includes(`>${esc(s.name)}<`));
    verifie('chaque prestation proposee figure dans la page servie',
      manquantes.length === 0, manquantes.map((s) => s.name));

    const sansTarif = ORIGINE.services
      .filter((s) => s.active !== false)
      .filter((s) => !section.includes(`data-id="${s.id}" data-choix="prestation"`)
        || !section.includes(`data-prix-euros="${s.price}"`));
    verifie('avec son identifiant et son tarif, lisibles sans JavaScript',
      sansTarif.length === 0, sansTarif.map((s) => s.id));

    verifie('les rayons aussi', ORIGINE.categories.every((c) => section.includes(`>${esc(c.name)}<`)),
      ORIGINE.categories.filter((c) => !section.includes(`>${esc(c.name)}<`)).map((c) => c.name));

    verifie("les marqueurs du catalogue n'apparaissent pas en double",
      page.split('<!--@prestations-->').length === 2,
      page.split('<!--@prestations-->').length - 1);
  }
  {
    // Une prestation mise en pause disparait de la vitrine : elle doit donc
    // disparaitre AUSSI de la page servie, sans quoi un moteur continuerait
    // d'annoncer un tarif que le salon ne propose plus.
    const brouillon = copie(ORIGINE);
    const cible = brouillon.services.find((s) => s.active !== false);
    cible.active = false;

    const enregistre = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la mise en pause est enregistree', enregistre.status === 200, enregistre.status);

    const page = await lirePage();
    verifie('une prestation en pause sort de la page servie',
      !sectionServie(page).includes(`data-id="${cible.id}" data-choix="prestation"`), cible.name);

    await restaurer();
    const revenue = await lirePage();
    verifie('et revient quand on la rallume',
      sectionServie(revenue).includes(`data-id="${cible.id}" data-choix="prestation"`), cible.name);
  }
  {
    // Un renommage doit se voir dans la page servie sans redemarrage : c'est
    // toute la raison d'engendrer cette section plutot que de l'ecrire.
    const brouillon = copie(ORIGINE);
    brouillon.services[0].name = 'Coupe Signature Test';
    brouillon.services[0].price = 41;

    await salon.appel('PUT', '/api/admin/settings', brouillon);

    const section = sectionServie(await lirePage());
    verifie('un changement de nom se voit dans la page servie',
      section.includes('>Coupe Signature Test<'), null);
    verifie('un changement de tarif aussi',
      section.includes('data-prix-euros="41"') && section.includes('>41 €<'), null);

    await restaurer();
    verifie('et repart avec les reglages d\'origine',
      !sectionServie(await lirePage()).includes('Coupe Signature Test'), null);
  }
  {
    // Le plan du site. Il n'est servi qu'avec PUBLIC_URL : un plan de site ne
    // porte que des adresses absolues, et le serveur ne devine pas la sienne.
    // Sans elle, une 404 est la reponse juste — et robots.txt ne doit alors
    // annoncer aucun plan, pour ne pas envoyer un robot dans le vide.
    const plan = await fetch(BASE + '/sitemap.xml');
    const robots = await (await fetch(BASE + '/robots.txt')).text();

    if (plan.status === 200) {
      const xml = await plan.text();
      verifie('le plan du site est un XML de sitemap',
        xml.includes('<urlset') && xml.includes('<loc>'), xml.slice(0, 120));
      verifie('robots.txt annonce le plan du site', robots.includes('Sitemap:'), robots);
    } else {
      await plan.text();
      verifie('sans PUBLIC_URL, le plan du site n\'existe pas', plan.status === 404, plan.status);
      verifie('et robots.txt n\'en annonce aucun', !robots.includes('Sitemap:'), robots);
    }
  }
  // --- 10 bis. Les photos de la vitrine -----------------------------------
  //
  // Elles ne vivent pas dans la base mais sur le disque, avec trois etages :
  // photo deposee par le commercant, sinon photo livree avec le site, sinon
  // rien. Ce bloc verifie les trois, plus les refus (emplacement invente,
  // format douteux, visiteur non connecte).
  console.log('\n10 bis. Photos de la vitrine');
  {
    // Le plus petit JPEG valable : 1 pixel. On ne cherche pas a eprouver la
    // reduction — elle a lieu dans le navigateur — mais l'aller-retour.
    const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ'
      + 'CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABA'
      + 'AAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

    const avant = await visiteur.appel('GET', '/api/config');
    verifie('le site recoit la liste des photos',
      avant.donnees.photos && typeof avant.donnees.photos === 'object', avant.donnees.photos);
    // Les photos livrees sont dans le depot : elles doivent deja etre la.
    verifie('les photos livrees avec le site sont annoncees',
      avant.donnees.photos?.hero?.source === 'livree', avant.donnees.photos?.hero);

    const livree = await fetch(BASE + '/photos/hero.jpg');
    verifie('et elles sont servies', livree.status === 200
      && livree.headers.get('content-type')?.includes('jpeg'), livree.status);
    await livree.arrayBuffer();

    // Un visiteur ne depose rien : ce serait afficher ce qu'il veut sur la
    // vitrine de quelqu'un d'autre.
    const intrus = await visiteur.appel('PUT', '/api/admin/photos/hero', { data: PHOTO });
    verifie('un visiteur ne peut pas deposer de photo', intrus.status === 401, intrus.status);

    // Un nom d'emplacement invente est refuse — en particulier s'il tente de
    // remonter dans l'arborescence.
    const ailleurs = await salon.appel('PUT', '/api/admin/photos/..%2F..%2F.env', { data: PHOTO });
    verifie('un emplacement inconnu est refuse', ailleurs.status === 400 || ailleurs.status === 404,
      ailleurs.status);

    const svg = await salon.appel('PUT', '/api/admin/photos/galerie-1',
      { data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    verifie('un format non accepte est refuse', svg.status === 400, svg.status);

    // Le depot lui-meme.
    const depot = await salon.appel('PUT', '/api/admin/photos/galerie-1', { data: PHOTO });
    verifie('le salon depose une photo', depot.status === 200, depot.status);
    verifie('elle passe devant celle livree',
      depot.donnees?.photos?.['galerie-1']?.source === 'deposee',
      depot.donnees?.photos?.['galerie-1']);

    const publique = await visiteur.appel('GET', '/api/config');
    const url = publique.donnees.photos['galerie-1'].url;
    verifie('l\'adresse porte un numero de version', /\?v=\d+$/.test(url), url);

    const servie = await fetch(BASE + url);
    const octets = await servie.arrayBuffer();
    verifie('la photo deposee est bien celle qui est servie',
      servie.status === 200 && octets.byteLength === Buffer.from(PHOTO.split(',')[1], 'base64').length,
      octets.byteLength);
    verifie('elle est mise en cache pour longtemps',
      servie.headers.get('cache-control')?.includes('immutable'),
      servie.headers.get('cache-control'));

    // Le retrait ne laisse pas un trou : on retombe sur la photo livree.
    const retrait = await salon.appel('DELETE', '/api/admin/photos/galerie-1');
    verifie('la photo deposee se retire', retrait.status === 200, retrait.status);
    verifie('et celle livree reprend sa place',
      retrait.donnees?.photos?.['galerie-1']?.source === 'livree',
      retrait.donnees?.photos?.['galerie-1']);

    // Retirer deux fois de suite ne doit pas echouer : le resultat voulu est
    // deja atteint.
    const encore = await salon.appel('DELETE', '/api/admin/photos/galerie-1');
    verifie('retirer une photo absente ne casse rien', encore.status === 200, encore.status);
  }

  // --- 10 ter. Legendes de la galerie --------------------------------------
  //
  // Elles etaient ecrites en dur dans le HTML. Un salon qui remplacait la photo
  // « La coupe » par celle de son bac se retrouvait avec une legende qui ment.
  console.log('\n10 ter. Legendes de la galerie');
  {
    const depart = await visiteur.appel('GET', '/api/config');
    verifie('le site recoit les legendes livrees',
      depart.donnees.legendes?.['galerie-1'] === 'La devanture', depart.donnees.legendes);
    verifie("le visuel d'accueil n'en porte pas",
      !('hero' in (depart.donnees.legendes ?? {})), depart.donnees.legendes);

    const anonyme = await visiteur.appel('PUT', '/api/admin/photos/galerie-1/legende', { texte: 'Pirate' });
    verifie('un visiteur ne peut pas la changer', anonyme.status === 401, anonyme.status);

    const ecrite = await salon.appel('PUT', '/api/admin/photos/galerie-1/legende',
      { texte: '  Notre bac à shampooing  ' });
    verifie('le salon l\'enregistre', ecrite.status === 200, ecrite.donnees);
    verifie('les espaces superflus sont retires',
      ecrite.donnees?.legendes?.['galerie-1'] === 'Notre bac à shampooing',
      ecrite.donnees?.legendes?.['galerie-1']);

    const vue = await visiteur.appel('GET', '/api/config');
    verifie('la vitrine la recoit',
      vue.donnees.legendes?.['galerie-1'] === 'Notre bac à shampooing', vue.donnees.legendes);

    // La chaine vide est une valeur valable : « pas de legende sur cette
    // photo », a distinguer de l'absence de reglage, qui rend celle livree.
    const videe = await salon.appel('PUT', '/api/admin/photos/galerie-1/legende', { texte: '' });
    verifie('une legende peut etre volontairement videe',
      videe.status === 200 && videe.donnees?.legendes?.['galerie-1'] === '',
      videe.donnees?.legendes?.['galerie-1']);

    const trop = await salon.appel('PUT', '/api/admin/photos/galerie-1/legende',
      { texte: 'x'.repeat(300) });
    verifie('une legende trop longue est tronquee, pas refusee',
      trop.status === 200 && trop.donnees?.legendes?.['galerie-1']?.length === 60,
      trop.donnees?.legendes?.['galerie-1']?.length);

    const hero = await salon.appel('PUT', '/api/admin/photos/hero/legende', { texte: 'Non' });
    verifie("le visuel d'accueil refuse une legende", hero.status === 400, hero.status);

    const invente = await salon.appel('PUT', '/api/admin/photos/galerie-9/legende', { texte: 'Non' });
    verifie('un emplacement inconnu est refuse', invente.status === 400, invente.status);

    const chemin = await salon.appel('PUT',
      '/api/admin/photos/' + encodeURIComponent('../../.env') + '/legende', { texte: 'Non' });
    verifie('un nom de fichier deguise aussi', chemin.status === 400 || chemin.status === 404, chemin.status);

    // Remise en etat : sans reglage enregistre, on retombe sur la legende
    // livree avec le site, que les autres suites attendent.
    await salon.appel('PUT', '/api/admin/photos/galerie-1/legende', { texte: 'La devanture' });
  }

  // --- 10 quater. Les temoignages -----------------------------------------
  //
  // Ils etaient ecrits en dur dans le HTML : chaque client devait les remplacer
  // a la main. Devenus reglables, ils doivent tenir la meme promesse que le
  // catalogue — figurer dans la PAGE SERVIE, et pas seulement etre peints par
  // le JavaScript une fois /api/config recu. Sans cela, les rendre modifiables
  // aurait ete une regression pour tout lecteur qui n'execute pas de code.
  console.log('\n10 quater. Les temoignages');
  {
    const trois = [
      { id: 'tmo-essai-1', quote: 'Un accueil impeccable, du premier au dernier geste.',
        author: 'Amandine V.', meta: 'Cliente depuis 2019', rating: 5 },
      { id: 'tmo-essai-2', quote: 'Ma couleur tient enfin plus de trois semaines.',
        author: 'Nadia B.', meta: '', rating: 4 },
    ];

    const enregistre = await salon.appel('PUT', '/api/admin/settings',
      { ...ORIGINE, testimonials: trois, confirmRemovals: true });
    verifie('des temoignages s\'enregistrent', enregistre.status === 200, enregistre.donnees);
    verifie('ils reviennent dans l\'ordre saisi',
      enregistre.donnees?.testimonials?.map((t) => t.author).join('|') === 'Amandine V.|Nadia B.',
      enregistre.donnees?.testimonials);

    const publie = await visiteur.appel('GET', '/api/config');
    verifie('le site public les recoit aussi',
      publie.donnees?.testimonials?.length === 2, publie.donnees?.testimonials?.length);

    const page = avisServis(await lirePage());
    verifie('la page servie porte la premiere citation',
      page.includes('Un accueil impeccable, du premier au dernier geste.'));
    verifie('et la seconde', page.includes('Ma couleur tient enfin plus de trois semaines.'));
    verifie('avec le nom de qui l\'a laissee', page.includes('Amandine V.'));
    // La citation est balisee comme une citation, et son auteur comme un auteur.
    // Ce n'est pas de la coquetterie : c'est ce qui permet a un lecteur d'ecran
    // d'annoncer « citation » avant de la lire, au lieu d'enchainer deux
    // paragraphes sans rapport apparent.
    verifie('la citation est balisee comme telle',
      page.includes('<blockquote class="avis-citation">'), page.slice(0, 200));
    verifie('et son auteur aussi', page.includes('<cite>Amandine V.</cite>'));

    // AUCUNE ETOILE, ET C'EST UNE GARANTIE A TENIR. Une note qu'un commerce se
    // decerne sur son propre site n'a aucune valeur (Google les ignore depuis
    // 2019), et sur une demonstration elle serait purement inventee. Le champ
    // `rating` existe toujours en base — ce test verifie qu'il ne ressort pas
    // en etoiles dans la page.
    verifie('aucune etoile n\'est affichee', !page.includes('★'), page.slice(0, 200));

    verifie('le decompte pilote la liste', page.includes('data-nombre="2"'));

    // Le point median ne separe le nom de la precision que lorsqu'il y a une
    // precision : sur les deux temoignages saisis, un seul en porte une.
    verifie('une mention vide n\'affiche pas de separateur orphelin',
      (page.match(/aria-hidden="true">·<\/span>/g) ?? []).length === 1,
      (page.match(/aria-hidden="true">·<\/span>/g) ?? []).length);
    verifie('la section est visible', /id="avis"(?!.{0,40}hidden)/.test(page));

    // Ils ne sont PAS balises en `Review` : Google ecarte les avis qu'un site
    // publie a son propre sujet, et une fiche qui en publierait s'exposerait a
    // un avertissement dans la Search Console pour rien. Meme regle que la note.
    const fiche = donneesStructurees(await lirePage());
    verifie('aucun avis n\'est publie en donnees structurees',
      fiche && !fiche.review && !fiche.aggregateRating, { review: fiche?.review });

    // Le temoignage a moitie rempli : une citation sans nom, ou l'inverse,
    // laisserait une carte bancale sur la page d'accueil.
    const sansNom = await salon.appel('PUT', '/api/admin/settings',
      { ...ORIGINE, testimonials: [{ id: 'tmo-x', quote: 'Superbe.', author: '' }], confirmRemovals: true });
    verifie('un temoignage sans nom est refuse', sansNom.status === 400, sansNom.status);

    const sansTexte = await salon.appel('PUT', '/api/admin/settings',
      { ...ORIGINE, testimonials: [{ id: 'tmo-x', quote: '', author: 'Zoe R.' }], confirmRemovals: true });
    verifie('un temoignage vide aussi', sansTexte.status === 400, sansTexte.status);

    const horsBornes = await salon.appel('PUT', '/api/admin/settings',
      { ...ORIGINE, testimonials: [{ id: 'tmo-x', quote: 'Bien.', author: 'Zoe R.', rating: 9 }], confirmRemovals: true });
    verifie('neuf etoiles sur cinq sont refusees', horsBornes.status === 400, horsBornes.status);

    // AUCUN temoignage est un etat valable — c'est le salon qui vient d'ouvrir —
    // et la section entiere doit alors disparaitre de la page servie, pas
    // seulement se vider.
    const aucun = await salon.appel('PUT', '/api/admin/settings',
      { ...ORIGINE, testimonials: [], confirmRemovals: true });
    verifie('aucun temoignage est accepte', aucun.status === 200, aucun.donnees);

    const pageVide = avisServis(await lirePage());
    verifie('la section se masque alors', pageVide.includes('id="avis" hidden'), pageVide.slice(0, 120));
    verifie('elle reste dans la page, pour pouvoir se remplir sans recharger',
      pageVide.includes('id="avisListe"'));
    verifie('et ne contient plus aucun temoignage', !pageVide.includes('class="avis"'));
  }

  // --- 10 quinquies. Le plan du quartier ----------------------------------
  //
  // Le dessin lui-meme n'est PAS eprouve ici : il demande deux appels a des
  // services publics gratuits (Nominatim et Overpass), regulierement satures.
  // Un test qui en dependrait echouerait un jour sur deux pour une raison
  // etrangere au code. On verifie donc ce qui nous appartient : la route, le
  // cache, le verrou, et le fait qu'aucun plan ne casse jamais rien.
  console.log('\n10 quinquies. Le plan du quartier');
  {
    const publie = await visiteur.appel('GET', '/api/config');
    verifie('le site sait s\'il y a un plan',
      'plan' in (publie.donnees ?? {}), Object.keys(publie.donnees ?? {}));

    const plan = publie.donnees.plan;
    if (plan) {
      const reponse = await fetch(BASE + plan.url);
      verifie('le plan est servi', reponse.status === 200, reponse.status);
      verifie('en SVG', (reponse.headers.get('content-type') ?? '').includes('svg'),
        reponse.headers.get('content-type'));
      // Le numero de version est ce qui autorise le cache d'un an : sans lui,
      // un demenagement laisserait l'ancien plan dans le navigateur des
      // clientes pendant des mois.
      verifie('avec un numero de version', /\?v=\d+/.test(plan.url), plan.url);
      verifie('et un cache d\'un an', (reponse.headers.get('cache-control') ?? '').includes('31536000'),
        reponse.headers.get('cache-control'));

      const sansVersion = await fetch(BASE + '/plan.svg');
      verifie('sans numero de version, on fait revalider',
        (sansVersion.headers.get('cache-control') ?? '').includes('must-revalidate'),
        sansVersion.headers.get('cache-control'));

      const dessin = await reponse.text();
      verifie('le plan est bien un dessin, pas une image importee',
        dessin.startsWith('<svg') && !dessin.includes('<image'), dessin.slice(0, 40));
      // Aucune adresse exterieure dans le fichier : c'est ce qui garantit
      // qu'afficher le plan ne joint personne, donc ne depose aucun cookie.
      verifie('il n\'appelle aucune adresse exterieure',
        !/https?:\/\//.test(dessin.replace('http://www.w3.org/2000/svg', '')),
        dessin.slice(0, 200));
    } else {
      verifie('sans plan, /plan.svg repond 404',
        (await fetch(BASE + '/plan.svg')).status === 404);
    }

    const pirate = await visiteur.appel('POST', '/api/admin/plan', {});
    verifie('redessiner le plan sans connexion est refuse', pirate.status === 401, pirate.status);

    // LE POINT LE PLUS IMPORTANT DE CETTE SECTION.
    //
    // Un plan n'est servi que s'il a ete dessine pour l'adresse actuelle, et la
    // regle vaut pour les deux etages. Sans elle, le plan livre avec le site —
    // celui de Maubeuge, qui n'existe que pour la demonstration — s'afficherait
    // sous l'adresse d'un salon de Lille. Ce ne serait pas une image
    // approximative : ce serait une affirmation fausse, epingle a l'appui.
    //
    // Verifie hors reseau : `trouverPlan()` ne fait que lire des fichiers.
    const ici = ORIGINE.salon;
    const ailleurs = { street: '3 rue de la Barre', postalCode: '69002', city: 'Lyon' };

    verifie('un plan dessine pour cette adresse est servi',
      (await trouverPlan(ici)) !== null, ici);
    verifie("le plan d'une autre adresse ne l'est jamais",
      (await trouverPlan(ailleurs)) === null, await trouverPlan(ailleurs));
    verifie('une adresse vide non plus',
      (await trouverPlan({ street: '', postalCode: '', city: '' })) === null);
    // Le demenagement : tant que le nouveau plan n'est pas dessine, on n'affiche
    // rien plutot que l'ancien quartier. Le fichier reste pourtant sur le disque.
    verifie('un simple changement de rue suffit a l\'ecarter',
      (await trouverPlan({ ...ici, street: ici.street + ' bis' })) === null);
  }

  // --- 10 sexies. Le dessin du plan, sans reseau --------------------------
  //
  // Le seul endroit ou l'on eprouve le dessin lui-meme, et il ne joint
  // personne : `dessinerPlan()` prend des traces deja recuperes. C'est
  // exactement pourquoi elle est exportee a part — voir src/lib/plan.js.
  console.log('\n10 sexies. Le dessin du plan');
  {
    const centre = { lat: 50.2785, lon: 3.9743 };
    // Un dixieme de degre de longitude fait environ 7 km ici : bien au-dela du
    // demi-kilometre dessine. C'est ce qui met la coupure a l'epreuve.
    const loin = { lat: centre.lat + 0.1, lon: centre.lon + 0.1 };

    const svg = dessinerPlan([
      { geometry: [{ lat: centre.lat, lon: centre.lon - 0.002 },
        { lat: centre.lat, lon: centre.lon + 0.002 }], tags: { highway: 'primary' } },
      { geometry: [{ lat: centre.lat - 0.001, lon: centre.lon },
        { lat: centre.lat + 0.001, lon: centre.lon }], tags: { highway: 'residential' } },
      // Un trottoir : volontairement ecarte, sinon un centre-ville devient une
      // pelote de traits ou l'on ne trouve plus sa rue.
      { geometry: [{ lat: centre.lat, lon: centre.lon }, { lat: centre.lat, lon: centre.lon + 0.001 }],
        tags: { highway: 'footway' } },
      // Un parking : `landuse` connu d'Overpass, mais qui poserait une grande
      // tache sans rien apprendre.
      { geometry: [{ lat: centre.lat, lon: centre.lon }, { lat: centre.lat + 0.001, lon: centre.lon },
        { lat: centre.lat + 0.001, lon: centre.lon + 0.001 }], tags: { landuse: 'retail' } },
      // Un parc, lui, se remplit.
      { geometry: [{ lat: centre.lat, lon: centre.lon }, { lat: centre.lat + 0.001, lon: centre.lon },
        { lat: centre.lat + 0.001, lon: centre.lon + 0.001 }], tags: { leisure: 'park' } },
      // Entierement hors cadre : rien ne doit en sortir.
      { geometry: [{ lat: loin.lat, lon: loin.lon }, { lat: loin.lat + 0.001, lon: loin.lon }],
        tags: { highway: 'primary' } },
    ], centre);

    verifie('le dessin ne joint personne', typeof svg === 'string' && svg.startsWith('<svg'));
    verifie('il porte la craie de la charte', svg.includes('#EFEEEA'));
    verifie('une route majeure est plus epaisse qu\'une rue',
      svg.includes('stroke-width="5.5"') && svg.includes('stroke-width="3"'));
    verifie('un trottoir n\'est pas dessine', !svg.includes('stroke-width="1.6"'), svg);
    verifie('un parc est rempli', svg.includes('fill-opacity="0.055"'));
    // Le parking et le parc ont la MEME geometrie : un seul contour rempli
    // prouve que le parking a bien ete ecarte.
    verifie('un parking ne l\'est pas',
      (svg.match(/fill-opacity="0.055"[^>]*>(<path[^>]*>)+/g) ?? []).join('').match(/<path/g)?.length === 1,
      svg);

    const coords = [...svg.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    verifie('rien n\'est dessine loin du cadre',
      coords.every(([x, y]) => x > -500 && x < 1400 && y > -500 && y < 1000), coords);
    verifie('le centre du dessin est le point geocode',
      coords.some(([x, y]) => Math.abs(x - 450) < 2 && Math.abs(y - 250) < 2), coords);
  }

  // --- 11. Conservation des rendez-vous -----------------------------------
  //
  // La page « Données personnelles » annonce que les rendez-vous passes sont
  // supprimes au bout de douze mois. Ces verifications sont ce qui rend cette
  // phrase vraie : une mention legale que le logiciel dement ne protege personne.
  console.log('\n11. Conservation des rendez-vous');
  {
    const vieux = await prisma.booking.create({
      data: {
        kind: 'appt',
        date: addJours(dateLimite(), -1),   // un jour de trop
        startMin: 600, durationMin: 45, serviceId: 'coupe-barbe',
        customerName: 'Cliente Ancienne', customerPhone: '0600000000', source: 'phone',
      },
    });
    const recent = await prisma.booking.create({
      data: {
        kind: 'appt',
        date: addJours(dateLimite(), 1),    // encore dans la duree annoncee
        startMin: 600, durationMin: 45, serviceId: 'coupe-barbe',
        customerName: 'Cliente Recente', customerPhone: '0600000000', source: 'phone',
      },
    });

    verifie('la duree annoncee est bien de 12 mois', CONSERVATION_MOIS === 12, CONSERVATION_MOIS);

    await purgeOldBookings();

    const restentVieux = await prisma.booking.findUnique({ where: { id: vieux.id } });
    const restentRecent = await prisma.booking.findUnique({ where: { id: recent.id } });

    verifie('un rendez-vous trop ancien est supprime', restentVieux === null, restentVieux?.date);
    verifie('un rendez-vous encore dans la duree est conserve',
      restentRecent !== null, recent.date);
    verifie('la suppression est definitive, pas un masquage',
      (await prisma.booking.count({ where: { customerName: 'Cliente Ancienne' } })) === 0);

    await prisma.booking.delete({ where: { id: recent.id } }).catch(() => {});
  }
} finally {
  const r = await restaurer();
  console.log(`\n(reglages restaures : ${r.status === 200 ? 'ok' : 'ECHEC'})`);
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
