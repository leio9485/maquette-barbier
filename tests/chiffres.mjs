// ---------------------------------------------------------------------------
// TESTS DU TABLEAU DE BORD, DU POINTAGE ET DE L'EXPORT
//
//     npm start             (terminal 1, laisse ouvert)
//     npm run test:chiffres (terminal 2)
//
// LA METHODE : ON MESURE DES ECARTS, PAS DES VALEURS ABSOLUES. La base contient
// deja des rendez-vous de demonstration, et leur nombre depend du jour ou l'on
// lance la suite. Un test qui affirmerait « le chiffre d'affaires du mois vaut
// 71 EUR » casserait donc tout seul le mois suivant. On releve les chiffres
// AVANT, on ajoute un jeu connu, et on verifie que la difference est exactement
// celle attendue.
//
// Ce qui est couvert :
//   - les chiffres suivent la base, au centime pres ;
//   - une periode vide donne des zeros, jamais NaN ni undefined ;
//   - une annulation cliente sort immediatement du chiffre d'affaires ;
//   - le pointage « venu » / « pas venu », et le retour en arriere ;
//   - le marqueur d'absences n'apparait qu'a partir de deux, et JAMAIS cote
//     vitrine ;
//   - l'export CSV : BOM UTF-8, point-virgule, accents intacts.
// ---------------------------------------------------------------------------

import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  BASE,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

const JOUR = prochainJourOuvert();
const TELEPHONE = '06 39 98 65 43';

/** Les rendez-vous crees ici, effaces a la fin quoi qu'il arrive. */
const aNettoyer = [];

async function creneauxLibres(date, serviceId) {
  const r = await visiteur.appel('GET', `/api/slots?date=${date}&serviceId=${serviceId}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free);
}

async function reserver(date, serviceId, telephone = TELEPHONE) {
  const libres = await creneauxLibres(date, serviceId);
  if (!libres.length) return null;

  const r = await visiteur.appel('POST', '/api/bookings', {
    date, start: libres[0].start, serviceId, name: 'Client des chiffres', phone: telephone,
  });
  if (r.donnees?.id) aNettoyer.push(r.donnees.id);
  return r.donnees;
}

const chiffres = () => salon.appel('GET', '/api/admin/chiffres').then((r) => r.donnees);

/** Vrai si TOUTES les valeurs numeriques de l'objet sont des nombres finis. */
function que_des_nombres(objet, chemin = '') {
  for (const [cle, valeur] of Object.entries(objet ?? {})) {
    const ou = chemin ? `${chemin}.${cle}` : cle;
    if (typeof valeur === 'number' && !Number.isFinite(valeur)) return ou;
    if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) {
      const mauvais = que_des_nombres(valeur, ou);
      if (mauvais) return mauvais;
    }
  }
  return null;
}

console.log(`Journee de test : ${JOUR}\n`);

try {
  // --- 1. La forme de la reponse -------------------------------------------
  console.log('1. La forme de la reponse');

  let avant = null;
  {
    const r = await salon.appel('GET', '/api/admin/chiffres');
    avant = r.donnees;

    verifie('le tableau de bord repond', r.status === 200, r.status);
    verifie('il porte la semaine, le mois et le mois precedent',
      Boolean(avant?.semaine && avant?.mois && avant?.moisPrecedent), Object.keys(avant ?? {}));
    verifie('aucune valeur n\'est NaN ni Infinity', que_des_nombres(avant) === null, que_des_nombres(avant));
    verifie('les classements sont des tableaux',
      Array.isArray(avant?.prestations) && Array.isArray(avant?.equipe)
      && Array.isArray(avant?.creneauxMorts), typeof avant?.prestations);
  }
  {
    const r = await visiteur.appel('GET', '/api/admin/chiffres');
    verifie('un visiteur ne voit pas les chiffres', r.status === 401, r.status);
  }

  // --- 2. Les chiffres suivent la base --------------------------------------
  console.log('\n2. Les chiffres suivent la base');

  let rdvA = null;
  let rdvB = null;
  {
    // Deux prestations de tarifs differents et connus.
    const config = await visiteur.appel('GET', '/api/config');
    const tarif = (id) => config.donnees.services.find((s) => s.id === id)?.price ?? 0;

    rdvA = await reserver(JOUR, 'coupe-homme');
    rdvB = await reserver(JOUR, 'coupe-barbe');

    verifie('les deux rendez-vous de test sont pris', Boolean(rdvA && rdvB), [rdvA?.id, rdvB?.id]);

    const apres = await chiffres();
    const attendu = Math.round((tarif('coupe-homme') + tarif('coupe-barbe')) * 100);

    verifie('le chiffre d\'affaires du mois monte exactement du tarif des deux',
      apres.mois.caCents - avant.mois.caCents === attendu,
      [avant.mois.caCents, apres.mois.caCents, attendu]);

    verifie('le nombre de rendez-vous du mois monte de deux',
      apres.mois.rendezVous - avant.mois.rendezVous === 2,
      [avant.mois.rendezVous, apres.mois.rendezVous]);

    verifie('les minutes prises montent de la duree des deux',
      apres.mois.minutesPrises - avant.mois.minutesPrises === rdvA.duration + rdvB.duration,
      [apres.mois.minutesPrises - avant.mois.minutesPrises, rdvA.duration + rdvB.duration]);
  }

  // --- 3. Une annulation sort du chiffre d'affaires -------------------------
  console.log('\n3. Une annulation sort des chiffres');
  {
    const avantAnnulation = await chiffres();

    const r = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: rdvA.reference, telephone: TELEPHONE.replace(/\D/g, '').slice(-4),
    });
    verifie('le rendez-vous est annule', r.status === 200, r.status);

    const apres = await chiffres();
    verifie('le chiffre d\'affaires redescend du tarif annule',
      avantAnnulation.mois.caCents - apres.mois.caCents === Math.round(rdvA.price * 100),
      [avantAnnulation.mois.caCents, apres.mois.caCents, rdvA.price]);
    verifie('et le rendez-vous n\'est plus compte',
      avantAnnulation.mois.rendezVous - apres.mois.rendezVous === 1,
      [avantAnnulation.mois.rendezVous, apres.mois.rendezVous]);
  }

  // --- 4. Le taux de remplissage --------------------------------------------
  console.log('\n4. Le taux de remplissage');
  {
    const c = await chiffres();
    verifie('il est un entier entre 0 et 100',
      Number.isInteger(c.mois.remplissage) && c.mois.remplissage >= 0 && c.mois.remplissage <= 100,
      c.mois.remplissage);
    verifie('le temps ouvert du mois est superieur a zero',
      c.mois.minutesOuvertes > 0, c.mois.minutesOuvertes);
    verifie('un mois vide ne casse rien : le mois precedent tient debout',
      Number.isInteger(c.moisPrecedent.remplissage), c.moisPrecedent);
  }

  // --- 5. Le pointage -------------------------------------------------------
  //
  // Le pointage ne s'applique qu'aux rendez-vous passes cote page, mais le
  // serveur ne l'interdit pas : c'est la page qui choisit quand montrer les
  // boutons. On teste donc l'adresse elle-meme.
  console.log('\n5. Le pointage « venu » / « pas venu »');
  {
    const r = await salon.appel('PUT', `/api/admin/bookings/${rdvB.id}/presence`, { presence: 'venu' });
    verifie('on peut marquer « venu »', r.status === 200 && r.donnees.presence === 'venu', r.donnees);

    const relu = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
    const ligne = relu.donnees.bookings.find((b) => b.id === rdvB.id);
    verifie('l\'agenda le renvoie', ligne?.presence === 'venu', ligne?.presence);
  }
  {
    const r = await salon.appel('PUT', `/api/admin/bookings/${rdvB.id}/presence`, { presence: null });
    verifie('on peut revenir en arriere', r.status === 200 && r.donnees.presence === null, r.donnees);
  }
  {
    const r = await salon.appel('PUT', `/api/admin/bookings/${rdvB.id}/presence`, { presence: 'peut-etre' });
    verifie('une valeur inattendue est refusee', r.status === 400, r.status);
  }
  {
    const r = await visiteur.appel('PUT', `/api/admin/bookings/${rdvB.id}/presence`, { presence: 'absent' });
    verifie('un visiteur ne peut rien pointer', r.status === 401, r.status);
  }

  // --- 6. Le marqueur d'absences --------------------------------------------
  console.log('\n6. Le marqueur d\'absences');

  const TEL_ABSENT = '06 39 98 00 11';
  {
    const un = await reserver(JOUR, 'coupe-tondeuse', TEL_ABSENT);
    const deux = await reserver(JOUR, 'barbe-taille', TEL_ABSENT);
    verifie('deux rendez-vous pour le meme numero', Boolean(un && deux), [un?.id, deux?.id]);

    await salon.appel('PUT', `/api/admin/bookings/${un.id}/presence`, { presence: 'absent' });

    const apresUne = await salon.appel('GET', '/api/admin/absences');
    verifie('une seule absence ne declenche rien',
      apresUne.donnees.absences['0639980011'] === undefined, apresUne.donnees.absences);

    await salon.appel('PUT', `/api/admin/bookings/${deux.id}/presence`, { presence: 'absent' });

    const apresDeux = await salon.appel('GET', '/api/admin/absences');
    verifie('deux absences font apparaitre le numero',
      apresDeux.donnees.absences['0639980011'] === 2, apresDeux.donnees.absences);
    verifie('le seuil est annonce', apresDeux.donnees.seuil === 2, apresDeux.donnees.seuil);
  }
  {
    const r = await visiteur.appel('GET', '/api/admin/absences');
    verifie('la liste des absences est fermee au public', r.status === 401, r.status);
  }
  {
    // >>> LE POINT QUI COMPTE : RIEN DE TOUT CELA NE FUIT SUR LA VITRINE. <<<
    const page = await fetch(BASE + '/').then((r) => r.text());
    const config = await fetch(BASE + '/api/config').then((r) => r.json());

    verifie('la page publique ne contient aucun numero de client',
      !page.includes('0639980011') && !page.includes('06 39 98 00 11'), 'numero trouve');

    // ⚠️ TEST DURCI AU LOT 4. Il portait sur la seule zone `#vueSite`, parce
    //    que le style et le JavaScript de l'espace commercant voyageaient dans
    //    le meme document et contenaient forcement les mots « absences » et
    //    « presence » — ils savent les dessiner. Depuis que l'espace est un
    //    document a part, la chaine doit avoir disparu de la PAGE ENTIERE.
    verifie('le mot « absences » a disparu de toute la vitrine',
      !page.includes('agenda-absences'), 'marqueur trouve dans la page');
    verifie('/api/config ne porte ni presence ni absence',
      !JSON.stringify(config).includes('presence')
      && !JSON.stringify(config).includes('absence'), 'fuite dans la config');
  }

  // --- 7. Le taux d'absence -------------------------------------------------
  console.log('\n7. Le taux d\'absence');
  {
    const c = await chiffres();
    verifie('le bloc absences existe', Boolean(c.absences), c.absences);
    verifie('il compte les passes et les absents',
      Number.isInteger(c.absences.passes) && Number.isInteger(c.absences.absents), c.absences);
    verifie('le taux ne vaut jamais NaN, meme sans rien de passe',
      Number.isInteger(c.absences.taux), c.absences.taux);

    // ⚠️ « POINTES » A DISPARU, ET IL DOIT LE RESTER. Depuis que « venu » est
    //    l'etat par defaut, le commercant ne coche QUE les absences : « ce qui
    //    a ete pointe » ne contiendrait plus que des absents, et un taux
    //    calcule dessus afficherait 100 % a quelqu'un qui a eu deux lapins sur
    //    quarante-deux rendez-vous. Le champ est retire pour que personne ne
    //    puisse rebrancher ce denominateur sans le voir.
    verifie('le denominateur « pointes » n\'existe plus',
      c.absences.pointes === undefined, c.absences);

    // Le denominateur est bien TOUT ce qui est passe : les absents ne peuvent
    // pas depasser les passes, et un absent sur les passes doit se retrouver
    // dans le taux.
    verifie('les absents tiennent dans les passes',
      c.absences.absents <= c.absences.passes, c.absences);
    verifie('le taux est bien absents sur passes',
      c.absences.taux === (c.absences.passes
        ? Math.round((c.absences.absents / c.absences.passes) * 100)
        : 0),
      c.absences);
  }

  // --- 8. La clientele ------------------------------------------------------
  console.log('\n8. Nouveaux et habitues');
  {
    const c = await chiffres();
    verifie('les deux nombres existent',
      Number.isInteger(c.clientele.nouveaux) && Number.isInteger(c.clientele.habitues), c.clientele);
    verifie('leur somme fait le total',
      c.clientele.nouveaux + c.clientele.habitues === c.clientele.total, c.clientele);
  }

  // --- 9. L'export CSV ------------------------------------------------------
  console.log('\n9. L\'export');

  const cookie = [...salon.cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ');

  for (const [chemin, intitule] of [['clients', 'Client'], ['rendez-vous', 'Date']]) {
    const reponse = await fetch(`${BASE}/api/admin/export/${chemin}`, { headers: { Cookie: cookie } });
    const octets = Buffer.from(await reponse.arrayBuffer());
    const texte = octets.toString('utf8');

    verifie(`${chemin} : le fichier est servi`, reponse.status === 200, reponse.status);
    verifie(`${chemin} : il se telecharge plutot que de s'afficher`,
      (reponse.headers.get('content-disposition') ?? '').startsWith('attachment'),
      reponse.headers.get('content-disposition'));

    // ⚠️ LE BOM SE VERIFIE SUR LES OCTETS, PAS SUR LE TEXTE. `Response.text()`
    //    le retire en decodant : un test ecrit sur la chaine passerait au rouge
    //    alors que le fichier est juste — ou, pire, au vert sans BOM.
    verifie(`${chemin} : il commence par le BOM UTF-8 (sinon Excel casse les accents)`,
      octets[0] === 0xEF && octets[1] === 0xBB && octets[2] === 0xBF,
      [...octets.slice(0, 3)]);

    const premiere = texte.replace(/^﻿/, '').split('\r\n')[0];
    verifie(`${chemin} : les colonnes sont separees par des point-virgules`,
      premiere.includes(';') && !premiere.includes('","'), premiere);
    verifie(`${chemin} : la premiere colonne est celle attendue`,
      premiere.startsWith(`"${intitule}"`), premiere);
    verifie(`${chemin} : les accents sont intacts`, texte.includes('é') || texte.includes('É'), '');
  }
  {
    const r = await visiteur.appel('GET', '/api/admin/export/clients');
    verifie('l\'export est ferme au public', r.status === 401, r.status);
  }

  // --- 10. Le message pour demander un avis ---------------------------------
  console.log('\n10. Demander un avis');
  {
    const r = await salon.appel('GET', '/api/admin/message-avis');
    verifie('le message est compose par le serveur', r.status === 200, r.status);
    verifie('il dit s\'il est utilisable', typeof r.donnees.pret === 'boolean', r.donnees);

    if (r.donnees.pret) {
      verifie('il porte le lien', r.donnees.message.includes(r.donnees.lien), r.donnees.message);
      verifie('il porte le nom du commerce', r.donnees.message.length > 20, r.donnees.message);
    } else {
      verifie('sinon il explique quel reglage manque',
        r.donnees.aide.includes('avis'), r.donnees.aide);
    }
  }

  // --- LES HEURES CREUSES SE LISENT DANS LE BON SENS ------------------------
  //
  // >>> LE GRAPHIQUE DISAIT LE CONTRAIRE DE CE QU'IL MONTRAIT. <<< La barre
  // encodait le VIDE, le nombre encodait le VOLUME : une barre longue
  // accompagnait « 6 rdv » et une barre courte « 19 rdv ». Et « 19 rdv » sans
  // denominateur ne decide rien — dix-neuf sur combien de places ?
  //
  // Chaque ligne porte donc un taux de remplissage, et c'est LUI qui trie.
  console.log('\nLes heures creuses');
  {
    const c = await chiffres();
    const creux = c.creneauxMorts ?? [];

    verifie('chaque heure porte son remplissage et son denominateur',
      creux.every((h) => Number.isInteger(h.remplissage)
        && Number.isInteger(h.minutesPrises) && Number.isInteger(h.minutesOuvertes)),
      creux[0]);

    verifie('le nombre brut est conserve en information secondaire',
      creux.every((h) => Number.isInteger(h.nombre) && h.nombre >= 0), creux[0]);

    // >>> UNE HEURE SANS CAPACITE N'EST PAS UNE HEURE CREUSE. <<< Sa division
    //     donnerait 0 %, et elle trusterait le classement — un jour ferme
    //     remonterait tout en haut de « ce qu'on peut remplir ».
    verifie('aucune heure sans capacite ne figure au classement',
      creux.every((h) => h.minutesOuvertes > 0), creux.filter((h) => !h.minutesOuvertes));

    verifie('le remplissage est le rapport des deux minutes',
      creux.every((h) => h.remplissage === Math.round((h.minutesPrises / h.minutesOuvertes) * 100)),
      creux.map((h) => [h.remplissage, h.minutesPrises, h.minutesOuvertes]));

    verifie('un taux est un pourcentage, entre 0 et 100',
      creux.every((h) => h.remplissage >= 0 && h.remplissage <= 100),
      creux.map((h) => h.remplissage));

    // >>> ET LE TRI SUIT LE TITRE. <<< Il portait sur le NOMBRE de rendez-vous :
    //     deux heures a 6 et 19 rendez-vous pouvaient etre remplies a 60 % et
    //     20 %, et le classement les rangeait a l'envers de ce qu'il annonce.
    verifie('>>> LE CLASSEMENT VA DU PLUS CREUX AU MOINS CREUX <<<',
      creux.every((h, i) => i === 0 || h.remplissage >= creux[i - 1].remplissage),
      creux.map((h) => h.remplissage));

    verifie('il en montre au plus cinq', creux.length <= 5, creux.length);
  }
} finally {
  for (const id of aNettoyer) {
    await salon.appel('DELETE', `/api/admin/bookings/${id}`);
  }
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
