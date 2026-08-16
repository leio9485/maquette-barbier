// ---------------------------------------------------------------------------
// TESTS DES PERIODES BLOQUEES (lots 1 et 3)
//
//     npm start             (terminal 1, laisse ouvert)
//     npm run test:blocages (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE.
//
// Le calcul etait juste — un blocage rendait bien tous les creneaux
// indisponibles, verifie a la minute pres. C'est ce qu'il y avait AUTOUR qui
// manquait :
//
//   - une periode bloquee ne pouvait pas etre levee. La ligne d'agenda n'etait
//     pas un bouton, aucun ecran ne listait les blocages, et la fonction
//     `debloquerPeriode()` du navigateur envoyait un corps JSON a une route qui
//     lit `req.query` — elle n'a donc jamais rien leve. Un barbier qui se
//     trompait d'une semaine en posant ses conges fermait sa boutique en ligne
//     sans recours (lot 1) ;
//   - le motif saisi n'etait jamais enregistre : le serveur ecrasait ce que le
//     formulaire envoyait par « Journee bloquee », sans accents (lot 3a et 3b) ;
//   - poser un blocage sur des rendez-vous existants ne disait rien, alors que
//     c'est le moment ou le produit rend son plus grand service : « voila les
//     trois personnes a rappeler » (lot 3c).
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

const JOUR = prochainJourOuvert();

/** Le jour suivant, ouvert lui aussi : mardi a jeudi sont suivis d'un jour ouvert. */
const jourPlus = (n) => {
  const d = new Date(`${JOUR}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const PRESTATION = 'coupe-homme';

/** Les lignes creees par cette suite, effacees a la fin. */
const aNettoyer = [];
let personne = null;

/** Combien de creneaux sont libres ce jour-la, vus du public. */
async function libres(date = JOUR, staffId = '') {
  const p = new URLSearchParams({ date, serviceId: PRESTATION });
  if (staffId) p.set('staffId', staffId);
  const r = await visiteur.appel('GET', `/api/slots?${p}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free).length;
}

let code = 1;

try {
  // --- 1. Un blocage « tout le commerce » se pose, puis se leve -------------
  //
  // >>> LE CRITERE D'ACCEPTATION DU LOT 1 : les creneaux redeviennent
  //     disponibles immediatement cote client, sans redemarrage. <<<
  console.log('1. Bloquer et lever, tout le commerce');
  {
    const avant = await libres();
    verifie('des creneaux sont libres au depart', avant > 0, avant);

    const pose = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, notes: 'Congés' });
    if (pose.donnees?.id) aNettoyer.push(pose.donnees.id);

    verifie('le blocage est enregistre', pose.status === 201, pose.donnees);
    verifie('plus aucun creneau n\'est libre', (await libres()) === 0, await libres());

    const fiche = await salon.appel('GET', `/api/admin/day-block/${pose.donnees.id}`);
    verifie('la fiche du blocage se lit', fiche.status === 200, fiche.donnees);
    verifie('elle porte la periode, du et au',
      fiche.donnees?.from === JOUR && fiche.donnees?.to === JOUR, fiche.donnees);
    verifie('une journee bloquee compte pour une',
      fiche.donnees?.days === 1, fiche.donnees?.days);

    const levee = await salon.appel('DELETE',
      `/api/admin/day-block?date=${fiche.donnees.from}&to=${fiche.donnees.to}`);
    verifie('la levee aboutit', levee.status === 200 && levee.donnees?.removed === 1, levee.donnees);

    verifie('>>> LES CRENEAUX SONT DE NOUVEAU LIBRES <<<',
      (await libres()) === avant, { avant, apres: await libres() });
  }

  // --- 2. Le motif saisi est conserve, et il est accentue -------------------
  //
  // Un champ qu'on propose, qu'on remplit et qu'on jette est pire que pas de
  // champ du tout.
  console.log('\n2. Le motif (lot 3a et 3b)');
  {
    const avec = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, notes: 'Formation Karim' });
    if (avec.donnees?.id) aNettoyer.push(avec.donnees.id);

    verifie('>>> LE MOTIF SAISI EST CONSERVE <<<',
      avec.donnees?.notes === 'Formation Karim', avec.donnees?.notes);

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);

    const sans = await salon.appel('POST', '/api/admin/day-block', { date: JOUR });
    if (sans.donnees?.id) aNettoyer.push(sans.donnees.id);

    verifie('sans motif, le libelle par defaut est accentue',
      sans.donnees?.notes === 'Journée bloquée', sans.donnees?.notes);
    verifie('et il ne reste aucune trace de l\'ancien libelle sans accents',
      !String(sans.donnees?.notes).includes('Journee'), sans.donnees?.notes);

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
  }

  // --- 3. Une periode de plusieurs jours se relit d'un bloc -----------------
  //
  // En base, un blocage est UNE LIGNE PAR JOUR. Le commercant, lui, a saisi
  // « du 12 au 22 » : c'est ce qu'il doit relire, et lever d'un geste.
  console.log('\n3. Une periode de plusieurs jours');
  {
    const fin = jourPlus(2);
    const pose = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, to: fin, notes: 'Congés' });

    for (const b of pose.donnees?.blocks ?? []) aNettoyer.push(b.id);
    verifie('la periode est posee', pose.status === 201, pose.donnees);

    const premier = pose.donnees.blocks[0];
    const fiche = await salon.appel('GET', `/api/admin/day-block/${premier.id}`);

    verifie('la fiche recompose la periode entiere',
      fiche.donnees?.from === JOUR && fiche.donnees?.to === fin,
      { attendu: [JOUR, fin], obtenu: [fiche.donnees?.from, fiche.donnees?.to] });
    verifie('elle compte les journees reellement bloquees',
      fiche.donnees?.days === pose.donnees.blocks.length,
      { days: fiche.donnees?.days, poses: pose.donnees.blocks.length });

    // Depuis le DERNIER jour, on doit retrouver la meme periode : c'est le cas
    // du commercant qui clique sur la ligne du jeudi d'une semaine de conges.
    const dernier = pose.donnees.blocks[pose.donnees.blocks.length - 1];
    const parLaFin = await salon.appel('GET', `/api/admin/day-block/${dernier.id}`);
    verifie('la meme periode se retrouve depuis n\'importe lequel de ses jours',
      parLaFin.donnees?.from === JOUR && parLaFin.donnees?.to === fin, parLaFin.donnees);

    const levee = await salon.appel('DELETE',
      `/api/admin/day-block?date=${fiche.donnees.from}&to=${fiche.donnees.to}`);
    verifie('lever la periode retire toutes ses journees',
      levee.donnees?.removed === pose.donnees.blocks.length, levee.donnees);
    verifie('et le premier jour redevient reservable', (await libres()) > 0, await libres());
  }

  // --- 4. Un blocage nominatif se leve de la meme facon ---------------------
  console.log('\n4. Un blocage nominatif');
  {
    personne = await prisma.staff.create({
      data: { id: 'stf-test-blocages', name: 'Personne de test', position: 900 },
    });

    const avantElle = await libres(JOUR, personne.id);
    verifie('elle a des creneaux au depart', avantElle > 0, avantElle);

    const pose = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, staffId: personne.id, notes: 'Formation' });
    if (pose.donnees?.id) aNettoyer.push(pose.donnees.id);

    verifie('l\'absence est enregistree sur elle',
      pose.status === 201 && pose.donnees?.staffId === personne.id, pose.donnees);
    verifie('le motif nominatif est conserve lui aussi',
      pose.donnees?.notes === 'Formation', pose.donnees?.notes);
    verifie('elle n\'a plus aucun creneau', (await libres(JOUR, personne.id)) === 0);

    const fiche = await salon.appel('GET', `/api/admin/day-block/${pose.donnees.id}`);
    verifie('la fiche d\'une absence porte la personne',
      fiche.donnees?.staffId === personne.id, fiche.donnees);

    const levee = await salon.appel('DELETE',
      `/api/admin/day-block?date=${fiche.donnees.from}&to=${fiche.donnees.to}&staffId=${personne.id}`);
    verifie('l\'absence se leve', levee.donnees?.removed === 1, levee.donnees);
    verifie('>>> ET SES CRENEAUX REVIENNENT <<<',
      (await libres(JOUR, personne.id)) === avantElle,
      { avant: avantElle, apres: await libres(JOUR, personne.id) });
  }

  // --- 5. Les rendez-vous que le blocage recouvre sont signales -------------
  //
  // C'est le moment ou le produit rend son plus grand service au commercant :
  // « voila les trois personnes a rappeler ». Il ne disait rien.
  console.log('\n5. Les rendez-vous en conflit (lot 3c)');
  {
    const creneaux = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=${PRESTATION}`);
    const premier = (creneaux.donnees?.slots ?? []).find((c) => c.free);

    const rdv = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: premier.start, serviceId: PRESTATION,
      name: 'Client a rappeler', phone: '06 39 98 00 11', source: 'phone',
    });
    if (rdv.donnees?.id) aNettoyer.push(rdv.donnees.id);
    verifie('un rendez-vous existe ce jour-la', rdv.status === 201, rdv.donnees);

    // Sans rien demander de plus, le serveur REFUSE et dit ce qu'il a trouve :
    // c'est ce qui permet a l'ecran intermediaire d'exister.
    const tentative = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, notes: 'Congés' });

    verifie('poser le blocage ne passe pas en silence',
      tentative.status === 409, { statut: tentative.status, corps: tentative.donnees });
    verifie('le refus liste les rendez-vous concernes',
      Array.isArray(tentative.donnees?.conflicts) && tentative.donnees.conflicts.length >= 1,
      tentative.donnees);

    const conflit = tentative.donnees?.conflicts?.[0];
    verifie('chaque rendez-vous porte son nom, son heure et son TELEPHONE',
      conflit?.name === 'Client a rappeler'
      && Number.isInteger(conflit?.start)
      && conflit?.phone === '06 39 98 00 11', conflit);
    verifie('aucun blocage n\'a ete pose au passage',
      (await libres()) > 0, await libres());

    // Le commercant a lu la liste : il confirme, et garde ses rendez-vous.
    const confirme = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, notes: 'Congés', confirmConflicts: true });
    if (confirme.donnees?.id) aNettoyer.push(confirme.donnees.id);

    verifie('confirme, le blocage se pose', confirme.status === 201, confirme.donnees);
    verifie('et les rendez-vous existants sont conserves',
      (await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`))
        .donnees.bookings.some((b) => b.id === rdv.donnees.id));

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);

    // L'autre choix : annuler les rendez-vous en bloc.
    const enBloc = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, notes: 'Congés', confirmConflicts: true, cancelConflicts: true });
    if (enBloc.donnees?.id) aNettoyer.push(enBloc.donnees.id);

    verifie('l\'annulation en bloc est possible', enBloc.status === 201, enBloc.donnees);

    const restants = (await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`))
      .donnees.bookings.filter((b) => b.type !== 'block');
    verifie('les rendez-vous recouverts ont ete retires',
      restants.length === 0, restants);

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
  }

  code = bilan();
} finally {
  for (const id of aNettoyer) {
    await prisma.booking.deleteMany({ where: { id } }).catch(() => {});
  }
  if (personne) await prisma.staff.deleteMany({ where: { id: personne.id } }).catch(() => {});
  await supprimerCompteDeTest();
}

process.exitCode = code;
