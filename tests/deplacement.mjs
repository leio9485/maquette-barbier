// ---------------------------------------------------------------------------
// TESTS DU DEPLACEMENT D'UN RENDEZ-VOUS
//
//     npm start               (terminal 1, laisse ouvert)
//     npm run test:deplacement (terminal 2)
//
// >>> CE QUE CETTE SUITE PROTEGE, ET POURQUOI ELLE EXISTE. <<<
//
// Deplacer un rendez-vous est l'operation la plus frequente d'un agenda de
// barbier — « elle passe a 15 h au lieu de 14 h ». Elle n'existait pas : le
// seul chemin possible etait SUPPRIMER PUIS RE-NOTER, et il cassait une chaine
// entiere en silence.
//
//   - le rendez-vous recree recevait une NOUVELLE reference et un NOUVEAU
//     jeton, tires dans la transaction de creation ;
//   - la reference que le client avait notee ne fonctionnait plus sur
//     /annuler ;
//   - le bandeau « Votre rendez-vous » de son telephone pointait sur une ligne
//     supprimee ;
//   - et la ligne repassait de `source: 'online'` a `source: 'phone'`,
//     faussant la statistique de provenance du tableau de bord.
//
// Le client voyait son rendez-vous disparaitre pendant que le commercant
// croyait l'avoir simplement decale. C'est cette chaine que les sections 2 et 3
// verifient, et pas seulement le code HTTP du PATCH.
//
// ⚠️ LA SECTION 6 CREE DEUX PERSONNES, ET LA SECTION 10 LES RETIRE. Toute la
//    suite suppose un commerce sans equipe (voir `mettreEquipeDeCote()` dans
//    tests/helpers.mjs), et la suppression vit AUSSI dans le `finally` : un
//    echec au milieu les laisserait sinon derriere lui, et les suites suivantes
//    verraient un commerce a equipe la ou elles en attendent un sans.
//
//    Elles vivaient donc jusqu'a la fin, et les sections 7 et 8 s'en
//    accommodaient — elles ne verifient aucune collision. La section 10, si :
//    avec deux personnes enregistrees, un creneau reste libre tant que l'une des
//    deux l'est, et son premier controle passait au vert a l'envers. Elle les
//    retire donc en entrant, et le `finally` ne fait alors plus rien.
// ---------------------------------------------------------------------------

import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  mettreEquipeDeCote,
  reposerEquipe,
} from './helpers.mjs';

import { prisma } from '../src/db.js';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

// >>> UTILE QUAND CETTE SUITE EST LANCEE SEULE (`npm run test:deplacement`). <<<
//
// Sous `npm test`, tests/run.mjs l'a deja fait et il ne reste alors personne a
// relever : les deux appels ne se genent pas.
//
// Sans lui, la section 4 passe au ROUGE sur une base de developpement ou une
// equipe est enregistree — et pour une raison qui n'a rien a voir avec le
// deplacement. Deplacer un rendez-vous sur un creneau « occupe » y REUSSIT,
// tout simplement parce qu'une seconde personne y est libre. C'est le
// comportement juste ; c'est le test qui suppose un commerce a agenda unique.
// Constate a l'essai, pas deduit.
await mettreEquipeDeCote(salon);

const JOUR = prochainJourOuvert();
const TELEPHONE = '06 39 98 14 07';
const QUATRE = '1407';

/** Meme calcul que src/lib/time.js, redit ici pour ne rien importer du serveur. */
const addJours = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const DEMAIN = addJours(JOUR, 1);

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Les rendez-vous crees ici, effaces a la fin quoi qu'il arrive. */
const aNettoyer = [];

/** Les personnes creees ici, meme regle. */
const equipeDeTest = [];

/** Les creneaux libres d'une journee, vus du public. */
async function creneauxLibres(date, serviceId = 'coupe-homme') {
  const r = await visiteur.appel('GET', `/api/slots?date=${date}&serviceId=${serviceId}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free);
}

/** Une reservation prise EN LIGNE : c'est la seule qui porte reference et jeton. */
async function reserverEnLigne(date, start, serviceId = 'coupe-homme') {
  const r = await visiteur.appel('POST', '/api/bookings', {
    date, start, serviceId, name: 'Damien Carpentier (test)', phone: TELEPHONE,
  });
  if (r.donnees?.id) aNettoyer.push(r.donnees.id);
  return r;
}

/** La ligne telle qu'elle est EN BASE — la reponse HTTP ne dit pas tout. */
function enBase(id) {
  return prisma.booking.findUnique({ where: { id } });
}

console.log(`Journee de test : ${JOUR} (puis ${DEMAIN})\n`);

try {
  // --- 1. Le deplacement simple --------------------------------------------
  console.log('1. Deplacer un rendez-vous');

  let rdv = null;
  let avant = null;

  {
    const libres = await creneauxLibres(JOUR);
    if (libres.length < 3) throw new Error(`Pas assez de creneaux libres le ${JOUR}.`);

    const pris = await reserverEnLigne(JOUR, libres[0].start);
    verifie('le rendez-vous de depart est pris', pris.status === 201, pris.donnees);

    rdv = pris.donnees;
    avant = await enBase(rdv.id);

    // On vise un creneau d'un AUTRE JOUR : c'est le cas reel, et il verifie du
    // meme coup que la date part bien avec l'heure.
    const ailleurs = await creneauxLibres(DEMAIN);
    if (!ailleurs.length) throw new Error(`Aucun creneau libre le ${DEMAIN}.`);

    const cible = ailleurs[0].start;

    const bouge = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      date: DEMAIN, start: cible,
    });

    verifie('le deplacement aboutit', bouge.status === 200, bouge.donnees);
    verifie('la reponse porte la nouvelle date',
      bouge.donnees?.date === DEMAIN && bouge.donnees?.start === cible,
      [bouge.donnees?.date, bouge.donnees?.start]);

    // `movedFrom` est ce qui permet a l'ecran de nommer l'avant et l'apres sans
    // en avoir garde une copie de son cote.
    verifie('la reponse dit d\'ou il vient',
      bouge.donnees?.movedFrom?.date === JOUR
      && bouge.donnees?.movedFrom?.start === avant.startMin,
      bouge.donnees?.movedFrom);

    const apres = await enBase(rdv.id);
    verifie('la base porte le nouveau creneau',
      apres.date === DEMAIN && apres.startMin === cible, [apres.date, apres.startMin]);

    // >>> LE CRENEAU D'ORIGINE REPART AU PUBLIC. <<< Un deplacement qui laisse
    //     l'ancienne case occupee rend le creneau invendable pour toujours,
    //     exactement comme une annulation mal filtree.
    const rendus = await creneauxLibres(JOUR);
    verifie('l\'ancien creneau redevient reservable',
      rendus.some((c) => c.start === avant.startMin), hhmm(avant.startMin));
  }

  // --- 2. CE QUI NE DOIT PAS AVOIR BOUGE -----------------------------------
  //
  // La raison d'etre de toute l'operation. Si l'une de ces quatre valeurs
  // change, le deplacement n'est qu'une suppression suivie d'une creation, et
  // le client se retrouve avec une reference morte entre les mains.
  console.log('\n2. L\'identite du rendez-vous survit au deplacement');
  {
    const apres = await enBase(rdv.id);

    verifie('l\'identifiant est le meme', apres.id === avant.id, [avant.id, apres.id]);
    verifie('la REFERENCE est la meme',
      apres.reference === avant.reference && Boolean(apres.reference),
      [avant.reference, apres.reference]);
    verifie('le JETON d\'annulation est le meme',
      apres.cancelToken === avant.cancelToken && Boolean(apres.cancelToken),
      avant.cancelToken === apres.cancelToken);
    verifie('la PROVENANCE reste « online »',
      apres.source === 'online' && avant.source === 'online', [avant.source, apres.source]);
    verifie('la date de creation ne bouge pas',
      apres.createdAt.getTime() === avant.createdAt.getTime(),
      [avant.createdAt, apres.createdAt]);

    verifie('les coordonnees du client sont intactes',
      apres.customerName === avant.customerName && apres.customerPhone === avant.customerPhone,
      [apres.customerName, apres.customerPhone]);
  }

  // --- 3. La reference d'origine marche toujours sur /annuler ---------------
  //
  // Le test que l'audit demande « en pratique » : la verification en base ne
  // prouve que la moitie du chemin. Ce que le client fait, lui, c'est ressaisir
  // la reference notee sur son ecran de confirmation — et elle doit lui montrer
  // LA NOUVELLE DATE.
  console.log('\n3. La reference notee par le client suit le deplacement');
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, telephone: QUATRE,
    });

    verifie('la reference d\'origine retrouve encore le rendez-vous',
      r.status === 200, r.status);
    verifie('et elle affiche la NOUVELLE date',
      r.donnees?.rendezVous?.date === DEMAIN, r.donnees?.rendezVous?.date);
  }

  // --- 4. Les collisions ----------------------------------------------------
  console.log('\n4. Collision, et auto-collision');
  {
    // Un second rendez-vous, sur un creneau libre du meme jour.
    const libres = await creneauxLibres(DEMAIN);
    const occupe = libres[0];
    if (!occupe) throw new Error(`Aucun creneau libre le ${DEMAIN} pour la collision.`);

    const voisin = await reserverEnLigne(DEMAIN, occupe.start);
    verifie('un second rendez-vous occupe un autre creneau', voisin.status === 201, voisin.donnees);

    const avantCollision = await enBase(rdv.id);

    const collision = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      date: DEMAIN, start: occupe.start,
    });

    verifie('deplacer sur un creneau occupe est refuse en 409',
      collision.status === 409, collision.status);

    // Le message est lu par un commercant : il s'ecrit en francais, accents
    // compris (tests/francais.mjs pose la meme regle sur le HTML rendu).
    verifie('le refus est ecrit en francais',
      /créneau/.test(collision.donnees?.error ?? ''), collision.donnees?.error);

    // >>> ET RIEN N'A BOUGE. <<< Un refus qui aurait deja ecrit la moitie du
    //     changement serait pire que pas de refus du tout.
    const inchange = await enBase(rdv.id);
    verifie('le rendez-vous refuse n\'a pas bouge d\'un pouce',
      inchange.date === avantCollision.date && inchange.startMin === avantCollision.startMin,
      [inchange.date, inchange.startMin]);

    // >>> L'AUTO-COLLISION. <<< Reposer un rendez-vous sur SON PROPRE creneau
    //     doit reussir : sans l'exclusion de soi-meme dans la transaction, il se
    //     verrait comme un obstacle, et on ne pourrait plus changer la seule
    //     prestation ni la seule personne en gardant l'heure.
    const surSoi = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      date: inchange.date, start: inchange.startMin,
    });
    verifie('se reposer sur son propre creneau reussit', surSoi.status === 200, surSoi.donnees);

    // Le meme piege, cote liste : le formulaire de deplacement demande les
    // creneaux avec `exclude`, et doit y retrouver celui du rendez-vous.
    const sansLui = await salon.appel('GET',
      `/api/admin/slots?date=${inchange.date}&serviceId=coupe-homme&exclude=${rdv.id}`);
    const sien = (sansLui.donnees?.slots ?? []).find((c) => c.start === inchange.startMin);
    verifie('« exclude » rend son propre creneau libre a nouveau',
      sien?.free === true, sien);

    const avecLui = await salon.appel('GET',
      `/api/admin/slots?date=${inchange.date}&serviceId=coupe-homme`);
    const pris = (avecLui.donnees?.slots ?? []).find((c) => c.start === inchange.startMin);
    verifie('sans « exclude », il se voit bien occupe', pris?.free === false, pris);
  }

  // --- 5. Changer de prestation --------------------------------------------
  //
  // La duree et le tarif SONT RECALCULES, et depuis la prestation seule — jamais
  // depuis ce que la requete envoie. Sans ce recalcul, une « Coupe homme » de
  // 25 min passee en « Coupe + rasage » de 60 min garderait 25 minutes dans
  // l'agenda : le rendez-vous suivant se poserait par-dessus.
  console.log('\n5. Changer de prestation recalcule duree et tarif');
  {
    // >>> ON LUI FAIT D'ABORD DE LA PLACE, ET C'EST LE SUJET. <<<
    //
    // Passer de « Coupe homme » (25 min) a « Coupe + rasage » (60 min) ALLONGE
    // le rendez-vous : sa fin mord sur ce qui suit, et le voisin pose en
    // section 4 le refusait — a juste titre. Le refus etait le bon
    // comportement ; c'est le test qui l'avait mal installe.
    //
    // On le pose donc sur un creneau ou soixante minutes tiennent, demande au
    // serveur pour la prestation VISEE et non pour l'actuelle.
    const place = (await salon.appel('GET',
      `/api/admin/slots?date=${DEMAIN}&serviceId=coupe-rasage&exclude=${rdv.id}`))
      .donnees?.slots?.find((c) => c.free);

    if (!place) throw new Error(`Aucun creneau de 60 min libre le ${DEMAIN}.`);

    const recale = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: DEMAIN, start: place.start });
    verifie('le rendez-vous se pose la ou 60 min tiennent',
      recale.status === 200, recale.donnees);

    const depart = await enBase(rdv.id);
    verifie('au depart : coupe-homme, 25 min, 18,00 €',
      depart.serviceId === 'coupe-homme' && depart.durationMin === 25 && depart.priceCents === 1800,
      [depart.serviceId, depart.durationMin, depart.priceCents]);

    const change = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      serviceId: 'coupe-rasage',
    });

    verifie('le changement de prestation aboutit', change.status === 200, change.donnees);

    const apres = await enBase(rdv.id);
    verifie('la duree suit la nouvelle prestation (60 min)',
      apres.durationMin === 60, apres.durationMin);
    verifie('le tarif suit la nouvelle prestation (40,00 €)',
      apres.priceCents === 4000, apres.priceCents);
    verifie('le tarif remonte en euros dans la reponse',
      change.donnees?.price === 40, change.donnees?.price);

    // ⚠️ ET LA REFERENCE N'A TOUJOURS PAS BOUGE. Le changement de prestation
    //    passe par la meme transaction que le decalage horaire ; c'est le
    //    chemin ou l'on serait le plus tente de recreer la ligne.
    verifie('la reference survit aussi au changement de prestation',
      apres.reference === avant.reference, [avant.reference, apres.reference]);

    // Une duree envoyee a la main est IGNOREE : le serveur ne fait confiance a
    // rien de ce qu'il recoit sur ce champ, comme a la creation.
    const triche = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      serviceId: 'coupe-homme', duration: 5, durationMin: 5, price: 1,
    });
    verifie('une duree soufflee par la requete est ignoree',
      triche.status === 200 && (await enBase(rdv.id)).durationMin === 25,
      (await enBase(rdv.id)).durationMin);

    const inconnue = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { serviceId: 'prestation-inventee' });
    verifie('une prestation inventee est refusee', inconnue.status === 404, inconnue.status);

    // >>> DETACHER LA PRESTATION N'EST PAS LA CHANGER. <<< `serviceId: null` est
    //     un changement — la cle est la — mais il n'y a plus de prestation a
    //     lire. Sur le seul drapeau « ca change », le serveur dereferencait
    //     `null` et rendait 500 ; le rendez-vous doit garder sa duree et son
    //     tarif convenus, qui sont figes sur la ligne depuis le debut.
    const avantDetache = await enBase(rdv.id);
    const detache = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { serviceId: null });

    verifie('detacher la prestation ne fait pas tomber le serveur',
      detache.status === 200, detache.status);

    const apresDetache = await enBase(rdv.id);
    verifie('le rendez-vous garde sa duree et son tarif convenus',
      apresDetache.durationMin === avantDetache.durationMin
      && apresDetache.priceCents === avantDetache.priceCents,
      [apresDetache.durationMin, apresDetache.priceCents]);

    // On la lui rend, les sections suivantes en ont besoin.
    const rendue = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { serviceId: 'coupe-homme' });
    verifie('et elle se rattache aussi bien', rendue.status === 200, rendue.status);
  }

  // --- 6. Changer de personne ----------------------------------------------
  console.log('\n6. Changer de personne');
  {
    const remi = await prisma.staff.create({
      data: { name: 'Rémi (test)', role: 'Barbier', position: 90 },
    });
    equipeDeTest.push(remi.id);

    const lea = await prisma.staff.create({
      data: { name: 'Léa (test)', role: 'Barbière', position: 91 },
    });
    equipeDeTest.push(lea.id);

    const confie = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { staffId: remi.id });
    verifie('le rendez-vous se confie a quelqu\'un',
      confie.status === 200 && confie.donnees?.staffId === remi.id, confie.donnees);

    // La reattribution seule ne deplace rien : ni date, ni heure, ni duree.
    const apresConfie = await enBase(rdv.id);
    verifie('changer de personne ne decale pas le rendez-vous',
      apresConfie.date === DEMAIN && apresConfie.startMin !== null,
      [apresConfie.date, apresConfie.startMin]);
    verifie('et la reference ne bouge toujours pas',
      apresConfie.reference === avant.reference, apresConfie.reference);

    // Deplacer ET changer de personne d'un seul geste : c'est ce que le
    // formulaire envoie, les quatre champs a la fois.
    const libres = await salon.appel('GET',
      `/api/admin/slots?date=${DEMAIN}&serviceId=coupe-homme&staffId=${lea.id}&exclude=${rdv.id}`);
    const cible = (libres.donnees?.slots ?? []).find(
      (c) => c.free && c.start !== apresConfie.startMin);

    if (!cible) throw new Error('Aucun creneau libre pour le deplacement avec changement de personne.');

    const ensemble = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, {
      date: DEMAIN, start: cible.start, serviceId: 'coupe-homme', staffId: lea.id,
    });

    verifie('date, heure, prestation et personne changent d\'un seul geste',
      ensemble.status === 200
      && ensemble.donnees?.staffId === lea.id
      && ensemble.donnees?.start === cible.start,
      ensemble.donnees);

    // Rendre le rendez-vous a personne : la CLE compte, pas sa valeur.
    const rendu = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`, { staffId: null });
    verifie('« peu importe qui » rend le rendez-vous a personne',
      rendu.status === 200 && rendu.donnees?.staffId === null, rendu.donnees);

    // Et l'inverse : une cle ABSENTE ne touche a rien. C'est ce qui permet de
    // decaler l'heure sans reattribuer, et de reattribuer sans decaler.
    const versRemi = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { staffId: remi.id });
    verifie('le rendez-vous repart chez quelqu\'un', versRemi.status === 200, versRemi.donnees);

    const positionActuelle = await enBase(rdv.id);
    const autre = (await salon.appel('GET',
      `/api/admin/slots?date=${DEMAIN}&serviceId=coupe-homme&staffId=${remi.id}&exclude=${rdv.id}`))
      .donnees?.slots?.find((c) => c.free && c.start !== positionActuelle.startMin);

    if (!autre) throw new Error('Aucun second creneau libre pour verifier la cle absente.');

    const sansStaffId = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: DEMAIN, start: autre.start });

    verifie('un decalage SANS cle staffId garde la personne',
      sansStaffId.status === 200 && sansStaffId.donnees?.staffId === remi.id,
      sansStaffId.donnees?.staffId);

    const personneInventee = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { staffId: 'personne-inventee' });
    verifie('une personne inventee est refusee', personneInventee.status === 404,
      personneInventee.status);
  }

  // --- 7. Ce qui reste refuse ----------------------------------------------
  console.log('\n7. Les refus');
  {
    const visiteurTente = await visiteur.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: DEMAIN, start: 600 });
    verifie('un visiteur non connecte ne deplace rien',
      visiteurTente.status === 401, visiteurTente.status);

    const introuvable = await salon.appel('PATCH', '/api/admin/bookings/rendez-vous-invente',
      { date: DEMAIN, start: 600 });
    verifie('un rendez-vous inconnu renvoie 404', introuvable.status === 404, introuvable.status);

    const dateFausse = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: 'pas-une-date' });
    verifie('une date invalide renvoie 400', dateFausse.status === 400, dateFausse.status);

    const heureFausse = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { start: 5000 });
    verifie('une heure hors de la journee renvoie 400', heureFausse.status === 400,
      heureFausse.status);

    // La seule date qui reste interdite. Tout le reste — hors horaires, pendant
    // la pause, hors grille — est ACCEPTE avec un avertissement : cote
    // commercant, on previent, on n'interdit pas.
    const hier = addJours(JOUR, -30);
    const passe = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: hier, start: 600 });
    verifie('deplacer vers une date passee est refuse', passe.status === 409, passe.status);

    // Hors des heures d'ouverture : accepte, mais la reponse le DIT.
    const tardif = await salon.appel('PATCH', `/api/admin/bookings/${rdv.id}`,
      { date: DEMAIN, start: 1380 });
    verifie('hors horaires : accepte, pas refuse', tardif.status === 200, tardif.donnees);
    verifie('mais la reponse porte un avertissement',
      typeof tardif.donnees?.warning === 'string' && tardif.donnees.warning.length > 0,
      tardif.donnees?.warning);
  }

  // --- 8. Un rendez-vous annule ne se deplace pas ---------------------------
  //
  // Son creneau est rendu au public. Le decaler reviendrait a le ressusciter
  // dans le dos de celui qui s'est decommande — et a reoccuper une case que
  // quelqu'un d'autre a peut-etre deja prise entre-temps.
  console.log('\n8. Un rendez-vous annule ne se deplace pas');
  {
    const libres = await creneauxLibres(JOUR);
    const pris = await reserverEnLigne(JOUR, libres[0].start);

    const annule = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: pris.donnees.reference, telephone: QUATRE,
    });
    verifie('le client annule son rendez-vous', annule.status === 200, annule.donnees);

    const bouge = await salon.appel('PATCH', `/api/admin/bookings/${pris.donnees.id}`,
      { date: DEMAIN, start: 600 });
    verifie('deplacer un rendez-vous annule est refuse', bouge.status === 409, bouge.status);
    verifie('et le refus le dit en francais',
      /annulé/.test(bouge.donnees?.error ?? ''), bouge.donnees?.error);
  }

  // --- 9. LES PROCHAINES DISPONIBILITES, SUR PLUSIEURS JOURS ----------------
  //
  // La fenetre « Deplacer » n'avait que `GET /api/admin/slots`, qui ne repond
  // que sur UNE journee. Sur un jour plein, elle rendait trente creneaux tous
  // pris et le commercant devait changer de date a l'aveugle, jour apres jour —
  // au telephone, avec un client en ligne.
  console.log('\n9. Les prochaines disponibilites');
  {
    const dispos = await salon.appel('GET',
      `/api/admin/prochaines-dispos?serviceId=coupe-homme&date=${JOUR}`);

    verifie('la route repond', dispos.status === 200, dispos.status);
    verifie('elle propose trois creneaux par defaut',
      dispos.donnees?.slots?.length === 3, dispos.donnees?.slots?.length);
    verifie('chacun porte sa date, son heure et son libelle',
      (dispos.donnees?.slots ?? []).every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)
        && Number.isInteger(c.start) && /^\d{2}:\d{2}$/.test(c.label)),
      dispos.donnees?.slots);
    verifie('ils sont dans l\'ordre chronologique',
      (dispos.donnees?.slots ?? []).every((c, i, liste) => i === 0
        || c.date > liste[i - 1].date
        || (c.date === liste[i - 1].date && c.start > liste[i - 1].start)),
      dispos.donnees?.slots);

    // >>> ELLE REGARDE AU-DELA DU JOUR DEMANDE, ET C'EST TOUT SON INTERET. <<<
    // On bloque la journee entiere : les propositions doivent alors sortir des
    // jours suivants, ce que /api/admin/slots ne saurait pas faire.
    const blocage = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, motif: 'Test des prochaines disponibilites' });
    verifie('la journee est bloquee', blocage.status === 201, blocage.donnees);

    const apres = await salon.appel('GET',
      `/api/admin/prochaines-dispos?serviceId=coupe-homme&date=${JOUR}`);
    verifie('>>> LES PROPOSITIONS SORTENT ALORS DU JOUR DEMANDE <<<',
      (apres.donnees?.slots ?? []).length === 3
        && apres.donnees.slots.every((c) => c.date > JOUR),
      apres.donnees?.slots);

    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);

    // Le plafond est borne : on ne demande pas mille creneaux d'un coup.
    const trop = await salon.appel('GET',
      '/api/admin/prochaines-dispos?serviceId=coupe-homme&limite=999');
    verifie('la limite demandee est bornee',
      (trop.donnees?.slots ?? []).length <= 10, trop.donnees?.slots?.length);

    // Elle est derriere la session, comme tout /api/admin/.
    const anonyme = await visiteur.appel('GET',
      '/api/admin/prochaines-dispos?serviceId=coupe-homme');
    verifie('elle exige une session', anonyme.status === 401, anonyme.status);
  }

  // --- 10. FORCER UN CRENEAU DEJA OCCUPE ------------------------------------
  //
  // Le patron est chez lui : s'il decide de caser quelqu'un en doublant a 15h,
  // le logiciel doit le permettre. Un client, lui, ne doit JAMAIS pouvoir se
  // fabriquer une place — ce serait l'oracle de disponibilite le plus simple du
  // monde, et le moyen de remplir un agenda de doublons depuis une boucle.
  console.log('\n10. Forcer un creneau deja occupe');
  {
    // >>> LES DEUX PERSONNES DE LA SECTION 6 SONT RETIREES ICI, ET IL LE FAUT. <<<
    //
    // Elles sont creees section 6 et supprimees dans le `finally`, c'est-a-dire
    // qu'elles vivent encore pendant les sections 7 a 10. Les sections 7 et 8
    // s'en accommodent — elles ne verifient aucune collision. Celle-ci, si :
    // avec deux personnes enregistrees, un creneau reste LIBRE tant que l'une
    // des deux l'est, et « sans force, le creneau occupe est refuse » passait
    // au vert a l'envers, en 200. Constate a l'essai, pas deduit.
    //
    // C'est la meme raison que le `mettreEquipeDeCote()` du haut de fichier :
    // tout ce qui teste une collision suppose un commerce a agenda unique. La
    // suppression du `finally` reste en place et ne fait plus rien — c'est
    // voulu, un echec avant cette ligne doit encore nettoyer.
    if (equipeDeTest.length) {
      await prisma.staff.deleteMany({ where: { id: { in: equipeDeTest } } });
      equipeDeTest.length = 0;
    }

    const libres = await creneauxLibres(DEMAIN);
    if (libres.length < 4) throw new Error(`Pas assez de creneaux libres le ${DEMAIN}.`);

    const occupant = await reserverEnLigne(DEMAIN, libres[0].start);
    const aBouger = await reserverEnLigne(DEMAIN, libres[3].start);
    verifie('deux rendez-vous sont poses', occupant.status === 201 && aBouger.status === 201,
      [occupant.status, aBouger.status]);

    // Sans `force` : le refus habituel.
    const refuse = await salon.appel('PATCH', `/api/admin/bookings/${aBouger.donnees.id}`,
      { date: DEMAIN, start: libres[0].start });
    verifie('sans force, le creneau occupe est refuse', refuse.status === 409, refuse.status);

    // Avec `force` : le doublement passe.
    const force = await salon.appel('PATCH', `/api/admin/bookings/${aBouger.donnees.id}`,
      { date: DEMAIN, start: libres[0].start, force: true });
    verifie('>>> AVEC FORCE, LE DEPLACEMENT PASSE <<<', force.status === 200, force.donnees);
    verifie('et le rendez-vous est bien sur le creneau double',
      (await enBase(aBouger.donnees.id))?.startMin === libres[0].start,
      (await enBase(aBouger.donnees.id))?.startMin);
    verifie('les deux rendez-vous existent toujours',
      (await enBase(occupant.donnees.id)) !== null, null);

    // ⚠️ CE QUE `force` NE LEVE PAS. Il passe outre l'OCCUPATION, et rien
    //    d'autre : les trois autres refus ne disent pas « c'est pris », ils
    //    disent « ce n'est pas ce geste-la ».
    const hier = addJours(JOUR, -30);
    const passe = await salon.appel('PATCH', `/api/admin/bookings/${aBouger.donnees.id}`,
      { date: hier, start: 600, force: true });
    verifie('force ne fait pas remonter le temps', passe.status === 409, passe.status);

    // `force` n'est vrai que pour le booleen : ni "true", ni 1, ni "on". Un
    // formulaire mal serialise ne doit pas doubler un rendez-vous par accident.
    const chaine = await salon.appel('PATCH', `/api/admin/bookings/${aBouger.donnees.id}`,
      { date: DEMAIN, start: libres[3].start, force: 'true' });
    verifie('force ne se declenche pas sur la chaine "true"',
      chaine.status === 200 || chaine.status === 409, chaine.status);

    // >>> LA PORTEE : L'ADRESSE PUBLIQUE NE CONNAIT PAS `force`. <<<
    //
    // C'est le controle qui compte, et il se verifie plutot qu'il ne se promet :
    // la portee est exactement ce qui se perd en recopiant une ligne d'une route
    // a l'autre.
    const remis = await salon.appel('PATCH', `/api/admin/bookings/${aBouger.donnees.id}`,
      { date: DEMAIN, start: libres[3].start, force: true });
    verifie('le rendez-vous est remis de cote', remis.status === 200, remis.status);

    const intrus = await visiteur.appel('POST', '/api/bookings', {
      date: DEMAIN, start: libres[3].start, serviceId: 'coupe-homme',
      name: 'Intrus (test)', phone: TELEPHONE, force: true,
    });
    if (intrus.donnees?.id) aNettoyer.push(intrus.donnees.id);

    verifie('>>> `force` NE FORCE RIEN DEPUIS /api/bookings <<<',
      intrus.status === 409, [intrus.status, intrus.donnees?.error]);
    verifie('et rien n\'a ete enregistre', !intrus.donnees?.id, intrus.donnees?.id);
  }
} finally {
  // >>> LE MENAGE EST DANS LE `finally`, PAS A LA FIN DU BLOC. <<< Un echec au
  //     milieu laisserait sinon une personne enregistree derriere lui, et les
  //     suites suivantes verraient un commerce a equipe la ou elles en
  //     attendent un sans — elles echoueraient toutes, pour une raison qui
  //     n'aurait rien a voir avec ce qu'elles verifient.
  if (aNettoyer.length) {
    await prisma.booking.deleteMany({ where: { id: { in: aNettoyer } } });
  }
  if (equipeDeTest.length) {
    await prisma.staff.deleteMany({ where: { id: { in: equipeDeTest } } });
  }

  // Puis l'equipe qui etait la avant nous, s'il y en avait une. APRES les
  // suppressions ci-dessus, jamais avant : sinon les deux personnes du test
  // seraient reecrites par le `PUT` et re-supprimees juste apres.
  await reposerEquipe(salon);

  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
