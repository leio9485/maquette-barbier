// ---------------------------------------------------------------------------
// TESTS DU FICHIER .ics — « Ajouter à mon agenda » (lot D, point D5)
//
//     npm start        (terminal 1, laisse ouvert)
//     npm run test:ics (terminal 2)
//
// >>> CE FICHIER EST ECRIT DANS LE NAVIGATEUR, ET C'EST LA DIFFICULTE. <<<
// Rien ne part sur le reseau : `fabriquerIcs()` (js/07-mon-agenda.js) compose
// le texte a partir de ce qui est deja a l'ecran. Une suite qui ne parlerait
// qu'au serveur ne verrait donc jamais le fichier lui-meme.
//
// Cette suite l'EVALUE : elle lit le morceau de JavaScript, lui fournit les
// deux choses que la page lui donne (`CONFIG` et `location`), et appelle la
// fonction. Ce n'est pas un navigateur — mais c'est le vrai code, pas une
// copie, et un fichier .ics ne depend d'aucune API de rendu.
//
// CE QUI CASSE EN PRATIQUE, ET QUE CETTE SUITE TIENT :
//
//   - L'IDENTIFIANT DOIT SURVIVRE A UN DEPLACEMENT. Sinon l'agenda du client
//     se retrouve avec DEUX evenements au lieu d'un decale — le defaut le plus
//     couteux, parce qu'il se decouvre le jour du rendez-vous.
//   - LE NUMERO DE VERSION DOIT GRANDIR. Meme identifiant sans `SEQUENCE` plus
//     grand : beaucoup d'agendas gardent l'ancienne version, et l'heure
//     affichee reste la mauvaise.
//   - L'HEURE EST EN UTC, SUFFIXEE `Z`. Une heure « flottante » se decale
//     d'une heure entre l'ete et l'hiver, et personne ne le voit avant
//     octobre.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { creerVerificateur, prochainJourOuvert, BASE } from './helpers.mjs';
import { ROOT_DIR } from '../src/config.js';
import { prisma } from '../src/db.js';
import { icsDuRendezVous } from '../src/lib/ics.js';

const { verifie, bilan } = creerVerificateur();

/**
 * Le vrai morceau de la page, evalue avec ce que la page lui fournit.
 *
 * `CONFIG` et `location` sont les deux seules choses que `fabriquerIcs()`
 * regarde en dehors de ses arguments. On les passe en parametres de la
 * fonction fabriquee : le code du site, lui, n'est pas modifie d'un caractere.
 */
async function chargerFabrique(config) {
  const source = await readFile(
    path.join(ROOT_DIR, 'src', 'page', 'js', '07-mon-agenda.js'), 'utf8');

  let usine;
  try {
    usine = new Function('CONFIG', 'location', `${source}\nreturn fabriquerIcs;`);
  } catch (erreur) {
    // Le message par defaut serait « Unexpected token 'export' » et une pile
    // qui designe CE fichier-ci. Celui-la nomme le fautif.
    throw new Error('src/page/js/07-mon-agenda.js ne se compile plus par '
      + `new Function() : ${erreur.message}. Cause probable : un import ou un `
      + 'export ajoute en tete (new Function compile un script, pas un module), '
      + 'ou une lecture du DOM posee au niveau racine du fichier. Le serveur '
      + 'l\'evalue de la meme facon (src/lib/ics.js) et le courriel de '
      + 'confirmation partira sans piece jointe.');
  }
  return usine(config, { hostname: 'letabli-bavay.fr', origin: 'https://letabli-bavay.fr' });
}

/** Les lignes du fichier, depliees : la norme coupe a 75 octets.
 *
 * ⚠️ TOLERE `null`. Le seul appelant qui peut en recevoir un est la section 1,
 *    et c'est exactement le cas qu'elle existe pour attraper : sans cette
 *    garde, son echec — deja affiche, et nomme — etait suivi d'un
 *    « Cannot read properties of null » qui renvoyait de nouveau lire ce
 *    fichier-ci au lieu du fautif. */
function lignes(ics) {
  return String(ics ?? '').replace(/\r\n /g, '').split('\r\n');
}

/** La valeur d'une propriete, ou null. */
function valeur(ics, nom) {
  const ligne = lignes(ics).find((l) => l.startsWith(nom + ':'));
  return ligne ? ligne.slice(nom.length + 1) : null;
}

let code = 0;

try {
  // Les reglages reels du commerce : le fichier porte son nom, son adresse et
  // son telephone, et c'est la meme source que la page.
  const config = await fetch(`${BASE}/api/config`).then((r) => r.json());

  const JOUR = prochainJourOuvert();

  /** Le fichier produit par le serveur, compare a celui de la page en section 2. */
  let duServeur = null;

  // --- 1. L'USINE DU SERVEUR SE COMPILE-T-ELLE ? ---------------------------
  //
  // >>> CE N'EST PAS UN DOUBLON DE LA SECTION 2, C'EST UN DIAGNOSTIC. <<<
  //
  // `src/lib/ics.js` EVALUE le morceau de page ci-dessus avec `new Function()`
  // pour joindre le meme fichier au courriel de confirmation. L'intention est
  // juste et ne se remet pas en cause : deux implementations divergeraient sur
  // `UID` et `SEQUENCE`, et le client se retrouverait avec deux evenements au
  // lieu d'un. Le risque n'est pas la securite — la source est un fichier du
  // depot, jamais une entree d'utilisateur — c'est le DIAGNOSTIC.
  //
  // `chargerUsine()` n'echoue pas bruyamment : elle journalise et rend `null`,
  // parce qu'un fichier de page illisible ne doit pas faire echouer une
  // reservation. tests/courriels.mjs voit alors la piece jointe manquer et dit
  // « le .ics n'est pas joint » — ce qui envoie chercher dans le mauvais
  // fichier. Cette section-ci nomme le bon.
  //
  // CE QUI LA FERA TOMBER, LE JOUR OU CA ARRIVERA : un `import` ou un `export`
  // ajoute en tete de js/07-mon-agenda.js (`new Function` compile un script,
  // pas un module), ou une lecture du DOM posee au niveau racine du fichier
  // plutot que dans une fonction.
  console.log('1. Le generateur evalue par le serveur');
  {
    const fichier = await icsDuRendezVous(config, {
      date: JOUR, start: 570, duree: 25,
      prestation: 'Coupe homme', avec: 'Rémi', reference: 'MQJYBK', version: 0,
    });

    verifie('>>> src/page/js/07-mon-agenda.js SE COMPILE ENCORE PAR new Function()'
      + ' — sinon : un import/export ajoute en tete, ou une lecture du DOM hors'
      + ' fonction (voir src/lib/ics.js) <<<',
      typeof fichier === 'string' && fichier.startsWith('BEGIN:VCALENDAR'),
      fichier === null ? 'null — l\'usine ne s\'est pas compilee' : String(fichier).slice(0, 40));

    verifie('et son identifiant est bati sur la reference du rendez-vous',
      (valeur(fichier, 'UID') ?? '').startsWith('MQJYBK@'), valeur(fichier, 'UID'));

    // Garde pour la section 2 : les deux fichiers doivent porter le meme
    // evenement, et c'est la raison d'etre de src/lib/ics.js.
    duServeur = fichier;
  }

  // --- 2. Un rendez-vous ordinaire ----------------------------------------
  //
  // ⚠️ LA FABRIQUE EST CHARGEE ICI ET PAS PLUS HAUT. Un morceau qui ne se
  //    compile plus fait lever `new Function()`, donc s'arreter la suite
  //    entiere : chargee avant la section 1, elle emporterait le seul controle
  //    qui NOMME le fichier fautif, et il ne resterait qu'une trace de pile
  //    designant ce test-ci.
  const fabriquerIcs = await chargerFabrique(config);

  console.log('\n2. Le fichier d\'un rendez-vous');

  const reserve = fabriquerIcs({
    date: JOUR, start: 570, duree: 25,
    prestation: 'Coupe homme', avec: 'Rémi', reference: 'MQJYBK', version: 0,
  });

  {
    verifie('le fichier est produit', typeof reserve === 'string' && reserve.length > 100, '');
    verifie('il commence et finit comme la norme le demande',
      reserve.startsWith('BEGIN:VCALENDAR\r\n') && reserve.endsWith('END:VCALENDAR\r\n'), '');
    verifie('les fins de ligne sont CRLF', !/[^\r]\n/.test(reserve), '');

    verifie('le titre porte la prestation et le commerce',
      (valeur(reserve, 'SUMMARY') ?? '').includes('Coupe homme')
      && (valeur(reserve, 'SUMMARY') ?? '').includes(config.salon.name),
      valeur(reserve, 'SUMMARY'));

    verifie('l\'adresse du commerce y est',
      (valeur(reserve, 'LOCATION') ?? '').includes(config.salon.city), valeur(reserve, 'LOCATION'));

    const description = lignes(reserve).find((l) => l.startsWith('DESCRIPTION:')) ?? '';
    verifie('la description porte la reference', description.includes('MQJYBK'), description);
    verifie('elle porte le barbier', description.includes('Rémi'), description);
    verifie('et le lien vers /annuler', description.includes('/annuler'), description);
  }
  {
    // >>> ET C'EST LE MEME EVENEMENT QUE CELUI DU SERVEUR (section 1). <<< Meme
    //     version, meme instant, meme titre : c'est toute la raison d'etre de
    //     src/lib/ics.js, et la seule chose qui empeche le client de se
    //     retrouver avec deux rendez-vous dans son agenda.
    //
    // ⚠️ LE DOMAINE DE L'`UID`, LUI, DIFFERE ICI, ET C'EST NORMAL. Il vient de
    //    `PUBLIC_URL`, que la machine de developpement n'a pas : le serveur
    //    retombe alors sur `localhost` (voir `fausseAdresse()`, src/lib/ics.js)
    //    quand cette suite, elle, passe le vrai domaine a la main. En
    //    production les deux lisent la meme variable — c'est precisement
    //    pourquoi elle en est la seule source.
    for (const propriete of ['SEQUENCE', 'DTSTART', 'DTEND', 'SUMMARY']) {
      verifie(`le serveur et la page ecrivent le meme ${propriete}`,
        valeur(duServeur, propriete) === valeur(reserve, propriete),
        [valeur(reserve, propriete), valeur(duServeur, propriete)]);
    }
  }
  {
    // >>> L'HEURE EST UN INSTANT, PAS UNE HEURE MURALE. <<< 570 minutes, c'est
    //     9h30 a Bavay : en aout, l'ecart est de deux heures, donc 07:30 UTC.
    //     Un fichier sans `Z` laisserait l'agenda du client interpreter cette
    //     heure dans SON fuseau.
    const debut = valeur(reserve, 'DTSTART');
    const fin = valeur(reserve, 'DTEND');

    verifie('DTSTART est en UTC (suffixe Z)', /^\d{8}T\d{6}Z$/.test(debut ?? ''), debut);
    verifie('DTEND aussi', /^\d{8}T\d{6}Z$/.test(fin ?? ''), fin);
    verifie('il porte le bon jour', (debut ?? '').startsWith(JOUR.replaceAll('-', '')), [debut, JOUR]);

    const enMs = (h) => Date.parse(
      `${h.slice(0, 4)}-${h.slice(4, 6)}-${h.slice(6, 8)}T${h.slice(9, 11)}:${h.slice(11, 13)}:${h.slice(13, 15)}Z`);

    verifie('la duree du creneau est respectee, a la minute pres',
      (enMs(fin) - enMs(debut)) / 60000 === 25, (enMs(fin) - enMs(debut)) / 60000);

    // L'heure murale relue dans le fuseau du commerce : c'est ce que le client
    // verra dans son agenda.
    const murale = new Intl.DateTimeFormat('fr-FR', {
      timeZone: config.fuseau, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(enMs(debut)));

    verifie('>>> ET IL TOMBE BIEN A 09:30 CHEZ LE BARBIER <<<', murale === '09:30', murale);
  }
  {
    // Le rappel : la veille, pas le matin meme.
    verifie('un rappel est pose', reserve.includes('BEGIN:VALARM'), '');
    verifie('>>> IL SE DECLENCHE UN JOUR PLEIN AVANT <<<',
      valeur(reserve, 'TRIGGER') === '-P1D', valeur(reserve, 'TRIGGER'));
  }

  // --- 3. Le meme rendez-vous, deplace -------------------------------------
  //
  // C'EST LE POINT QUI COMPTE LE PLUS. Un identifiant qui change fabrique un
  // second evenement dans l'agenda du client, et l'ancien horaire y reste.
  console.log('\n3. Le meme rendez-vous, deplace');

  const deplace = fabriquerIcs({
    date: JOUR, start: 900, duree: 25,
    prestation: 'Coupe homme', avec: 'Rémi', reference: 'MQJYBK', version: 47,
  });

  {
    verifie('>>> L\'IDENTIFIANT EST LE MEME QU\'AVANT <<<',
      valeur(deplace, 'UID') === valeur(reserve, 'UID'),
      [valeur(reserve, 'UID'), valeur(deplace, 'UID')]);

    verifie('il est bati sur la reference, pas sur l\'heure',
      (valeur(reserve, 'UID') ?? '').startsWith('MQJYBK@'), valeur(reserve, 'UID'));

    verifie('>>> LE NUMERO DE VERSION A GRANDI <<<',
      Number(valeur(deplace, 'SEQUENCE')) > Number(valeur(reserve, 'SEQUENCE')),
      [valeur(reserve, 'SEQUENCE'), valeur(deplace, 'SEQUENCE')]);

    verifie('celui de la reservation vaut zero',
      valeur(reserve, 'SEQUENCE') === '0', valeur(reserve, 'SEQUENCE'));

    verifie('et l\'heure a bien change',
      valeur(deplace, 'DTSTART') !== valeur(reserve, 'DTSTART'),
      [valeur(reserve, 'DTSTART'), valeur(deplace, 'DTSTART')]);

    verifie('le fichier porte une date de derniere modification',
      /^\d{8}T\d{6}Z$/.test(valeur(deplace, 'LAST-MODIFIED') ?? ''),
      valeur(deplace, 'LAST-MODIFIED'));
  }
  {
    // Une version absente ne doit pas ecrire « SEQUENCE:NaN » : un fichier
    // invalide ne s'ouvre nulle part, et le bouton semblerait casse.
    const sansVersion = fabriquerIcs({
      date: JOUR, start: 570, duree: 25,
      prestation: 'Coupe homme', avec: '', reference: 'MQJYBK',
    });
    verifie('sans numero de version, le fichier reste valide',
      valeur(sansVersion, 'SEQUENCE') === '0', valeur(sansVersion, 'SEQUENCE'));
  }

  // --- 4. Ce que le serveur fournit pour ce numero -------------------------
  //
  // Le numero de version ne s'invente pas dans le navigateur : il vient de la
  // reponse du serveur. Sans lui, tout ce qui precede serait une jolie
  // mecanique branchee sur rien.
  console.log('\n4. Le numero de version vient du serveur');
  {
    const creneaux = await fetch(`${BASE}/api/slots?date=${JOUR}&serviceId=coupe-homme`)
      .then((r) => r.json());
    const libre = (creneaux.slots ?? []).filter((c) => c.free).pop();

    const pris = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: JOUR, start: libre.start, serviceId: 'coupe-homme',
        name: 'Client du fichier agenda', phone: '06 39 98 44 21',
      }),
    }).then((r) => r.json());

    try {
      const retrouve = await fetch(`${BASE}/api/rendez-vous/retrouver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: pris.reference, telephone: '4421' }),
      }).then((r) => r.json());

      verifie('un rendez-vous neuf porte une version',
        Number.isInteger(retrouve.rendezVous?.version), retrouve.rendezVous?.version);

      // On force une ecriture : le deplacement met `updatedAt` a jour, donc la
      // version grandit. Une seconde d'attente, parce que le numero compte les
      // secondes — c'est la granularite choisie, pas un defaut.
      await new Promise((r) => setTimeout(r, 1100));

      const autres = (await fetch(`${BASE}/api/slots?date=${JOUR}&serviceId=coupe-homme`)
        .then((r) => r.json())).slots.filter((c) => c.free);

      const bouge = await fetch(`${BASE}/api/rendez-vous/deplacer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: pris.reference, telephone: '4421',
          date: JOUR, start: autres[0].start,
        }),
      }).then((r) => r.json());

      verifie('>>> ET ELLE GRANDIT APRES UN DEPLACEMENT <<<',
        bouge.rendezVous?.version > retrouve.rendezVous?.version,
        [retrouve.rendezVous?.version, bouge.rendezVous?.version]);

      verifie('la reference, elle, n\'a pas bouge : le meme evenement',
        bouge.rendezVous?.reference === pris.reference, bouge.rendezVous?.reference);
    } finally {
      await prisma.booking.deleteMany({ where: { id: pris.id } }).catch(() => {});
    }
  }

  code = bilan();
} finally {
  await prisma.$disconnect();
}

process.exitCode = code;
