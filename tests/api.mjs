// ---------------------------------------------------------------------------
// TESTS DE L'API DES RESERVATIONS
//
// A relancer apres chaque modification du serveur : si un test echoue, c'est
// qu'un comportement attendu a ete casse quelque part.
//
// Le serveur doit tourner AVANT de lancer ces tests. Dans deux terminaux :
//     npm start          (terminal 1, laisse ouvert)
//     npm run test:api   (terminal 2)
//
// Deux "navigateurs" sont simules : `visiteur` (personne quelconque, non
// connecte) et `salon` (le commercant, connecte). C'est ce qui permet de
// verifier qu'un visiteur ne peut pas atteindre l'agenda.
//
// Les tests nettoient derriere eux : le rendez-vous et le blocage qu'ils creent
// sont annules a la fin, la base retrouve son etat initial.
// ---------------------------------------------------------------------------

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

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const JOUR = prochainJourOuvert();

/** Meme calcul que src/lib/time.js, redit ici pour ne rien importer du serveur. */
const addJours = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

console.log(`Journee de test : ${JOUR}\n`);

try {
  // --- 1. Test de vie -----------------------------------------------------
  console.log('1. Test de vie');
  {
    const r = await visiteur.appel('GET', '/api/health');
    verifie('le serveur repond', r.status === 200 && r.donnees.ok === true, r.donnees);
    verifie('le fuseau est Europe/Paris', r.donnees?.fuseau === 'Europe/Paris', r.donnees?.fuseau);
  }

  // --- 2. Creneaux --------------------------------------------------------
  console.log('\n2. Creneaux disponibles');
  let premierLibre = null;
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('la liste est renvoyee', r.status === 200 && Array.isArray(r.donnees.slots), r.donnees);

    const creneaux = r.donnees.slots ?? [];
    console.log(`     ${creneaux.length} creneaux : ` +
      creneaux.map((c) => c.label + (c.free ? '' : ' (pris)')).join(', '));

    verifie('la duree vient de la prestation (45 min)', r.donnees.duration === 45, r.donnees.duration);
    verifie('aucun creneau ne chevauche la pause 12h-14h',
      creneaux.every((c) => !(c.start < 840 && c.start + 45 > 720)),
      creneaux.filter((c) => c.start < 840 && c.start + 45 > 720).map((c) => c.label));
    verifie('aucun creneau ne depasse la fermeture 19h00',
      creneaux.every((c) => c.start + 45 <= 1140));
    verifie('le premier creneau est a 09h00', creneaux[0]?.label === '09:00', creneaux[0]);

    premierLibre = creneaux.find((c) => c.free);
    verifie('au moins un creneau est libre', Boolean(premierLibre));
  }

  // --- 3. Refus des demandes invalides ------------------------------------
  console.log('\n3. Refus des demandes invalides');
  {
    const r = await visiteur.appel('GET', '/api/slots?date=2026-02-31&serviceId=coupe');
    verifie('date inexistante (31 fevrier) refusee', r.status === 400, r);
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=nexistepas`);
    verifie('prestation inconnue refusee', r.status === 404, r);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: '2020-01-07', start: 570, serviceId: 'coupe-barbe', name: 'Test', phone: '0600000000',
    });
    verifie('date passee refusee', r.status === 409, r);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      // 09h05 : le pas est de 15 minutes, cette heure ne tombe sur aucun creneau.
      date: JOUR, start: 545, serviceId: 'coupe-barbe', name: 'Test', phone: '0600000000',
    });
    verifie('heure hors grille (09h05) refusee', r.status === 409, r);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      // 22h00, et non 20h00 : le vendredi, ce commerce est encore ouvert a 20h.
      date: JOUR, start: 1320, serviceId: 'coupe-barbe', name: 'Test', phone: '0600000000',
    });
    verifie('heure apres fermeture (22h00) refusee', r.status === 409, r);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: premierLibre.start, serviceId: 'coupe-barbe', phone: '0600000000',
    });
    verifie('nom manquant refuse', r.status === 400, r);
  }

  // --- 4. Reservation en ligne --------------------------------------------
  console.log('\n4. Reservation en ligne');
  let idReserve = null;
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR,
      start: premierLibre.start,
      serviceId: 'coupe-barbe',
      name: '  Camille Durand  ',
      phone: '06 11 22 33 44',
      duration: 5,          // valeur fantaisiste : doit etre ignoree
      source: 'phone',      // tentative de se faire passer pour le salon
    });
    verifie('la reservation est acceptee', r.status === 201, r);
    verifie('la duree fantaisiste est ignoree (45 min)', r.donnees?.duration === 45, r.donnees?.duration);
    verifie("l'origine est forcee a 'online'", r.donnees?.source === 'online', r.donnees?.source);
    verifie('le nom est nettoye des espaces', r.donnees?.name === 'Camille Durand', r.donnees?.name);
    idReserve = r.donnees?.id;
    console.log(`     reserve a ${hhmm(premierLibre.start)} -> id ${idReserve}`);
  }
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: premierLibre.start, serviceId: 'coupe-barbe', name: 'Doublon', phone: '0600000000',
    });
    verifie('le meme creneau est refuse la seconde fois', r.status === 409, r);
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    const creneau = r.donnees.slots.find((c) => c.start === premierLibre.start);
    verifie('le creneau apparait desormais occupe', creneau && creneau.free === false, creneau);
  }
  {
    // Un forfait de 60 min pose juste avant doit deborder sur le creneau suivant.
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-rasage`);
    const bloque = r.donnees.slots.find((c) => c.start === premierLibre.start - 15);
    verifie('une prestation longue voit bien le chevauchement',
      bloque ? bloque.free === false : true, bloque);
  }

  // --- 5. L'agenda est hors de portee d'un visiteur -----------------------
  console.log("\n5. L'agenda est hors de portee d'un visiteur");
  {
    const r = await visiteur.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
    verifie('lire l\'agenda sans etre connecte est refuse', r.status === 401, r.status);
    verifie('aucun nom de cliente ne fuit', r.donnees?.bookings === undefined, Object.keys(r.donnees ?? {}));
  }
  {
    const r = await visiteur.appel('DELETE', `/api/admin/bookings/${idReserve}`);
    verifie('annuler un rendez-vous sans etre connecte est refuse', r.status === 401, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/admin/day-block', { date: JOUR });
    verifie('bloquer une journee sans etre connecte est refuse', r.status === 401, r.status);
  }

  // --- 6. Espace commercant -----------------------------------------------
  console.log('\n6. Espace commercant (connecte)');
  {
    const r = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
    verifie("l'agenda du jour est lisible", r.status === 200 && Array.isArray(r.donnees.bookings), r.status);
    console.log(`     ${r.donnees.bookings.length} rendez-vous ce jour-la`);
    verifie('la reservation precedente y figure',
      r.donnees.bookings.some((b) => b.id === idReserve));
  }
  {
    const r = await salon.appel('POST', '/api/admin/day-block', { date: JOUR });
    verifie('la journee peut etre bloquee', r.status === 201 && r.donnees.type === 'block', r);
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('plus aucun creneau libre une fois la journee bloquee',
      r.donnees.slots.every((c) => c.free === false));
  }
  {
    const r = await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
    verifie('le blocage peut etre retire', r.status === 200 && r.donnees.removed === 1, r);
  }
  {
    const r = await salon.appel('DELETE', `/api/admin/bookings/${idReserve}`);
    verifie('le rendez-vous peut etre annule', r.status === 200, r);
  }
  {
    const r = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
    const creneau = r.donnees.slots.find((c) => c.start === premierLibre.start);
    verifie('le creneau redevient libre apres annulation', creneau?.free === true, creneau);
  }
  {
    const r = await salon.appel('DELETE', `/api/admin/bookings/${idReserve}`);
    verifie('annuler deux fois renvoie une erreur claire', r.status === 404, r);
  }

  // --- 7. Etat des journees (calendrier du site) --------------------------
  //
  // Le calendrier grise les jours complets. Sans cette adresse, il faudrait
  // demander les creneaux de chacun des trente jours du mois affiche.
  console.log('\n7. Etat des journees');
  const FIN = addJours(JOUR, 20);
  {
    const r = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${FIN}&serviceId=coupe-barbe`);
    verifie('la periode est renvoyee jour par jour',
      r.status === 200 && r.donnees.days?.length === 21, r.donnees?.days?.length);
    verifie('chaque jour porte un etat connu',
      r.donnees.days.every((j) => ['open', 'closed', 'full'].includes(j.state)),
      r.donnees.days.filter((j) => !['open', 'closed', 'full'].includes(j.state)));

    const lundis = r.donnees.days.filter((j) => new Date(j.date + 'T12:00:00Z').getUTCDay() === 1);
    verifie('les jours de fermeture sont annonces fermes',
      lundis.length > 0 && lundis.every((j) => j.state === 'closed'), lundis);
    verifie('la journee de test est ouverte',
      r.donnees.days[0].date === JOUR && r.donnees.days[0].state === 'open', r.donnees.days[0]);
  }
  {
    const r = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${addJours(JOUR, 90)}&serviceId=coupe-barbe`);
    verifie('une periode demesuree est refusee', r.status === 400, r.status);
  }
  {
    const r = await visiteur.appel('GET', `/api/days?from=${FIN}&to=${JOUR}&serviceId=coupe-barbe`);
    verifie('des dates a l\'envers sont refusees', r.status === 400, r.status);
  }
  {
    const r = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${FIN}&serviceId=nexistepas`);
    verifie('prestation inconnue refusee', r.status === 404, r.status);
  }
  {
    await salon.appel('POST', '/api/admin/day-block', { date: JOUR });
    const r = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${JOUR}&serviceId=coupe-barbe`);
    verifie('une journee bloquee est annoncee complete',
      r.donnees.days[0]?.state === 'full', r.donnees.days[0]);
    await salon.appel('DELETE', `/api/admin/day-block?date=${JOUR}`);
  }

  // --- 8. Annulation par la cliente ---------------------------------------
  //
  // L'identifiant seul ne doit jamais suffire : il est en partie previsible.
  console.log('\n8. Annulation par la cliente');
  {
    const r = await visiteur.appel('POST', '/api/bookings', {
      date: JOUR, start: premierLibre.start, serviceId: 'coupe-barbe',
      name: 'Alice Annulation', phone: '0611111111',
    });
    verifie('la reservation aboutit', r.status === 201, r.status);

    const id = r.donnees?.id;
    const jeton = r.donnees?.cancelToken;
    verifie('un jeton d\'annulation est remis a la cliente',
      typeof jeton === 'string' && jeton.length >= 40, jeton?.length);

    {
      const vu = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
      const ligne = vu.donnees.bookings.find((b) => b.id === id);
      verifie('le jeton ne ressort jamais dans l\'agenda',
        ligne && ligne.cancelToken === undefined, Object.keys(ligne ?? {}));
    }
    {
      const r2 = await visiteur.appel('DELETE', `/api/bookings/${id}`);
      verifie('annuler sans jeton est refuse', r2.status === 404, r2.status);
    }
    {
      const r2 = await visiteur.appel('DELETE', `/api/bookings/${id}?token=jeton-invente`);
      verifie('annuler avec un jeton invente est refuse', r2.status === 404, r2.status);
    }
    {
      const r2 = await visiteur.appel('DELETE', `/api/bookings/inconnu?token=${encodeURIComponent(jeton)}`);
      verifie('un identifiant inconnu renvoie la meme reponse', r2.status === 404, r2.status);
    }
    {
      const r2 = await visiteur.appel('DELETE', `/api/bookings/${id}?token=${encodeURIComponent(jeton)}`);
      verifie('le bon jeton annule le rendez-vous', r2.status === 200, r2);
    }
    {
      const creneaux = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-barbe`);
      const creneau = creneaux.donnees.slots.find((c) => c.start === premierLibre.start);
      verifie('le creneau est libere', creneau?.free === true, creneau);
    }
    {
      const r2 = await visiteur.appel('DELETE', `/api/bookings/${id}?token=${encodeURIComponent(jeton)}`);
      verifie('rejouer l\'annulation ne fait rien', r2.status === 404, r2.status);
    }
  }
  {
    // Un rendez-vous saisi par le salon n'a pas de jeton : il ne s'annule que
    // depuis l'espace commercant.
    const cree = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: premierLibre.start, serviceId: 'coupe-barbe',
      name: 'Rendez-vous telephonique', phone: '0622222222',
    });
    verifie('le salon peut saisir un rendez-vous', cree.status === 201, cree.status);

    const r = await visiteur.appel('DELETE', `/api/bookings/${cree.donnees.id}?token=peu-importe`);
    verifie('un visiteur ne peut pas l\'annuler', r.status === 404, r.status);

    const menage = await salon.appel('DELETE', `/api/admin/bookings/${cree.donnees.id}`);
    verifie('le salon, lui, peut l\'annuler', menage.status === 200, menage.status);
  }

  // --- 9. Creneaux cote commercant ----------------------------------------
  console.log('\n9. Creneaux cote commercant');
  {
    const r = await visiteur.appel('GET', `/api/admin/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('inaccessibles sans connexion', r.status === 401, r.status);
  }
  {
    const r = await salon.appel('GET', `/api/admin/slots?date=${JOUR}&serviceId=coupe-barbe`);
    verifie('la liste est renvoyee au salon',
      r.status === 200 && Array.isArray(r.donnees.slots), r.status);
    verifie('la duree vient de la prestation', r.donnees?.duration === 45, r.donnees?.duration);
  }
  {
    // Une prestation en pause disparait du site mais reste calable a la main :
    // c'est toute la difference entre les deux adresses.
    const reglages = await salon.appel('GET', '/api/admin/settings');
    const brouillon = JSON.parse(JSON.stringify(reglages.donnees));
    brouillon.services.find((s) => s.id === 'soin-visage').active = false;

    const enregistre = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la mise en pause est enregistree', enregistre.status === 200, enregistre.status);

    const publique = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=soin-visage`);
    verifie('le public ne peut plus reserver une prestation en pause',
      publique.status === 409, publique.status);

    const jours = await visiteur.appel('GET', `/api/days?from=${JOUR}&to=${JOUR}&serviceId=soin-visage`);
    verifie('elle disparait aussi du calendrier public', jours.status === 409, jours.status);

    const cote = await salon.appel('GET', `/api/admin/slots?date=${JOUR}&serviceId=soin-visage`);
    verifie('le salon peut toujours la caler lui-meme',
      cote.status === 200 && cote.donnees.slots.length > 0, cote.status);

    const retour = await salon.appel('PUT', '/api/admin/settings',
      { ...reglages.donnees, confirmRemovals: true });
    verifie('les reglages sont remis en etat', retour.status === 200, retour.status);
  }

  // --- 10. Divers ---------------------------------------------------------
  console.log('\n10. Divers');
  {
    const r = await visiteur.appel('GET', '/api/nimporte-quoi');
    verifie('une adresse /api inconnue renvoie du JSON, pas la page du site',
      r.status === 404 && r.donnees?.error, r);
  }
} finally {
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
