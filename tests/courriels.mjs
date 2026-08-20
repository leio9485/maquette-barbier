// ---------------------------------------------------------------------------
// TESTS DU CANAL COURRIEL (lot 7)
//
//     npm run test:courriels
//
// >>> CETTE SUITE LANCE SON PROPRE SERVEUR, ET C'EST LA SECONDE A LE FAIRE. <<<
//
// Meme raison que tests/demonstration.mjs : ce qu'elle verifie n'existe QUE si
// `COURRIEL_ACTIF=true` et que la cle et l'expediteur sont poses — trois
// variables qui ne doivent jamais figurer dans le .env d'une machine de
// developpement, sans quoi la moindre reservation de test ecrirait a quelqu'un.
//
// Elle demarre donc une instance a part, sur son propre port et SA PROPRE BASE,
// et efface les deux en partant.
//
// ET ELLE LANCE AUSSI UN FAUX FOURNISSEUR. Un envoi reel demanderait une cle,
// un domaine verifie, et une boite a relire : rien de tout cela n'est
// reproductible. Le faux fournisseur ecoute a la place de l'API, NOTE CE QU'IL
// RECOIT, et sait tomber en panne sur commande. C'est ce qui permet de verifier
// la seule chose qui compte vraiment ici :
//
//   >>> UN FOURNISSEUR INJOIGNABLE NE FAIT PAS ECHOUER UNE RESERVATION. <<<
//
// C'est la regle en tete de src/lib/notifications.js. Une reservation qui
// aboutit sans que le courriel parte est un desagrement ; une reservation qui
// echoue parce qu'un fournisseur ne repond pas est un client perdu.
// ---------------------------------------------------------------------------

import http from 'node:http';
import { spawn } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..');

const PORT = 3198;
const PORT_FOURNISSEUR = 3197;
const BASE = `http://localhost:${PORT}`;

const BASE_TEST = path.join(RACINE, 'data', 'courriels-test.db');
const BASE_SOURCE = path.join(RACINE, 'data', 'commerce.db');

// AVANT tout `import()` de src/ : c'est cette ligne qui protege la base de
// developpement.
process.env.DATABASE_URL = `file:${BASE_TEST}`;

const { creerVerificateur, creerClient, prochainJourOuvert } = await import('./helpers.mjs');
const { prisma } = await import('../src/db.js');
const { hashPassword } = await import('../src/lib/passwords.js');

const { verifie, bilan } = creerVerificateur();

const JOUR = prochainJourOuvert();
const ADRESSE_CLIENT = 'client@example.test';
const EXPEDITEUR = "L'Établi <rendez-vous@example.test>";
const CLE = 'cle-de-test-du-faux-fournisseur';

// --- LE FAUX FOURNISSEUR ---------------------------------------------------

/** Ce qu'il a recu depuis le dernier `vider()`. */
let recus = [];
/** Quand c'est vrai, il repond 503 : c'est la panne, sur commande. */
let enPanne = false;
let fournisseur = null;

function demarrerFournisseur() {
  return new Promise((resoudre) => {
    fournisseur = http.createServer((req, res) => {
      let corps = '';
      req.on('data', (morceau) => { corps += morceau; });
      req.on('end', () => {
        if (enPanne) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end('{"message":"service indisponible"}');
        }
        try {
          recus.push({ autorisation: req.headers.authorization, corps: JSON.parse(corps) });
        } catch { /* corps illisible : il compte quand meme comme une tentative */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"id":"faux"}');
      });
    });
    fournisseur.listen(PORT_FOURNISSEUR, resoudre);
  });
}

/**
 * Attend qu'un courriel arrive, ou renonce.
 *
 * ⚠️ L'ENVOI EST EN ARRIERE-PLAN, ET C'EST TOUT L'INTERET : la reponse au
 *    client part sans attendre le fournisseur. Une suite qui lirait `recus`
 *    juste apres la reponse HTTP trouverait donc une liste vide — non parce que
 *    rien n'est parti, mais parce que rien n'est ENCORE parti.
 */
async function attendreUnCourriel(combien = 1, msMax = 5000) {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (recus.length >= combien) return recus;
    await new Promise((r) => setTimeout(r, 50));
  }
  return recus;
}

function vider() { recus = []; }

// --- L'INSTANCE ------------------------------------------------------------

let serveur = null;

async function demarrerServeur() {
  serveur = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], {
    cwd: RACINE,
    env: {
      ...process.env,
      DATABASE_URL: `file:${BASE_TEST}`,
      PORT: String(PORT),
      NODE_ENV: 'development',
      // >>> LES TROIS VARIABLES QUI ALLUMENT LE CANAL. <<< C'est exactement ce
      //     qu'un client aurait a poser sur son instance, et rien de plus.
      COURRIEL_ACTIF: 'true',
      COURRIEL_CLE: CLE,
      COURRIEL_EXPEDITEUR: EXPEDITEUR,
      COURRIEL_API: `http://127.0.0.1:${PORT_FOURNISSEUR}/emails`,
      // Sans elle, le lien d'annulation ne s'ecrit pas — et c'est justement une
      // des choses que cette suite verifie.
      PUBLIC_URL: 'https://letabli-test.fr',
      // ⚠️ SURTOUT PAS DEMO_MODE : la demonstration retient TOUT, et la suite
      //    verrait un canal muet en croyant tester un canal allume.
      DEMO_MODE: '',
    },
    stdio: process.env.COURRIEL_TEST_VERBEUX ? 'inherit' : 'ignore',
  });

  for (let essai = 0; essai < 300; essai++) {
    try {
      const sain = await fetch(`${BASE}/api/health`);
      if (sain.ok) return;
    } catch { /* pas encore la */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("L'instance de test n'a pas demarre.");
}

function arreterServeur() {
  if (serveur && !serveur.killed) serveur.kill();
  serveur = null;
}

/** Le corps du dernier courriel recu, ou `null`. */
const dernier = () => recus[recus.length - 1]?.corps ?? null;

/** Le fichier .ics d'un courriel, decode. */
function icsDe(courriel) {
  const piece = (courriel?.attachments ?? [])[0];
  if (!piece) return null;
  return Buffer.from(piece.content, 'base64').toString('utf8');
}

const valeurIcs = (ics, nom) => new RegExp(`^${nom}:(.*)$`, 'm').exec(ics ?? '')?.[1]?.trim();

let code = 1;
const visiteur = creerClient(BASE);

try {
  await copyFile(BASE_SOURCE, BASE_TEST);

  // Un compte de commercant, pour les deux sections qui passent par l'espace.
  await prisma.adminUser.upsert({
    where: { username: 'courriels-test' },
    update: { passwordHash: await hashPassword('mot-de-passe-de-test-courriels') },
    create: {
      username: 'courriels-test',
      passwordHash: await hashPassword('mot-de-passe-de-test-courriels'),
      role: '',
    },
  });

  // Une base copiee peut porter des rendez-vous : la journee de test doit etre
  // vierge, sinon les creneaux manquent.
  await prisma.booking.deleteMany({});

  await demarrerFournisseur();
  await demarrerServeur();

  const salon = creerClient(BASE);
  await salon.appel('POST', '/api/admin/login',
    { username: 'courriels-test', password: 'mot-de-passe-de-test-courriels' });

  const creneaux = async () => (await visiteur.appel(
    'GET', `/api/slots?date=${JOUR}&serviceId=coupe-homme`)).donnees.slots.filter((c) => c.free);

  // --- 1. LA CONFIRMATION --------------------------------------------------
  console.log('1. La confirmation, juste apres la reservation');

  let rdv = null;
  {
    const libres = await creneaux();
    vider();

    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: libres[0].start, serviceId: 'coupe-homme',
      name: 'Damien Carpentier', phone: '06 39 98 14 07', email: ADRESSE_CLIENT,
    });
    rdv = r.donnees;
    verifie('la reservation aboutit', r.status === 201, r.status);

    await attendreUnCourriel();
    const courriel = dernier();

    verifie('>>> UN COURRIEL EST PARTI <<<', recus.length === 1, recus.length);
    verifie('il va au client', courriel?.to?.[0] === ADRESSE_CLIENT, courriel?.to);
    verifie('il vient de l\'expediteur configure', courriel?.from === EXPEDITEUR, courriel?.from);
    verifie('la cle voyage en « Bearer »',
      recus[0]?.autorisation === `Bearer ${CLE}`, recus[0]?.autorisation);

    // >>> LES DEUX CHOSES QUE LE CLIENT DOIT RETROUVER. <<< Sans elles, le
    //     courriel ne remplace pas le bout de papier qu'il ne prendra pas.
    verifie('>>> IL PORTE LA REFERENCE <<<',
      courriel?.text?.includes(rdv.reference), rdv.reference);
    verifie('>>> ET LE LIEN D\'ANNULATION <<<',
      courriel?.text?.includes('https://letabli-test.fr/annuler'), '');

    verifie('il rappelle qu\'aucun acompte n\'a ete preleve',
      /Aucun acompte/.test(courriel?.text ?? ''), '');
    verifie('il porte le jour et l\'heure dans son objet',
      /Rendez-vous confirmé · /.test(courriel?.subject ?? ''), courriel?.subject);

    // ⚠️ AUCUN HTML : le message part en texte brut, et un champ `html` ferait
    //    partir deux versions dont l'une n'a jamais ete relue.
    verifie('il part en texte brut, sans version HTML',
      typeof courriel?.text === 'string' && courriel.html === undefined,
      Object.keys(courriel ?? {}));

    // --- LA PIECE JOINTE ---------------------------------------------------
    const ics = icsDe(courriel);
    verifie('>>> LE FICHIER .ics EST JOINT <<<', Boolean(ics), courriel?.attachments?.length);
    verifie('il porte le type que les agendas attendent',
      /text\/calendar/.test(courriel?.attachments?.[0]?.content_type ?? ''),
      courriel?.attachments?.[0]?.content_type);
    verifie('c\'est bien un calendrier', /^BEGIN:VCALENDAR/.test(ics ?? ''), (ics ?? '').slice(0, 40));
    verifie('son identifiant est bati sur la reference',
      valeurIcs(ics, 'UID')?.startsWith(rdv.reference), valeurIcs(ics, 'UID'));
    verifie('et sa version vaut zero a la prise',
      valeurIcs(ics, 'SEQUENCE') === '0', valeurIcs(ics, 'SEQUENCE'));
  }

  // --- 2. LE DEPLACEMENT ---------------------------------------------------
  //
  // >>> C'EST ICI QUE LA PIECE JOINTE SE JOUE VRAIMENT. <<< Meme identifiant et
  //     numero de version PLUS GRAND : c'est la seule facon pour que l'agenda
  //     du client DEPLACE l'evenement au lieu d'en poser un second a cote de
  //     l'ancien. Un fichier qui rate cela laisse le client avec deux
  //     rendez-vous, dont un a l'heure ou il ne doit pas venir.
  console.log('\n2. Le deplacement');
  {
    // ⚠️ UNE SECONDE D'ATTENTE, ET CE N'EST PAS UNE COQUETTERIE. Le numero de
    //    version compte les SECONDES ecoulees depuis la creation — c'est la
    //    granularite choisie, pas un defaut (voir `version()` dans
    //    src/routes/rendezvous.js). Un deplacement joue quatre cents
    //    millisecondes apres la reservation rendrait donc `SEQUENCE:0`, et le
    //    test lirait un echec la ou le produit se comporte normalement : aucun
    //    client ne deplace son rendez-vous dans la demi-seconde. C'est la meme
    //    attente, pour la meme raison, que dans tests/ics.mjs.
    await new Promise((r) => setTimeout(r, 1100));

    const libres = await creneaux();
    const ailleurs = libres.find((c) => c.start > rdv.start + 60);
    vider();

    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: rdv.reference, jeton: rdv.cancelToken,
      date: JOUR, start: ailleurs.start,
    });
    verifie('le deplacement aboutit', r.status === 200, r.donnees);

    await attendreUnCourriel();
    const courriel = dernier();

    verifie('un courriel est parti', recus.length === 1, recus.length);
    verifie('son objet dit « déplacé »',
      /Rendez-vous déplacé/.test(courriel?.subject ?? ''), courriel?.subject);

    // L'AVANT ET L'APRES : sans la premiere ligne, le client se demande s'il
    // vient de prendre un SECOND rendez-vous.
    verifie('>>> IL DIT L\'AVANT ET L\'APRES <<<',
      /Avant : /.test(courriel?.text ?? '') && /Quand : /.test(courriel?.text ?? ''), '');
    verifie('et il dit que la reference n\'a pas change',
      /référence n'a pas changé/.test(courriel?.text ?? ''), '');
    verifie('la reference est bien la meme qu\'a la reservation',
      courriel?.text?.includes(rdv.reference), rdv.reference);

    const ics = icsDe(courriel);
    verifie('le fichier .ics est joint lui aussi', Boolean(ics), '');
    verifie('>>> MEME IDENTIFIANT D\'EVENEMENT QU\'AVANT <<<',
      valeurIcs(ics, 'UID')?.startsWith(rdv.reference), valeurIcs(ics, 'UID'));
    verifie('>>> ET UN NUMERO DE VERSION PLUS GRAND QUE ZERO <<<',
      Number(valeurIcs(ics, 'SEQUENCE')) > 0, valeurIcs(ics, 'SEQUENCE'));
  }

  // --- 3. L'ANNULATION -----------------------------------------------------
  console.log('\n3. L\'annulation');
  {
    vider();

    const r = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: rdv.reference, jeton: rdv.cancelToken,
    });
    verifie('l\'annulation aboutit', r.status === 200, r.donnees);

    await attendreUnCourriel();
    const courriel = dernier();

    verifie('un courriel est parti', recus.length === 1, recus.length);
    verifie('son objet dit « annulé »',
      /Rendez-vous annulé/.test(courriel?.subject ?? ''), courriel?.subject);
    verifie('il porte encore la reference',
      courriel?.text?.includes(rdv.reference), rdv.reference);
    verifie('et il dit comment reprendre rendez-vous',
      /reprendre rendez-vous/.test(courriel?.text ?? ''), '');

    // >>> AUCUNE PIECE JOINTE, ET C'EST DELIBERE. <<< Joindre un evenement a un
    //     courriel qui annonce sa disparition est la meilleure facon de le voir
    //     REAPPARAITRE dans l'agenda du client. Le retirer demanderait un
    //     fichier de methode `CANCEL`, qui n'est pas le meme fichier.
    verifie('>>> ET AUCUN FICHIER .ics N\'EST JOINT <<<',
      (courriel?.attachments ?? []).length === 0, courriel?.attachments?.length);
  }

  // --- 4. SANS ADRESSE, RIEN NE PART ---------------------------------------
  //
  // Le champ est facultatif dans le tunnel, et un rendez-vous saisi au comptoir
  // n'en porte souvent aucun. Ce n'est pas une anomalie, et cela ne doit rien
  // journaliser d'inquietant.
  console.log('\n4. Sans adresse, rien ne part');
  {
    const libres = await creneaux();
    vider();

    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: libres[0].start, serviceId: 'coupe-homme',
      name: 'Sans courriel', phone: '06 39 98 14 08',
    });
    verifie('la reservation aboutit sans adresse', r.status === 201, r.status);

    await attendreUnCourriel(1, 1200);
    verifie('>>> ET AUCUN COURRIEL N\'EST PARTI <<<', recus.length === 0, recus.length);

    await salon.appel('DELETE', `/api/admin/bookings/${r.donnees.id}`);
  }

  // --- 5. LE FOURNISSEUR EST INJOIGNABLE -----------------------------------
  //
  // >>> LA SECTION QUI COMPTE LE PLUS. <<< C'est la regle en tete de
  //     src/lib/notifications.js, et c'est celle qu'on ne peut pas verifier a
  //     la main : une reservation qui echoue parce qu'un fournisseur de
  //     courriel ne repond pas est un client perdu.
  console.log('\n5. Le fournisseur est injoignable');
  {
    const libres = await creneaux();
    vider();
    enPanne = true;

    const avant = await prisma.notificationCounter.findFirst({ where: { canal: 'email' } });

    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: libres[0].start, serviceId: 'coupe-homme',
      name: 'Fournisseur en panne', phone: '06 39 98 14 09', email: ADRESSE_CLIENT,
    });

    verifie('>>> LA RESERVATION ABOUTIT QUAND MEME <<<', r.status === 201, r.status);
    verifie('et elle rend un rendez-vous complet',
      Boolean(r.donnees?.reference && r.donnees?.id), r.donnees?.reference);

    // Laisser a l'envoi en fond le temps d'echouer et de rendre son unite.
    await new Promise((resoudre) => setTimeout(resoudre, 1500));

    // >>> L'UNITE RESERVEE EST RENDUE. <<< Sans cela, une panne du fournisseur
    //     consommerait le plafond du mois sans qu'un seul message ne parte.
    const apres = await prisma.notificationCounter.findFirst({ where: { canal: 'email' } });
    verifie('>>> ET LE COMPTEUR N\'A PAS BOUGE : l\'unite est rendue <<<',
      (apres?.envoyes ?? 0) === (avant?.envoyes ?? 0),
      [avant?.envoyes, apres?.envoyes]);

    enPanne = false;
    await salon.appel('DELETE', `/api/admin/bookings/${r.donnees.id}`);
  }

  // --- 6. LE PLAFOND -------------------------------------------------------
  //
  // Il n'est pas la pour la facture — un courriel ne se paie pas a l'unite —
  // mais contre l'abus : ce qu'une boucle de reservations peut faire partir
  // depuis l'adresse du commerce avant que quiconque s'en apercoive.
  console.log('\n6. Le plafond du mois');
  {
    const compteurs = await prisma.notificationCounter.findMany({ where: { canal: 'email' } });
    verifie('les envois sont comptes par mois et par canal',
      compteurs.length === 1 && compteurs[0].envoyes > 0, compteurs);
    verifie('et le mois est ecrit en toutes lettres',
      /^\d{4}-\d{2}$/.test(compteurs[0]?.mois ?? ''), compteurs[0]?.mois);
  }

  code = bilan();
} finally {
  arreterServeur();
  if (fournisseur) fournisseur.close();
  await prisma.$disconnect().catch(() => {});

  for (let essai = 0; essai < 20; essai++) {
    try {
      await rm(BASE_TEST, { force: true });
      await rm(`${BASE_TEST}-journal`, { force: true });
      break;
    } catch {
      await new Promise((resoudre) => setTimeout(resoudre, 100));
    }
  }
}

process.exitCode = code;
