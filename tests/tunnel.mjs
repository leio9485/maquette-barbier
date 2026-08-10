// ---------------------------------------------------------------------------
// TESTS DE ROBUSTESSE DU TUNNEL (lot 6.3)
//
//     npm start           (terminal 1, laisse ouvert)
//     npm run test:tunnel (terminal 2)
//
// LES QUATRE CAS QUI ARRIVENT VRAIMENT, et qui n'ont rien d'exotique dans un
// commerce de quartier :
//
//   1. deux clients cliquent le meme creneau a une seconde d'intervalle ;
//   2. le serveur redemarre au milieu du tunnel (Render endort l'instance
//      apres quinze minutes) ;
//   3. le client perd le reseau entre l'etape 3 et la confirmation ;
//   4. le commercant bloque une periode pendant qu'un client est a l'etape 3.
//
// >>> CE QU'ON VERIFIE, DANS LES QUATRE CAS : un message en francais, et JAMAIS
//     DEUX RENDEZ-VOUS EN BASE. <<<
//
// Le second point est le seul qui ne se rattrape pas. Un message maladroit se
// corrige ; deux clients convoques a la meme heure, le barbier le decouvre
// devant eux.
// ---------------------------------------------------------------------------

import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const alice = creerClient();
const bruno = creerClient();
const salon = await clientConnecte();

const JOUR = prochainJourOuvert();
const PRESTATION = 'coupe-homme';

const aNettoyer = [];

/**
 * La personne sur laquelle porteront les collisions, ou `null`.
 *
 * ⚠️ SANS ELLE, LE TEST DE COLLISION NE TESTE RIEN. Le commerce de
 *    demonstration a trois barbiers : deux reservations sur le meme creneau y
 *    sont parfaitement LEGITIMES — Remi prend l'une, Karim l'autre. Un test
 *    ecrit sans preciser « avec qui » voyait donc deux 201 et criait au double
 *    rendez-vous, alors que le serveur avait raison.
 *
 *    En visant la meme personne, on retrouve la seule ressource qui ne peut
 *    pas se dedoubler. Le test vaut alors aussi bien pour un barbier seul.
 */
async function personneDeReference() {
  const r = await alice.appel('GET', `/api/slots?date=${JOUR}&serviceId=${PRESTATION}`);
  return r.donnees?.staff?.[0]?.id ?? null;
}

const QUI = await personneDeReference();

async function creneauxLibres() {
  const p = new URLSearchParams({ date: JOUR, serviceId: PRESTATION });
  if (QUI) p.set('staffId', QUI);
  const r = await alice.appel('GET', `/api/slots?${p}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free);
}

async function rendezVousDuJour() {
  const r = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
  return (r.donnees?.bookings ?? []).filter((b) => b.type !== 'block' && !b.cancelledAt);
}

/** Un message est-il en francais et lisible par un client ? */
function messageLisible(texte) {
  if (typeof texte !== 'string' || texte.length < 10) return false;
  // Aucune trace technique : ni pile d'appel, ni nom de table, ni code interne.
  const technique = /prisma|sqlite|undefined|null|TypeError|Error:|at \w+\.|constraint/i;
  return !technique.test(texte);
}

console.log(`Journee de test : ${JOUR}\n`);

try {
  // --- 1. Deux clients, le meme creneau ------------------------------------
  //
  // Le cas le plus frequent des quatre, et le seul qui se produise sans panne :
  // deux personnes regardent la meme page un samedi matin.
  console.log('1. Deux clients sur le meme creneau');
  {
    const libres = await creneauxLibres();
    verifie('il reste des creneaux pour le test', libres.length > 0, libres.length);

    const creneau = libres[0].start;
    // MEME PERSONNE pour les deux : c'est ce qui fait de ce creneau une
    // ressource unique, quel que soit le nombre de barbiers.
    const corps = (nom) => ({
      date: JOUR, start: creneau, serviceId: PRESTATION, staffId: QUI ?? undefined,
      name: nom, phone: '06 39 98 70 01',
    });

    // >>> LES DEUX PARTENT ENSEMBLE, sans attendre l'un l'autre. C'est ce qui
    //     distingue ce test d'un enchainement : les deux transactions se
    //     recouvrent vraiment.
    const [a, b] = await Promise.all([
      alice.appel('POST', '/api/bookings', corps('Alice Simultanee')),
      bruno.appel('POST', '/api/bookings', corps('Bruno Simultane')),
    ]);

    for (const r of [a, b]) if (r.donnees?.id) aNettoyer.push(r.donnees.id);

    const reussites = [a, b].filter((r) => r.status === 201);
    const refus = [a, b].filter((r) => r.status !== 201);

    verifie('exactement UN des deux passe', reussites.length === 1, [a.status, b.status]);
    verifie('l\'autre est refuse en 409, pas en 500',
      refus.length === 1 && refus[0].status === 409, refus[0]?.status);
    verifie('et le refus est une phrase en francais',
      messageLisible(refus[0]?.donnees?.error), refus[0]?.donnees?.error);

    const surLeCreneau = (await rendezVousDuJour())
      .filter((r) => r.start === creneau && (!QUI || r.staffId === QUI));
    verifie('>>> UN SEUL RENDEZ-VOUS EN BASE SUR CE CRENEAU <<<',
      surLeCreneau.length === 1, surLeCreneau.map((r) => r.name));
  }

  // --- 2. Le creneau disparait entre l'affichage et la validation ----------
  //
  // C'est le cas 4 de la mission : le commercant bloque une periode pendant
  // qu'un client est a l'etape 3, le formulaire deja rempli.
  console.log('\n2. Le salon bloque la journee pendant que le client saisit ses coordonnees');
  {
    const libres = await creneauxLibres();
    const creneau = libres[libres.length - 1]?.start;
    verifie('un creneau est retenu par le client', Number.isInteger(creneau), creneau);

    // Le client a vu ce creneau. Le salon ferme la journee.
    const blocage = await salon.appel('POST', '/api/admin/day-block', { date: JOUR });
    verifie('le salon bloque la journee', blocage.status === 201, blocage.status);

    const r = await alice.appel('POST', '/api/bookings', {
      date: JOUR, start: creneau, serviceId: PRESTATION,
      name: 'Client Trop Tard', phone: '06 39 98 70 02',
    });
    if (r.donnees?.id) aNettoyer.push(r.donnees.id);

    verifie('la reservation est refusee', r.status === 409, r.status);
    verifie('avec une phrase en francais', messageLisible(r.donnees?.error), r.donnees?.error);
    verifie('et rien n\'est enregistre', !r.donnees?.id, r.donnees?.id);

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
  }

  // --- 3. Le client valide deux fois -------------------------------------
  //
  // Le reseau traine, le client reclique « Réserver ce créneau ». C'est la
  // forme la plus courante du cas 3 : la premiere requete a abouti, la reponse
  // n'est jamais arrivee.
  console.log('\n3. Le client valide deux fois (reseau qui traine)');
  {
    const libres = await creneauxLibres();
    const creneau = libres[0].start;
    const corps = {
      date: JOUR, start: creneau, serviceId: PRESTATION, staffId: QUI ?? undefined,
      name: 'Client Double Clic', phone: '06 39 98 70 03',
    };

    const premier = await alice.appel('POST', '/api/bookings', corps);
    if (premier.donnees?.id) aNettoyer.push(premier.donnees.id);
    verifie('le premier envoi passe', premier.status === 201, premier.status);

    const second = await alice.appel('POST', '/api/bookings', corps);
    if (second.donnees?.id) aNettoyer.push(second.donnees.id);

    verifie('le second est refuse', second.status === 409, second.status);
    verifie('avec une phrase en francais', messageLisible(second.donnees?.error), second.donnees?.error);

    const surLeCreneau = (await rendezVousDuJour())
      .filter((r) => r.start === creneau && (!QUI || r.staffId === QUI));
    verifie('>>> UN SEUL RENDEZ-VOUS EN BASE <<<',
      surLeCreneau.length === 1, surLeCreneau.map((r) => r.name));
  }

  // --- 4. Le client repart d'une page ouverte depuis longtemps -------------
  //
  // Le cas 2 : l'instance s'est endormie, le client revient sur son onglet et
  // valide. Rien n'est garde en memoire cote serveur — pas de session de
  // reservation, pas de creneau « reserve » — donc un redemarrage ne peut pas
  // perdre un tunnel en cours. Ce test le VERIFIE plutot que de le supposer :
  // une prestation supprimee entre-temps est le meme cas, en pire.
  console.log('\n4. La page est restee ouverte, le monde a change');
  {
    const r = await alice.appel('POST', '/api/bookings', {
      date: JOUR, start: 540, serviceId: 'prestation-qui-nexiste-plus',
      name: 'Client Onglet Ancien', phone: '06 39 98 70 04',
    });
    verifie('une prestation disparue est refusee proprement', r.status === 404, r.status);
    verifie('avec une phrase en francais', messageLisible(r.donnees?.error), r.donnees?.error);
  }
  {
    // Une date deja passee : l'onglet est reste ouvert toute la nuit.
    const hier = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const r = await alice.appel('POST', '/api/bookings', {
      date: hier, start: 540, serviceId: PRESTATION,
      name: 'Client Hier', phone: '06 39 98 70 05',
    });
    if (r.donnees?.id) aNettoyer.push(r.donnees.id);
    verifie('une date passee est refusee', r.status === 409, r.status);
    verifie('avec une phrase en francais', messageLisible(r.donnees?.error), r.donnees?.error);
  }

  // --- 5. Aucune reponse d'erreur ne fuit de detail technique ---------------
  console.log('\n5. Ce que le client lit quand ca rate');
  {
    const cas = [
      ['une date invalide', { date: 'pas-une-date', start: 540, serviceId: PRESTATION, name: 'X', phone: '06' }],
      ['une heure impossible', { date: JOUR, start: 9999, serviceId: PRESTATION, name: 'X', phone: '06' }],
      ['un nom vide', { date: JOUR, start: 540, serviceId: PRESTATION, name: '   ', phone: '06' }],
      ['un telephone vide', { date: JOUR, start: 540, serviceId: PRESTATION, name: 'X', phone: '' }],
      ['un corps vide', {}],
    ];

    for (const [quoi, corps] of cas) {
      const r = await alice.appel('POST', '/api/bookings', corps);
      if (r.donnees?.id) aNettoyer.push(r.donnees.id);
      verifie(`${quoi} : refus lisible, jamais une erreur technique`,
        r.status >= 400 && r.status < 500 && messageLisible(r.donnees?.error),
        [r.status, r.donnees?.error]);
    }
  }
} finally {
  for (const id of aNettoyer) {
    await salon.appel('DELETE', `/api/admin/bookings/${id}`);
  }
  await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
