// ---------------------------------------------------------------------------
// TESTS DE L'EQUIPE
//
//     npm start           (terminal 1, laisse ouvert)
//     npm run test:staff  (terminal 2)
//
// Toute la fonctionnalite tient dans une regle : un creneau est libre s'il
// reste AU MOINS UNE personne capable de le prendre. Ce fichier verifie cette
// regle et ses deux consequences delicates :
//
//   - un rendez-vous sans personne attribuee occupe tout le monde ;
//   - le choix de la personne se fait dans la transaction d'enregistrement,
//     donc deux clientes simultanees ne peuvent pas repartir avec la meme.
//
// L'equipe est creee ici puis supprimee a la fin : les autres suites tournent
// sur un commerce sans equipe, et doivent continuer de le faire.
//
// UNE EQUIPE DEJA ENREGISTREE EST MISE DE COTE, PUIS REPOSEE. La base de
// developpement n'est pas jetable : on y saisit une equipe pour voir la vitrine
// vivre, et un `npm test` la faisait disparaitre sans que rien ne le dise (voir
// EQUIPE_AU_DEPART plus bas). Elle est donc relevee au demarrage, effacee le
// temps des tests — la section 1 verifie precisement le comportement d'un
// commerce sans equipe — et remise dans le `finally`.
// ---------------------------------------------------------------------------

import { request as requeteHttp } from 'node:http';

import { prisma } from '../src/db.js';
import {
  BASE,
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  mettreEquipeDeCote,
  reposerEquipe,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

const JOUR = prochainJourOuvert();

/**
 * Un second jour d'ouverture, encore vierge.
 *
 * La section « horaires par personne » en a besoin : JOUR est largement rempli
 * par les sections precedentes, et un creneau occupe ne dit rien de ce qu'on
 * cherche a verifier la.
 */
const JOUR2 = (() => {
  const d = new Date(JOUR + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 1);
  return d.toISOString().slice(0, 10);
})();

/** Les rendez-vous crees par cette suite, effaces a la fin. */
const aNettoyer = [];

/** Reserve en ligne et retient l'identifiant pour le nettoyage. */
async function reserver(corps) {
  const r = await visiteur.appel('POST', '/api/bookings', {
    date: JOUR, serviceId: 'coupe-barbe', name: 'Test equipe', phone: '0600000000', ...corps,
  });
  if (r.donnees?.id) aNettoyer.push(r.donnees.id);
  return r;
}

/**
 * Envoie plusieurs reservations VRAIMENT en meme temps.
 *
 * `fetch` ne convient pas ici : il reutilise une seule connexion vers le
 * serveur et met donc les requetes a la queue leu leu. Les envoyer ainsi ne
 * prouverait rien — chacune verrait l'agenda deja mis a jour par la
 * precedente. On ouvre donc une socket par requete (`agent: false`), ce qui
 * laisse le serveur les traiter en parallele et met reellement l'attribution
 * a l'epreuve.
 */
function reserverEnMemeTemps(nombre, corps) {
  const adresse = new URL(BASE);

  const envoi = () => new Promise((resoudre, rejeter) => {
    const charge = JSON.stringify({
      date: JOUR, serviceId: 'coupe-barbe', name: 'Test equipe', phone: '0600000000', ...corps,
    });

    const requete = requeteHttp({
      hostname: adresse.hostname,
      port: adresse.port,
      path: '/api/bookings',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(charge) },
      agent: false,
    }, (reponse) => {
      let brut = '';
      reponse.on('data', (morceau) => { brut += morceau; });
      reponse.on('end', () => {
        let donnees = null;
        try { donnees = JSON.parse(brut); } catch { /* corps vide */ }
        if (donnees?.id) aNettoyer.push(donnees.id);
        resoudre({ status: reponse.statusCode, donnees });
      });
    });

    requete.on('error', rejeter);
    requete.end(charge);
  });

  return Promise.all(Array.from({ length: nombre }, envoi));
}

/** Le creneau demande, tel que le public le voit. */
async function creneau(startMin, params = '', jour = JOUR) {
  const r = await visiteur.appel('GET', `/api/slots?date=${jour}&serviceId=coupe-barbe${params}`);
  return {
    status: r.status,
    equipe: r.donnees?.staff ?? [],
    slot: (r.donnees?.slots ?? []).find((c) => c.start === startMin),
    slots: r.donnees?.slots ?? [],
  };
}

console.log(`Journee de test : ${JOUR}\n`);

// L'equipe deja enregistree est mise de cote, puis reposee dans le `finally`.
//
// Utile quand cette suite est lancee seule (`npm run test:staff`) : sous
// `npm test`, tests/run.mjs l'a deja fait et il ne reste alors personne a
// relever. Les deux appels ne se genent donc pas.
//
// La section 1 verifie qu'un commerce SANS equipe se comporte exactement comme
// avant que la notion n'existe : ce filet de non-regression ne veut rien dire
// si trois personnes sont deja enregistrees.
await mettreEquipeDeCote(salon);

// L'AGENDA DES DEUX JOURNEES DE TEST EST VIDE AVANT DE COMMENCER.
//
// Cette suite raisonne sur des heures ECRITES EN DUR — « le creneau de 09h30 »,
// « la grille commence a l'ouverture du commerce » — parce que c'est justement
// la grille qu'elle eprouve. Or les rendez-vous de demonstration sont poses sur
// les quatre prochains jours d'ouverture (voir src/lib/demo.js), c'est-a-dire
// exactement la fenetre ou tombent JOUR et JOUR2. Deux d'entre eux occupent
// 09h00 et 09h30.
//
// Sans ce menage, les echecs ne disent rien de ce qu'on croit verifier : ils
// disent « ce creneau etait deja pris », et ils apparaissent ou non selon le
// jour de la semaine ou la suite est lancee. On part donc d'un agenda vide, et
// c'est la suite elle-meme qui le remplit.
//
// Rien a restaurer : ces rendez-vous se regenerent au prochain
// `npm run demo:reset` ou `node prisma/seed.js --force`.
await prisma.booking.deleteMany({ where: { date: { in: [JOUR, JOUR2] } } });

let camille = null;
let sarah = null;

try {
  // --- 1. Sans equipe : rien ne change ------------------------------------
  console.log('1. Sans equipe enregistree');
  {
    const dejaLa = await prisma.staff.count();
    verifie('la base de depart ne contient aucune personne', dejaLa === 0, dejaLa);

    const vue = await creneau(570);
    verifie('les creneaux sont calcules comme avant', vue.status === 200 && Boolean(vue.slot));
    verifie('la liste des personnes est vide', vue.equipe.length === 0, vue.equipe);
    verifie('un creneau ne porte donc personne', vue.slot?.staff.length === 0, vue.slot);
  }

  // --- 2. Mise en place de l'equipe ---------------------------------------
  console.log('\n2. Mise en place de l\'equipe');
  {
    camille = await prisma.staff.create({
      data: { name: 'Camille (test)', role: 'Coloriste', position: 0 },
    });
    sarah = await prisma.staff.create({
      data: { name: 'Sarah (test)', role: 'Styliste', position: 1 },
    });

    const vue = await creneau(570);
    verifie('les deux personnes sont proposees', vue.equipe.length === 2, vue.equipe);
    verifie('aucun lien enregistre = tout le monde assure la prestation',
      vue.slot?.staff.length === 2, vue.slot);
  }

  // --- 3. Un creneau reste libre tant qu'une personne l'est ----------------
  console.log('\n3. Union des disponibilites');
  let heure = null;
  {
    const vue = await creneau(570);
    heure = vue.slots.find((c) => c.free && c.staff.length === 2)?.start;
    verifie('un creneau entierement libre existe', Number.isInteger(heure), heure);

    const premier = await reserver({ start: heure, staffId: camille.id });
    verifie('la reservation nominative aboutit', premier.status === 201, premier.donnees);
    verifie('elle est attribuee a la personne demandee',
      premier.donnees?.staffId === camille.id, premier.donnees?.staffId);

    const apres = await creneau(heure);
    verifie('le creneau reste libre : il reste quelqu\'un', apres.slot?.free === true, apres.slot);
    verifie('et seule l\'autre personne y figure',
      apres.slot?.staff.length === 1 && apres.slot.staff[0] === sarah.id, apres.slot);

    const second = await reserver({ start: heure, staffId: sarah.id });
    verifie('la seconde personne peut prendre le meme creneau', second.status === 201, second.donnees);

    const complet = await creneau(heure);
    verifie('le creneau n\'est libre qu\'une fois tout le monde pris',
      complet.slot?.free === false, complet.slot);
    verifie('plus personne n\'y figure', complet.slot?.staff.length === 0, complet.slot);

    const troisieme = await reserver({ start: heure });
    verifie('une troisieme cliente est refusee', troisieme.status === 409, troisieme.status);
  }

  // --- 4. Un rendez-vous sans personne occupe tout le monde ----------------
  console.log('\n4. Rendez-vous non attribue');
  {
    const vue = await creneau(570);
    const libre = vue.slots.find((c) => c.staff.length === 2);
    verifie('un creneau entierement libre subsiste', Boolean(libre), libre);

    // Un rendez-vous de l'epoque ou le commerce n'avait pas d'equipe.
    const ancien = await prisma.booking.create({
      data: {
        kind: 'appt', date: JOUR, startMin: libre.start, durationMin: 45,
        serviceId: 'coupe-barbe', customerName: 'Heritage (test)', source: 'phone',
      },
    });
    aNettoyer.push(ancien.id);

    const apres = await creneau(libre.start);
    verifie('il bloque le creneau pour toute l\'equipe', apres.slot?.free === false, apres.slot);

    const refuse = await reserver({ start: libre.start });
    verifie('et l\'enregistrement le refuse aussi', refuse.status === 409, refuse.status);
  }

  // --- 5. « Peu importe » : repartition et concurrence ---------------------
  console.log('\n5. Attribution automatique');
  {
    const vue = await creneau(570);
    const libres = vue.slots.filter((c) => c.staff.length === 2);
    verifie('au moins deux creneaux entierement libres restent', libres.length >= 2, libres.length);

    // TROIS clientes cliquent en meme temps sur le meme creneau, sur trois
    // connexions distinctes. Deux personnes sont libres : il doit passer
    // exactement deux reservations, sur deux personnes DIFFERENTES.
    //
    // ATTENTION A CE QUE CE TEST PROUVE. Il a ete verifie en cassant le code
    // exprès — attribution calculee AVANT la transaction — et il est reste
    // vert. La raison : better-sqlite3 est un pilote synchrone, il bloque la
    // boucle d'evenements, et le serveur traite donc les requetes l'une apres
    // l'autre quoi qu'on fasse. Aucun entrelacement n'est possible ici.
    //
    // Le test garde deux utilites : il verifie qu'aucun double rendez-vous ne
    // sort de ce chemin, et il redeviendra un vrai test de concurrence le jour
    // ou la base passera sur un moteur asynchrone (Postgres chez un client a
    // gros volume). L'ecriture "attribution dans la transaction" reste la
    // bonne pour la meme raison : elle ne depend pas du pilote.
    const simultanees = await reserverEnMemeTemps(3, { start: libres[0].start });
    const acceptees = simultanees.filter((r) => r.status === 201);
    const refusees = simultanees.filter((r) => r.status === 409);

    verifie('deux reservations simultanees aboutissent, la troisieme est refusee',
      acceptees.length === 2 && refusees.length === 1,
      simultanees.map((r) => r.status));

    const attribuees = acceptees.map((r) => r.donnees?.staffId);
    verifie('elles ne tombent jamais sur la meme personne',
      attribuees.every(Boolean) && new Set(attribuees).size === acceptees.length,
      attribuees);

    // Verification directe en base : deux rendez-vous au meme instant sur la
    // meme personne ne laisseraient rien voir cote reponses.
    const enBase = await prisma.booking.findMany({
      where: { date: JOUR, startMin: libres[0].start, kind: 'appt' },
    });
    const parPersonne = enBase.map((r) => r.staffId);
    verifie('et la base ne contient aucun doublon sur une meme personne',
      new Set(parPersonne).size === parPersonne.length, parPersonne);
  }

  // --- 6. Qui assure quoi -------------------------------------------------
  console.log('\n6. Prestations assurees');
  {
    const inconnue = await reserver({ start: 570, staffId: 'personne-qui-nexiste-pas' });
    verifie('une personne inventee est refusee', inconnue.status === 404, inconnue.status);

    // La coloration devient l'affaire de Camille seule.
    await prisma.service.update({
      where: { id: 'coupe-rasage' },
      data: { staffLinks: { create: [{ staffId: camille.id }] } },
    });

    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-rasage`);
    verifie('la prestation liee ne propose que la personne designee',
      r.donnees?.staff.length === 1 && r.donnees.staff[0].id === camille.id, r.donnees?.staff);

    const refus = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: 570, serviceId: 'coupe-rasage', staffId: sarah.id,
      name: 'Test equipe', phone: '0600000000',
    });
    verifie('demander quelqu\'un qui ne l\'assure pas est refuse', refus.status === 409, refus.status);

    // La coupe, elle, n'est liee a personne : tout le monde continue.
    const coupe = await creneau(570);
    verifie('une prestation sans lien reste assuree par toute l\'equipe',
      coupe.equipe.length === 2, coupe.equipe);

    await prisma.service.update({
      where: { id: 'coupe-rasage' },
      data: { staffLinks: { deleteMany: {} } },
    });
  }

  // --- 7. Personne en pause -----------------------------------------------
  console.log('\n7. Personne en pause');
  {
    await prisma.staff.update({ where: { id: sarah.id }, data: { active: false } });

    const vue = await creneau(570);
    verifie('elle disparait du site', vue.equipe.length === 1, vue.equipe);

    const refus = await reserver({ start: 570, staffId: sarah.id });
    verifie('le public ne peut plus la demander', refus.status === 409, refus.status);

    const cote = await salon.appel('GET',
      `/api/admin/slots?date=${JOUR}&serviceId=coupe-barbe&staffId=${sarah.id}`);
    verifie('le salon peut toujours consulter ses creneaux', cote.status === 200, cote.status);

    const creneauLibre = (cote.donnees?.slots ?? []).find((c) => c.free);
    const saisie = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: creneauLibre.start, serviceId: 'coupe-barbe',
      staffId: sarah.id, name: 'Saisie salon (test)',
    });
    if (saisie.donnees?.id) aNettoyer.push(saisie.donnees.id);
    verifie('et lui caler un rendez-vous lui-meme',
      saisie.status === 201 && saisie.donnees?.staffId === sarah.id, saisie.donnees);

    await prisma.staff.update({ where: { id: sarah.id }, data: { active: true } });
  }

  // --- 8. Absence d'une personne vs fermeture du commerce -----------------
  console.log('\n8. Absence et fermeture');
  {
    const pose = await salon.appel('POST', '/api/admin/day-block', { date: JOUR, staffId: camille.id });
    if (pose.donnees?.id) aNettoyer.push(pose.donnees.id);
    verifie('l\'absence est enregistree',
      pose.status === 201 && pose.donnees?.staffId === camille.id, pose.donnees);

    const vue = await creneau(570);
    verifie('la journee reste ouverte : l\'autre personne recoit',
      vue.slots.some((c) => c.free), vue.slots.length);
    verifie('l\'absente ne figure sur aucun creneau',
      vue.slots.every((c) => !c.staff.includes(camille.id)), vue.slots.slice(0, 3));

    const jours = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${JOUR}&serviceId=coupe-barbe`);
    verifie('le calendrier ne declare pas la journee complete',
      jours.donnees?.days?.[0]?.state === 'open', jours.donnees?.days?.[0]);

    // Une fermeture du commerce, elle, vaut pour tout le monde.
    const ferme = await salon.appel('POST', '/api/admin/day-block', { date: JOUR });
    if (ferme.donnees?.id) aNettoyer.push(ferme.donnees.id);
    verifie('la fermeture du commerce est distincte de l\'absence',
      ferme.status === 201 && ferme.donnees?.staffId === null, ferme.donnees);

    const apres = await creneau(570);
    verifie('plus aucun creneau n\'est libre', apres.slots.every((c) => !c.free), apres.slots.length);

    const leve = await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
    verifie('lever la fermeture ne retire qu\'elle',
      leve.status === 200 && leve.donnees?.removed === 1, leve.donnees);

    const rouvert = await creneau(570);
    verifie('la journee rouvre pour l\'autre personne',
      rouvert.slots.some((c) => c.free), rouvert.slots.length);
    verifie('mais l\'absence tient toujours',
      rouvert.slots.every((c) => !c.staff.includes(camille.id)), rouvert.slots.slice(0, 3));

    const leveAbsence = await salon.appel('DELETE',
      `/api/admin/day-block?date=${JOUR}&staffId=${camille.id}`);
    verifie('l\'absence se leve nommement',
      leveAbsence.status === 200 && leveAbsence.donnees?.removed === 1, leveAbsence.donnees);
  }

  // --- 9. Ce que le public ne doit pas apprendre --------------------------
  console.log('\n9. Discretion');
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    // Le site n'a besoin ici que de reconnaitre la personne : sa photo, son
    // role, sa couleur, ses horaires et ses rendez-vous n'ont rien a faire dans
    // une reponse dont le seul objet est de dire qui est libre a quelle heure.
    const champs = new Set(Object.keys(r.donnees.staff[0] ?? {}));
    verifie('une personne n\'est exposee que par son identifiant et son nom',
      champs.size === 2 && champs.has('id') && champs.has('name'), [...champs]);

    const brut = JSON.stringify(r.donnees);
    verifie('aucun nom de cliente ne filtre dans les creneaux',
      !brut.includes('Test equipe') && !brut.includes('Heritage'), brut.slice(0, 200));
  }

  // --- 8 bis. Conges sur une periode --------------------------------------
  console.log('\n8 bis. Conges sur une periode');
  {
    // Une semaine entiere, qui contient forcement des jours de fermeture
    // habituelle (le commerce ferme dimanche et lundi) : ils doivent etre
    // sautes sans faire echouer la demande.
    const fin = (() => {
      const d = new Date(JOUR2 + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().slice(0, 10);
    })();

    const pose = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR2, to: fin, staffId: sarah.id });
    verifie('la periode est posee', pose.status === 201, pose.status);
    verifie('elle rend plusieurs blocages', (pose.donnees?.blocks?.length ?? 0) > 1,
      pose.donnees?.blocks?.length);
    verifie('les jours de fermeture habituelle sont sautes',
      (pose.donnees?.skipped ?? 0) > 0, pose.donnees?.skipped);

    for (const b of pose.donnees.blocks) aNettoyer.push(b.id);

    const vue = await creneau(570, '', JOUR2);
    verifie('l\'absente ne figure plus sur les creneaux',
      vue.slots.every((c) => !c.staff.includes(sarah.id)), vue.slots.slice(0, 2));
    verifie('mais la journee reste ouverte pour les autres',
      vue.slots.some((c) => c.free), vue.slots.length);

    // Rouvrir UN SEUL jour au milieu de la periode doit rester possible : c'est
    // ce que le decoupage en une ligne par jour permet, et une plage de dates
    // en base aurait rendu penible.
    const leveUn = await salon.appel('DELETE',
      `/api/admin/day-block?date=${JOUR2}&staffId=${sarah.id}`);
    verifie('un jour isole peut etre rouvert', leveUn.donnees?.removed === 1, leveUn.donnees);

    const apres = await creneau(570, '', JOUR2);
    verifie('elle revient ce jour-la seulement',
      apres.slots.some((c) => c.staff.includes(sarah.id)), apres.slots.slice(0, 2));

    const leveTout = await salon.appel('DELETE',
      `/api/admin/day-block?date=${JOUR2}&to=${fin}&staffId=${sarah.id}`);
    verifie('et le reste de la periode se leve d\'un coup',
      leveTout.donnees?.removed > 0, leveTout.donnees);

    const tropLong = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR2, to: '2030-01-01' });
    verifie('une periode demesuree est refusee', tropLong.status === 400, tropLong.status);

    const inverse = await salon.appel('POST', '/api/admin/day-block',
      { date: fin, to: JOUR2 });
    verifie('une fin anterieure au debut est refusee', inverse.status === 400, inverse.status);
  }

  // --- 9 bis. Reattribution d'un rendez-vous ------------------------------
  console.log('\n9 bis. Reattribution');
  {
    // Deux rendez-vous non attribues QUI SE CHEVAUCHENT : la situation exacte
    // d'un commerce qui passe d'un agenda unique a une equipe. Ils occupent
    // tout le monde, et c'est precisement ce qui rendait l'attribution
    // impossible avant que PATCH ne cesse de les compter les uns contre les
    // autres. Sans ce test, l'impasse revient au premier refactoring.
    const vue = await creneau(570);
    const place = vue.slots.find((c) => c.staff.length === 2);

    const premier = await prisma.booking.create({
      data: {
        kind: 'appt', date: JOUR, startMin: place.start, durationMin: 45,
        serviceId: 'coupe-barbe', customerName: 'Orphelin A (test)', source: 'phone',
      },
    });
    const second = await prisma.booking.create({
      data: {
        // Decale de 15 minutes : il chevauche le premier a coup sur.
        kind: 'appt', date: JOUR, startMin: place.start + 15, durationMin: 45,
        serviceId: 'coupe-barbe', customerName: 'Orphelin B (test)', source: 'phone',
      },
    });
    aNettoyer.push(premier.id, second.id);

    const bloque = await creneau(place.start);
    verifie('deux rendez-vous non attribues bloquent toute l\'equipe',
      bloque.slot?.free === false, bloque.slot);

    const versCamille = await salon.appel('PATCH', `/api/admin/bookings/${premier.id}`,
      { staffId: camille.id });
    verifie('le premier peut malgre tout etre confie a quelqu\'un',
      versCamille.status === 200 && versCamille.donnees?.staffId === camille.id, versCamille.donnees);

    const versSarah = await salon.appel('PATCH', `/api/admin/bookings/${second.id}`,
      { staffId: sarah.id });
    verifie('et le second a quelqu\'un d\'autre, malgre le chevauchement',
      versSarah.status === 200 && versSarah.donnees?.staffId === sarah.id, versSarah.donnees);

    // Ce qui reste interdit : deux rendez-vous qui se chevauchent sur la MEME
    // personne. C'est le seul risque que le controle doit ecarter.
    const collision = await salon.appel('PATCH', `/api/admin/bookings/${second.id}`,
      { staffId: camille.id });
    verifie('mais jamais deux fois sur la meme personne',
      collision.status === 409, collision.status);

    const inconnue = await salon.appel('PATCH', `/api/admin/bookings/${premier.id}`,
      { staffId: 'personne-inventee' });
    verifie('une personne inventee est refusee', inconnue.status === 404, inconnue.status);

    const rendu = await salon.appel('PATCH', `/api/admin/bookings/${premier.id}`, { staffId: null });
    verifie('un rendez-vous peut etre rendu a personne',
      rendu.status === 200 && rendu.donnees?.staffId === null, rendu.donnees);

    const visiteurTente = await visiteur.appel('PATCH', `/api/admin/bookings/${premier.id}`,
      { staffId: camille.id });
    verifie('un visiteur non connecte ne peut rien reattribuer',
      visiteurTente.status === 401, visiteurTente.status);

    await prisma.booking.deleteMany({ where: { id: { in: [premier.id, second.id] } } });
  }

  // --- 9 ter. Horaires par personne ---------------------------------------
  console.log('\n9 ter. Horaires par personne');
  {
    const jourSemaine = new Date(JOUR2 + 'T12:00:00Z').getUTCDay();

    // Camille ne travaille que le matin, ce jour-la. Le commerce, lui, ouvre
    // 09h30-18h30 avec une pause 12h30-14h.
    const semaine = {};
    for (let d = 0; d < 7; d++) semaine[d] = { open: '09:30', close: '18:30', pause: null };
    semaine[jourSemaine] = { open: '09:30', close: '12:00', pause: null };

    await prisma.staffHours.deleteMany({ where: { staffId: camille.id } });
    for (let d = 0; d < 7; d++) {
      const h = semaine[d];
      await prisma.staffHours.create({
        data: {
          staffId: camille.id, weekday: d, closed: false,
          openMin: Number(h.open.slice(0, 2)) * 60 + Number(h.open.slice(3)),
          closeMin: Number(h.close.slice(0, 2)) * 60 + Number(h.close.slice(3)),
        },
      });
    }

    const vue = await creneau(570, '', JOUR2);
    const matin = vue.slots.filter((c) => c.start < 690);
    const apresMidi = vue.slots.filter((c) => c.start >= 840);

    verifie('elle figure sur les creneaux du matin',
      matin.some((c) => c.staff.includes(camille.id)), matin.slice(0, 2));
    verifie('mais sur aucun de l\'apres-midi',
      apresMidi.every((c) => !c.staff.includes(camille.id)), apresMidi.slice(0, 2));
    verifie('l\'autre personne, elle, y est toujours',
      apresMidi.every((c) => c.staff.includes(sarah.id) || !c.free), apresMidi.slice(0, 2));

    // La grille reste ancree sur l'ouverture du COMMERCE : les horaires de
    // Camille ne doivent pas decaler les heures proposees.
    //
    // On compare a 09h30 — l'heure a laquelle Camille arrive — plutot qu'a une
    // heure d'ouverture ecrite en dur : ce commerce n'ouvre pas a la meme heure
    // tous les jours (08h30 le samedi, 09h00 le reste de la semaine), et JOUR2
    // peut tomber sur l'un ou l'autre. Ce qui est verifie ici ne change pas pour
    // autant : la grille commence AVANT l'arrivee de Camille, donc elle suit le
    // commerce et non la personne.
    verifie('la grille des creneaux reste celle du commerce',
      vue.slots[0] && vue.slots[0].start < 570, vue.slots[0]);

    // Un rendez-vous l'apres-midi ne doit pas pouvoir lui etre attribue, meme
    // en le demandant nommement : la liste affichee et l'enregistrement doivent
    // dire la meme chose.
    const creneauApresMidi = apresMidi.find((c) => c.free);
    const refuse = await reserver({ start: creneauApresMidi.start, staffId: camille.id, date: JOUR2 });
    verifie('lui reserver hors de ses horaires est refuse', refuse.status === 409, refuse.status);

    // « Peu importe » a la meme heure doit tomber sur quelqu'un d'autre.
    const auto = await reserver({ start: creneauApresMidi.start, date: JOUR2 });
    verifie('« peu importe » ne la choisit pas non plus',
      auto.status === 201 && auto.donnees?.staffId === sarah.id, auto.donnees?.staffId);

    // Un enregistrement le matin, lui, passe.
    const creneauMatin = matin.find((c) => c.free && c.staff.includes(camille.id));
    const accepte = await reserver({ start: creneauMatin.start, staffId: camille.id, date: JOUR2 });
    verifie('un rendez-vous dans ses horaires est accepte', accepte.status === 201, accepte.donnees);

    await prisma.staffHours.deleteMany({ where: { staffId: camille.id } });

    const revenu = await creneau(570, '', JOUR2);
    verifie('sans horaires propres, elle suit de nouveau le commerce',
      revenu.slots.filter((c) => c.start >= 840).some((c) => c.staff.includes(camille.id)));
  }

  // --- 9 quater. Un seul tarif, quelle que soit la personne ---------------
  console.log('\n9 quater. Le tarif ne depend pas de la personne');
  {
    // Une coupe vaut 32 EUR, qu'elle soit faite par l'une ou par l'autre. Ce que
    // ce bloc verifie surtout, c'est qu'il n'existe AUCUN moyen de faire varier
    // le tarif par personne : ni dans ce que l'API annonce, ni dans ce qu'elle
    // enregistre.
    await prisma.serviceStaff.deleteMany({ where: { serviceId: 'coupe-barbe' } });

    const vue = await creneau(570, '', JOUR2);
    verifie('l\'API ne livre d\'une personne que son identifiant et son nom',
      vue.equipe.every((p) => Object.keys(p).sort().join(',') === 'id,name'), vue.equipe[0]);

    const libre = vue.slots.find((c) => c.free && c.staff.includes(camille.id));
    const chezCamille = await reserver({ start: libre.start, staffId: camille.id, date: JOUR2 });
    verifie('le rendez-vous porte le tarif de la prestation',
      chezCamille.donnees?.price === 28, chezCamille.donnees?.price);

    const libre2 = (await creneau(570, '', JOUR2)).slots.find((c) => c.staff.includes(sarah.id));
    const chezSarah = await reserver({ start: libre2.start, staffId: sarah.id, date: JOUR2 });
    verifie('le meme, avec quelqu\'un d\'autre',
      chezSarah.donnees?.price === 28, chezSarah.donnees?.price);

    // Le tarif est FIGE a la reservation : changer le tarif ensuite ne doit pas
    // modifier ce qui a ete annonce a la cliente.
    await prisma.service.update({ where: { id: 'coupe-barbe' }, data: { priceCents: 9900 } });
    const relu = await salon.appel('GET', `/api/admin/bookings?from=${JOUR2}&to=${JOUR2}`);
    const fige = relu.donnees.bookings.find((b) => b.id === chezSarah.donnees.id);
    verifie('un tarif deja convenu ne bouge plus', fige?.price === 28, fige?.price);
    await prisma.service.update({ where: { id: 'coupe-barbe' }, data: { priceCents: 2800 } });
  }

  // --- 9 quinquies. Les photos de l'equipe --------------------------------
  console.log('\n9 quinquies. Photos');
  {
    // Un carre de 1x1 pixel : le plus petit JPEG valable, suffisant pour eprouver
    // l'aller-retour sans transporter une vraie image dans ce fichier.
    const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ'
      + 'CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABA'
      + 'AAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

    const lecture = await salon.appel('GET', '/api/admin/settings');
    const avecPhoto = {
      ...lecture.donnees,
      staff: lecture.donnees.staff.map((p) => (p.id === camille.id ? { ...p, photo: PHOTO } : p)),
    };

    const ecrit = await salon.appel('PUT', '/api/admin/settings', avecPhoto);
    verifie('une photo s\'enregistre avec les reglages', ecrit.status === 200, ecrit.status);
    verifie('et revient telle quelle',
      ecrit.donnees?.staff?.find((p) => p.id === camille.id)?.photo === PHOTO);

    // La vitrine doit la recevoir : c'est la tout l'objet.
    const publique = await visiteur.appel('GET', '/api/config');
    verifie('la vitrine la recoit aussi',
      publique.donnees?.staff?.find((p) => p.id === camille.id)?.photo === PHOTO);

    // Une image SVG peut porter du code : elle est refusee, comme tout ce qui
    // n'est pas une photo deja reduite par le navigateur.
    const svg = {
      ...lecture.donnees,
      staff: lecture.donnees.staff.map((p) => (p.id === camille.id
        ? { ...p, photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } : p)),
    };
    const refusSvg = await salon.appel('PUT', '/api/admin/settings', svg);
    verifie('un format non accepte est refuse', refusSvg.status === 400, refusSvg.status);

    // Trop lourde : refusee aussi, plutot que tronquee en une image cassee.
    const enorme = {
      ...lecture.donnees,
      staff: lecture.donnees.staff.map((p) => (p.id === camille.id
        ? { ...p, photo: 'data:image/jpeg;base64,' + 'A'.repeat(200001) } : p)),
    };
    const refusPoids = await salon.appel('PUT', '/api/admin/settings', enorme);
    verifie('une photo trop lourde est refusee', refusPoids.status === 400, refusPoids.status);

    // Remise a zero : la suite continue sur une equipe sans photo.
    const sansPhoto = await salon.appel('PUT', '/api/admin/settings', {
      ...lecture.donnees,
      staff: lecture.donnees.staff.map((p) => ({ ...p, photo: '' })),
    });
    verifie('on peut retirer une photo',
      sansPhoto.donnees?.staff?.every((p) => !p.photo), sansPhoto.donnees?.staff);
  }

  // --- 10. L'equipe dans les reglages -------------------------------------
  console.log('\n10. Reglages de l\'equipe');
  {
    const lecture = await salon.appel('GET', '/api/admin/settings');
    const reglages = lecture.donnees;

    verifie('les reglages du salon portent l\'equipe',
      Array.isArray(reglages.staff) && reglages.staff.length === 2, reglages.staff?.length);

    const fiche = reglages.staff.find((p) => p.id === camille.id);
    verifie('avec le role saisi', fiche?.role === 'Coloriste', fiche?.role);
    verifie('et le nombre de rendez-vous a venir', fiche?.upcoming > 0, fiche?.upcoming);

    // Supprimer quelqu'un qui porte des rendez-vous doit prevenir : ses
    // rendez-vous perdraient leur staffId et bloqueraient tout le salon.
    const sansEquipe = { ...reglages, staff: [] };
    const refus = await salon.appel('PUT', '/api/admin/settings', sansEquipe);
    verifie('supprimer une personne attendue demande confirmation',
      refus.status === 409 && refus.donnees?.needsConfirmation === true, refus.status);
    verifie('la reponse nomme les personnes concernees',
      refus.donnees?.staffRemovals?.some((p) => p.id === camille.id),
      refus.donnees?.staffRemovals);

    // Une equipe entierement en pause ramenerait le commerce a un agenda unique
    // sans que personne ne l'ait demande : refuse.
    const toutEnPause = {
      ...reglages,
      staff: reglages.staff.map((p) => ({ ...p, active: false })),
      confirmRemovals: true,
    };
    const pause = await salon.appel('PUT', '/api/admin/settings', toutEnPause);
    verifie('mettre toute l\'equipe en pause est refuse', pause.status === 400, pause.status);

    // Une prestation confiee a la seule personne mise en pause ne pourrait
    // jamais etre reservee : refuse aussi.
    const orpheline = {
      ...reglages,
      staff: [
        { ...reglages.staff[0], active: false, services: ['coupe-rasage'] },
        { ...reglages.staff[1], services: ['coupe-barbe'] },
      ],
      confirmRemovals: true,
    };
    const trou = await salon.appel('PUT', '/api/admin/settings', orpheline);
    verifie('une prestation sans personne active est refusee', trou.status === 400, trou.donnees);

    // Une equipe valable, saisie entierement par l'API.
    const nouvelle = {
      ...reglages,
      staff: [{ name: 'Ines (test)', role: 'Barbier', color: '#7a4a63', services: ['coupe-rasage'] }],
      confirmRemovals: true,
    };
    const ecrit = await salon.appel('PUT', '/api/admin/settings', nouvelle);
    verifie('une equipe saisie par les reglages est enregistree',
      ecrit.status === 200 && ecrit.donnees?.staff?.length === 1, ecrit.donnees?.staff);

    const ines = ecrit.donnees.staff[0];
    verifie('elle recoit un identifiant stable',
      typeof ines.id === 'string' && ines.id.startsWith('stf-'), ines.id);
    verifie('ses prestations sont conservees',
      ines.services.length === 1 && ines.services[0] === 'coupe-rasage', ines.services);

    // Le site public la voit, et le calcul suit ses liens.
    const publique = await visiteur.appel('GET', '/api/config');
    verifie('le site public recoit l\'equipe',
      publique.donnees?.staff?.length === 1, publique.donnees?.staff);

    const coloration = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-rasage`);
    verifie('elle assure la prestation qui lui est confiee',
      coloration.donnees?.staff?.length === 1, coloration.donnees?.staff);

    const coupe = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('et aussi celles que personne ne revendique',
      coupe.donnees?.staff?.length === 1, coupe.donnees?.staff);

    // Retour a un commerce sans equipe : les autres suites en dependent.
    const retour = await salon.appel('PUT', '/api/admin/settings',
      { ...reglages, staff: [], confirmRemovals: true });
    verifie('les reglages reviennent a un commerce sans equipe',
      retour.status === 200 && retour.donnees?.staff?.length === 0, retour.donnees?.staff);
  }
} finally {
  // L'equipe et ses rendez-vous disparaissent : les autres suites verifient un
  // commerce sans equipe, et la base de developpement doit y revenir.
  for (const id of aNettoyer) {
    await prisma.booking.deleteMany({ where: { id } });
  }
  if (camille) await prisma.staff.deleteMany({ where: { id: camille.id } });
  if (sarah) await prisma.staff.deleteMany({ where: { id: sarah.id } });

  // Puis on repose l'equipe qui etait la avant nous, s'il y en avait une.
  //
  // APRES les suppressions ci-dessus, jamais avant : sinon les deux personnes
  // du test seraient reecrites par le `PUT` et re-supprimees juste apres.
  //
  // L'ordre compte aussi avec `supprimerCompteDeTest()`, qui suit : ce `PUT`
  // est la derniere chose que le compte de test ait a faire.
  await reposerEquipe(salon);

  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
