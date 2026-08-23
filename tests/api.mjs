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

// >>> CE QUE LA SECTION 10 POSE, ET QU'IL FAUT RETIRER QUOI QU'IL ARRIVE. <<<
//
// Elle FERME les journees qui precedent JOUR, pour forcer le bandeau a repondre
// sur JOUR. Un echec au milieu de la section les laisserait fermees : le
// commerce paraitrait ferme toute la semaine, et les suites suivantes
// echoueraient toutes pour une raison qui n'a rien a voir avec ce qu'elles
// verifient. Le menage est donc dans le `finally`, jamais a la fin du bloc.
let fermetureDuBandeau = null;
let bouchonDuBandeau = null;

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

  // --- 3 bis. Les coordonnees ---------------------------------------------
  //
  // >>> TROIS SAISIES PASSAIENT EN 201, ET AUCUNE N'AURAIT DU. <<< Constate en
  // direct sur l'instance en ligne : telephone « abc », courriel
  // « pasunemail », nom de cinq mille caracteres. Les deux premiers sont les
  // graves — le telephone est le SEUL moyen de joindre un client, et c'est
  // aussi le second facteur de /annuler.
  //
  // AUCUN DE CES REFUS NE CONSOMME LE CRENEAU : ils sont prononces avant la
  // moindre ecriture, et `premierLibre` reste disponible pour la section 4.
  console.log('\n3 bis. Les coordonnees');
  {
    const base = { date: JOUR, start: premierLibre.start, serviceId: 'coupe-barbe' };

    const tel = await visiteur.appel('POST', '/api/bookings',
      { ...base, name: 'Test', phone: 'abc' });
    verifie('>>> un telephone qui n\'en est pas est refuse <<<', tel.status === 400, tel);
    verifie('et le refus dit quoi taper',
      /06 12 34 56 78/.test(tel.donnees?.error ?? ''), tel.donnees?.error);

    const court = await visiteur.appel('POST', '/api/bookings',
      { ...base, name: 'Test', phone: '06 12' });
    verifie('un numero incomplet aussi', court.status === 400, court);

    const courriel = await visiteur.appel('POST', '/api/bookings',
      { ...base, name: 'Test', phone: '0600000000', email: 'pasunemail' });
    verifie('>>> un courriel qui n\'en est pas est refuse <<<', courriel.status === 400, courriel);

    const sansPoint = await visiteur.appel('POST', '/api/bookings',
      { ...base, name: 'Test', phone: '0600000000', email: 'a@b' });
    verifie('un domaine sans extension aussi', sansPoint.status === 400, sansPoint);

    const long = await visiteur.appel('POST', '/api/bookings',
      { ...base, name: 'x'.repeat(5000), phone: '0600000000' });
    verifie('>>> un nom de cinq mille caracteres est refuse, plus coupe <<<',
      long.status === 400, long.status);
    verifie('et le refus donne la limite',
      /80/.test(long.donnees?.error ?? ''), long.donnees?.error);

    // LE COURRIEL EST FACULTATIF, et le vide n'est pas une faute. Ce refus-ci
    // porte sur l'heure (deja prise plus bas), pas sur les coordonnees : ce
    // qu'on verifie, c'est qu'on est alle PLUS LOIN que la validation.
    const vide = await visiteur.appel('POST', '/api/bookings',
      { ...base, start: 545, name: 'Test', phone: '0600000000', email: '' });
    verifie('un courriel vide ne bloque pas la reservation',
      vide.status === 409, vide.status);
  }

  // --- 3 ter. Le miroir du navigateur dit-il la meme chose ? ---------------
  //
  // ⚠️ LES REGLES SONT ECRITES A DEUX ENDROITS, et elles doivent coincider :
  //    src/lib/coordonnees.js protege la base, js/07-tunnel.js evite un
  //    aller-retour au client. Deux regles qui divergent donnent le pire des
  //    cas — une page qui accepte ce que le serveur refuse, donc un message
  //    d'erreur general la ou il faudrait une indication sous le champ.
  //
  // Meme discipline que pour le balisage des prestations et des avis, ecrit
  // lui aussi des deux cotes et verifie par un test.
  console.log('\n3 ter. Le miroir du navigateur');
  {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const racine = fileURLToPath(new URL('..', import.meta.url));

    const serveur = await import('../src/lib/coordonnees.js');
    const source = await readFile(racine + 'src/page/js/07-tunnel.js', 'utf8');

    // Les deux fonctions du miroir, extraites telles quelles et rendues
    // appelables. On ne recopie pas leur code ici : ce test ne vaut que s'il
    // lit celui qui part reellement chez le visiteur.
    const extraire = (nom) => {
      const debut = source.indexOf(`function ${nom}(`);
      const fin = source.indexOf('\n}', debut) + 2;
      return new Function(`${source.slice(debut, fin)}; return ${nom};`)();
    };

    const telPage = extraire('telephonePlausible');
    const courrielPage = extraire('courrielPlausible');

    const numeros = ['abc', '0612345678', '06 12 34 56 78', '+33 6 12 34 56 78',
      '0033612345678', '+32 475 12 34 56', '06 12', '0612345678a', '1',
      '03.27.39.98.40', '+336123456789012345'];

    const desaccordsTel = numeros.filter((v) =>
      telPage(v) !== !serveur.normaliserTelephone(v).erreur);
    verifie(`les ${numeros.length} numeros obtiennent le meme verdict des deux cotes`,
      desaccordsTel.length === 0, desaccordsTel);

    const adresses = ['pasunemail', 'a@b', 'vincent@example.fr',
      'v@sous.domaine.co.uk', 'a b@c.fr', 'a@b.c', 'x'.repeat(200) + '@a.fr'];

    const desaccordsCourriel = adresses.filter((v) =>
      courrielPage(v) !== !serveur.validerCourriel(v).erreur);
    verifie(`les ${adresses.length} adresses aussi`,
      desaccordsCourriel.length === 0, desaccordsCourriel);
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
      // ECRIT A L'INTERNATIONALE, EXPRES. Le meme numero se tape de quatre
      // facons ; sans normalisation, l'export « clients » comptait quatre
      // personnes la ou il y en a une.
      phone: '+33 6 11 22 33 44',
      duration: 5,          // valeur fantaisiste : doit etre ignoree
      source: 'phone',      // tentative de se faire passer pour le salon
    });
    verifie('la reservation est acceptee', r.status === 201, r);
    verifie('la duree fantaisiste est ignoree (45 min)', r.donnees?.duration === 45, r.donnees?.duration);
    verifie("l'origine est forcee a 'online'", r.donnees?.source === 'online', r.donnees?.source);
    verifie('le nom est nettoye des espaces', r.donnees?.name === 'Camille Durand', r.donnees?.name);
    verifie('>>> le telephone est normalise a une seule ecriture <<<',
      r.donnees?.phone === '06 11 22 33 44', r.donnees?.phone);
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
    // ⚠️ `confirmConflicts` EST OBLIGATOIRE DES QU'UN RENDEZ-VOUS EST PRIS SUR
    //    LA PERIODE, et c'en est un cas : la reservation de la section 4 tient
    //    sur cette journee. Sans lui, le serveur repond 409 avec la liste des
    //    rendez-vous qu'il aurait recouverts — c'est ce qui alimente l'ecran
    //    « voila les trois personnes a rappeler » (lot 3c), et c'est verifie
    //    dans tests/blocages.mjs.
    const r = await salon.appel('POST', '/api/admin/day-block',
      { date: JOUR, confirmConflicts: true });
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
    await salon.appel('POST', '/api/admin/day-block', { date: JOUR, confirmConflicts: true });
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

  // --- 10. LE BANDEAU D'ETAT, ET SON « DÈS » -------------------------------
  //
  // >>> LE BANDEAU ET LE TUNNEL ANNONCAIENT DEUX HEURES DIFFERENTES. <<<
  //
  // Releve le 20 aout : « PROCHAIN CRÉNEAU AUJOURD'HUI 17H15 » en haut de la
  // page, et 17:15 barre dans le tunnel, dont le premier creneau reel etait
  // 17:30. Les deux calculs etaient justes : le bandeau compte sur la
  // prestation la plus COURTE (`prestationDeReference()`), le tunnel sur celle
  // que le visiteur vient de choisir, qui ne tient pas dans le meme trou.
  // C'etait la FORMULATION qui etait fausse.
  //
  // Cette section reconstruit exactement ce cas, et verifie les deux choses
  // qu'il met en jeu :
  //
  //   1. le bandeau compte bien sur la plus courte, MEME QUAND CE N'EST PAS LA
  //      PREMIERE DU CATALOGUE — « Contours » dure 10 min et se trouve en
  //      position 7 ;
  //   2. la phrase dit « DÈS », le seul mot qui la rende vraie dans les deux
  //      cas a la fois.
  console.log('\n10. Le bandeau d\'etat');
  {
    const AUJOURDHUI = new Date();
    const iso = `${AUJOURDHUI.getFullYear()}-${String(AUJOURDHUI.getMonth() + 1).padStart(2, '0')}-${String(AUJOURDHUI.getDate()).padStart(2, '0')}`;
    const VEILLE = addJours(JOUR, -1);

    // On ferme tout ce qui precede JOUR : le bandeau doit alors repondre sur
    // JOUR, et sur lui seul. `prochainJourOuvert()` rend toujours aujourd'hui
    // + 2 au moins, la plage n'est donc jamais vide et ne touche jamais JOUR.
    const ferme = await salon.appel('POST', '/api/admin/day-block',
      { date: iso, to: VEILLE, motif: 'Sonde du bandeau' });

    // ⚠️ « DEJA FERME » EST UNE REUSSITE ICI, ET LE TEST L'A LONGTEMPS COMPTE
    //    COMME UN ECHEC. Lancee un DIMANCHE, cette suite demande de fermer
    //    [aujourd'hui, veille de JOUR] — c'est-a-dire dimanche et lundi, les
    //    deux jours ou le commerce est deja ferme. La route refuse alors, a
    //    juste titre : il n'y a rien a fermer. L'etat que cette section veut
    //    — aucun creneau avant JOUR — est pourtant atteint, et par la base
    //    elle-meme. Le controle portait sur le code de reponse ; il porte
    //    desormais sur ce qu'il verifiait vraiment.
    //
    //    Un dimanche sur sept, `npm test` s'arretait donc ici, sur une suite
    //    qui passait tous les autres jours.
    const dejaFerme = ferme.status === 409
      && /déjà fermé/.test(ferme.donnees?.error ?? '');

    verifie('les jours qui precedent sont fermes',
      ferme.status === 201 || dejaFerme, ferme.donnees);
    if (ferme.status === 201) fermetureDuBandeau = { date: iso, to: VEILLE };

    // UN BOUCHON JUSTE APRES LE PREMIER CRENEAU LIBRE, et il laisse exactement
    // un quart d'heure derriere lui.
    //
    //   Contours (10 min) a S : [S, S+10) — libre.
    //   Coupe homme (25 min) a S : [S, S+25) — mord sur [S+15, S+30), pris.
    //
    // ⚠️ S EST CALCULE, PAS ECRIT EN DUR. Les sections precedentes de cette
    //    suite reservent sur la meme journee : une heure figee etait deja prise
    //    au moment ou l'on arrive ici, et le test echouait sous `npm test` tout
    //    en passant seul. L'heure doit en outre tomber sur la grille (pas de
    //    15 min), sinon la route refuse — a juste titre — « Cette heure ne
    //    correspond a aucun creneau propose ».
    const vueCourte = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=contours`);
    const grille = vueCourte.donnees?.slots ?? [];
    const S = grille.find((c, i) => c.free && grille[i + 1]?.free
      && grille[i + 1].start === c.start + 15)?.start;
    verifie('un creneau libre suivi d\'un autre existe', Number.isInteger(S), S);

    const bouchon = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: S + 15, serviceId: 'coupe-tondeuse', name: 'Bouchon (test)',
    });
    verifie('le bouchon d\'un quart d\'heure est pose', bouchon.status === 201, bouchon.donnees);

    const etat = await visiteur.appel('GET', '/api/status');
    verifie('le bandeau repond', etat.status === 200, etat.status);

    verifie('>>> LA PHRASE DIT « DÈS » <<<',
      /PROCHAIN CRÉNEAU .+ DÈS \d+H\d\d/.test(etat.donnees?.prochain ?? ''),
      etat.donnees?.prochain);

    // L'heure attendue, ecrite comme le bandeau l'ecrit : sans zero initial.
    const attendue = `${Math.floor(S / 60)}H${String(S % 60).padStart(2, '0')}`;
    verifie(`elle annonce bien ${attendue}`,
      etat.donnees?.prochain?.endsWith(`DÈS ${attendue}`), [etat.donnees?.prochain, attendue]);

    // >>> ET C'EST LA QUE LE MOT SE JUSTIFIE. <<< A la meme heure, le tunnel
    //     refuse ce creneau pour une prestation ordinaire : le bandeau ne
    //     promet donc pas « telle heure », il promet « rien avant telle heure ».
    const tunnel = await visiteur.appel('GET', `/api/slots?date=${JOUR}&serviceId=coupe-homme`);
    const aS = (tunnel.donnees?.slots ?? []).find((c) => c.start === S);
    verifie('a la meme heure, une coupe homme ne tient pas dans ce trou',
      aS?.free === false, aS);

    const premierLibreLong = (tunnel.donnees?.slots ?? []).find((c) => c.free)?.start;
    verifie('son premier creneau reel est plus tard',
      premierLibreLong > S, [S, premierLibreLong]);

    // >>> LA PLUS COURTE, PAS LA PREMIERE DU CATALOGUE. <<< C'est le cas de
    //     figure demande, et la base l'offre telle quelle : « Contours » dure
    //     10 min et occupe la position 7, alors que la premiere du catalogue en
    //     dure 25. On ne se contente donc pas de comparer deux identifiants —
    //     on verifie que la PREMIERE ne tient pas dans le trou qu'on vient de
    //     laisser. Un bandeau qui la prendrait n'aurait pas pu annoncer cette
    //     heure-la.
    const catalogue = await visiteur.appel('GET', '/api/config');
    const actives = (catalogue.donnees?.services ?? []).filter((s) => s.active !== false);
    const plusCourte = [...actives].sort((a, b) => a.duration - b.duration)[0];
    verifie('la plus courte du catalogue n\'est pas la premiere',
      plusCourte && actives[0] && plusCourte.id !== actives[0].id,
      [plusCourte?.id, actives[0]?.id]);

    const premiere = await visiteur.appel('GET',
      `/api/slots?date=${JOUR}&serviceId=${actives[0]?.id}`);
    const premiereAS = (premiere.donnees?.slots ?? []).find((c) => c.start === S);
    verifie('>>> ET LA PREMIERE DU CATALOGUE N\'Y TIENT PAS <<<',
      premiereAS?.free === false, [actives[0]?.id, actives[0]?.duration, premiereAS]);

    if (bouchon.donnees?.id) bouchonDuBandeau = bouchon.donnees.id;

    const rouvert = await salon.appel('DELETE',
      `/api/admin/day-block?date=${iso}&to=${VEILLE}`);
    verifie('les jours fermes sont rouverts', rouvert.status === 200, rouvert.status);
    if (rouvert.status === 200) fermetureDuBandeau = null;
  }

  // --- 11. Divers ---------------------------------------------------------
  console.log('\n11. Divers');
  {
    const r = await visiteur.appel('GET', '/api/nimporte-quoi');
    verifie('une adresse /api inconnue renvoie du JSON, pas la page du site',
      r.status === 404 && r.donnees?.error, r);
  }
} finally {
  if (bouchonDuBandeau) {
    await salon.appel('DELETE', `/api/admin/bookings/${bouchonDuBandeau}`);
  }
  if (fermetureDuBandeau) {
    await salon.appel('DELETE',
      `/api/admin/day-block?date=${fermetureDuBandeau.date}&to=${fermetureDuBandeau.to}`);
  }
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
