// ---------------------------------------------------------------------------
// TESTS DE LA REMISE A ZERO DE LA DEMONSTRATION (lot 0)
//
//     npm run test:demonstration
//
// >>> CETTE SUITE EST LA SEULE A LANCER SON PROPRE SERVEUR. <<<
//
// Toutes les autres parlent au serveur deja ouvert dans le terminal d'a cote.
// Celle-ci ne le peut pas : ce qu'elle verifie n'existe QUE si `DEMO_MODE=true`,
// et cette variable ne doit jamais figurer dans le .env d'une machine de
// developpement (voir CLAUDE.md — un compte `demo` residuel fait passer au vert
// six controles d'acces qui devraient echouer).
//
// Elle demarre donc une instance a part, sur son propre port et SA PROPRE BASE,
// et efface les deux en partant. La variable d'environnement l'emporte sur le
// .env (verifie) : la base de developpement n'est jamais touchee.
//
// CE QU'ELLE PROTEGE. Le bouton « Remettre a zero maintenant » vidait la
// demonstration au lieu de la remettre a son etat de depart — c'est ce qu'on
// voyait. En realite, `resetDemo()` repeuplait bien la base, mais tous les
// rendez-vous repartaient sur les jours SUIVANTS : une remise a zero le samedi
// les envoyait au mardi d'apres, et l'agenda du jour comme la vue semaine
// affichaient « Rien de prevu ». Le prospect en concluait que le produit
// effaçait sans rien remettre.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..');

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;

// La base de la demonstration, copiee depuis celle de developpement pour en
// reprendre le SCHEMA — son contenu, lui, est efface des la premiere remise a
// zero. La copier evite de lancer `prisma migrate` (quelques secondes) pour
// obtenir des tables vides.
const BASE_TEST = path.join(RACINE, 'data', 'demonstration-test.db');
const BASE_SOURCE = path.join(RACINE, 'data', 'commerce.db');

// Le test s'execute avec la base de test : c'est cette ligne qui protege la
// base de developpement, et elle doit rester AVANT tout `import()` de src/.
process.env.DATABASE_URL = `file:${BASE_TEST}`;

const { creerVerificateur, creerClient } = await import('./helpers.mjs');
const { rendezVousDemo, DEMO_USERNAME, DEMO_PASSWORD } = await import('../src/lib/demo.js');
const { DEFAULT_CONFIG } = await import('../src/lib/defaults.js');
const { prisma } = await import('../src/db.js');

const { verifie, bilan } = creerVerificateur();

/** La date du jour, "AAAA-MM-JJ", en heure locale — comme partout dans le site. */
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let serveur = null;

/** Demarre l'instance de demonstration et attend qu'elle reponde. */
async function demarrerServeur() {
  serveur = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], {
    cwd: RACINE,
    env: {
      ...process.env,
      DEMO_MODE: 'true',
      DATABASE_URL: `file:${BASE_TEST}`,
      PORT: String(PORT),
      // Surtout pas : le cookie serait marque Secure et la connexion en http
      // echouerait, sans le moindre message.
      NODE_ENV: 'development',
    },
    stdio: process.env.DEMO_TEST_VERBEUX ? 'inherit' : 'ignore',
  });

  // ⚠️ REPONDRE N'EST PAS ETRE PRET.
  //
  // `app.listen()` accepte les requetes AVANT que son rappel n'ait fini :
  // `startDemo()` — qui cree le compte `demo` et, sur une base vide, la
  // reconstruit — tourne encore quand la premiere requete arrive. S'arreter a
  // /api/health faisait echouer la connexion sans que rien ne le dise.
  //
  // On attend donc le compte lui-meme, LU DIRECTEMENT DANS LA BASE plutot que
  // par des connexions repetees : dix echecs de connexion depuis la meme adresse
  // declenchent le compteur de tentatives, et le test se serait bloque tout seul.
  for (let essai = 0; essai < 300; essai++) {
    try {
      const sain = await fetch(`${BASE}/api/health`);
      if (sain.ok) {
        const compte = await prisma.adminUser.findUnique({ where: { username: DEMO_USERNAME } });
        if (compte) return;
      }
    } catch {
      // pas encore la, ou base momentanement occupee par le serveur
    }
    await new Promise((resoudre) => setTimeout(resoudre, 100));
  }
  throw new Error("L'instance de demonstration n'a pas demarre.");
}

function arreterServeur() {
  if (serveur && !serveur.killed) serveur.kill();
  serveur = null;
}

/**
 * Ce qu'un rendez-vous a d'observable pour le commercant.
 *
 * Ni identifiant ni reference : ils sont tires au hasard a chaque remise a zero
 * et differeraient forcement. Ce que le critere d'acceptation demande de
 * comparer, ce sont « le meme nombre, les memes noms, les memes horaires ».
 */
function empreinte(rdv) {
  return [rdv.date, rdv.start, rdv.duration, rdv.name, rdv.staffId, rdv.serviceId].join('|');
}

async function lireAgenda(client, du, au) {
  const r = await client.appel('GET', `/api/admin/bookings?from=${du}&to=${au}`);
  if (r.status !== 200) throw new Error(`Agenda illisible : ${r.status}`);
  return r.donnees.bookings;
}

let code = 1;

try {
  await copyFile(BASE_SOURCE, BASE_TEST);
  await demarrerServeur();

  const salon = creerClient(BASE);

  // --- 1. L'instance de demonstration s'ouvre avec ses identifiants publics --
  console.log('1. L\'instance de demonstration');
  {
    const connexion = await salon.appel('POST', '/api/admin/login',
      { username: DEMO_USERNAME, password: DEMO_PASSWORD });

    verifie('le compte de demonstration ouvre l\'espace',
      connexion.status === 200, connexion.donnees);

    const config = await salon.appel('GET', '/api/config');
    verifie('la vitrine annonce qu\'elle est une demonstration',
      Boolean(config.donnees?.demo), 'CONFIG.demo absent');
  }

  // --- 2. La remise a zero repeuple l'agenda DU JOUR ------------------------
  //
  // >>> LE CRITERE D'ACCEPTATION DU LOT 0, MOT POUR MOT : « remise a zero →
  //     l'agenda du jour contient le nombre attendu de rendez-vous ». <<<
  console.log('\n2. La remise a zero repeuple l\'agenda du jour');
  const jour = aujourdhui();
  const ouvertAujourdhui = Boolean(DEFAULT_CONFIG.hours[new Date().getDay()]);

  {
    // On vide d'abord, pour que le repeuplement ne puisse pas etre confondu avec
    // « la base contenait deja quelque chose ».
    await prisma.booking.deleteMany({});
    const vide = await lireAgenda(salon, jour, jour);
    verifie('l\'agenda du jour est bien vide avant', vide.length === 0, vide.length);

    const remise = await salon.appel('POST', '/api/admin/demo/reset');
    verifie('la remise a zero aboutit', remise.status === 200, remise.donnees);

    const attendus = rendezVousDemo({ equipe: DEFAULT_CONFIG.staff.map((p) => p.id) })
      .filter((r) => r.date === jour);

    const obtenus = await lireAgenda(salon, jour, jour);

    verifie(`l'agenda du jour contient le nombre attendu de rendez-vous (${attendus.length})`,
      obtenus.length === attendus.length, { attendus: attendus.length, obtenus: obtenus.length });

    // Un dimanche ou un lundi, le commerce est ferme : il n'y a legitimement
    // rien a montrer, et c'est le seul cas ou la journee reste vide.
    verifie('un jour d\'ouverture, la journee n\'est jamais vide',
      !ouvertAujourdhui || obtenus.length > 0,
      { jour, ouvertAujourdhui, obtenus: obtenus.length });

    verifie('les rendez-vous du jour portent un nom et une heure',
      obtenus.every((r) => r.name && Number.isInteger(r.start)), obtenus);
  }

  // --- 3. La semaine en cours n'est pas vide non plus ------------------------
  //
  // La vue Semaine est le second ecran qu'un prospect ouvre. Avec une graine qui
  // partait de demain, une remise a zero un samedi la laissait entierement vide.
  console.log('\n3. La semaine en cours');
  {
    const d = new Date();
    const lundi = new Date(d);
    lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const dimanche = new Date(lundi);
    dimanche.setDate(lundi.getDate() + 6);

    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const semaine = await lireAgenda(salon, iso(lundi), iso(dimanche));

    verifie('la semaine en cours porte au moins un rendez-vous',
      semaine.length > 0, { du: iso(lundi), au: iso(dimanche), trouves: semaine.length });
  }

  // --- 4. Le meme resultat qu'un redemarrage du serveur ----------------------
  //
  // Le bouton et le demarrage doivent appeler le MEME code : deux graines qui
  // divergent, c'est une demonstration qui ne ressemble pas a ce qu'on a montre
  // la veille. On compare donc les deux etats, nom pour nom et heure pour heure.
  console.log('\n4. Identique a un redemarrage du serveur');
  {
    const apresBouton = (await lireAgenda(salon, '2000-01-01', '2100-01-01')).map(empreinte).sort();

    // Le demarrage ne reconstruit la base que s'il la trouve vide : on retire la
    // ligne de reglages, exactement comme sur un hebergement sans disque.
    arreterServeur();
    await prisma.settings.deleteMany({});
    await prisma.booking.deleteMany({});
    await demarrerServeur();

    const salon2 = creerClient(BASE);
    await salon2.appel('POST', '/api/admin/login',
      { username: DEMO_USERNAME, password: DEMO_PASSWORD });

    const apresDemarrage = (await lireAgenda(salon2, '2000-01-01', '2100-01-01')).map(empreinte).sort();

    verifie('le demarrage reconstruit lui aussi la base',
      apresDemarrage.length > 0, apresDemarrage.length);
    verifie('meme nombre de rendez-vous qu\'apres le bouton',
      apresDemarrage.length === apresBouton.length,
      { bouton: apresBouton.length, demarrage: apresDemarrage.length });
    verifie('memes noms, memes horaires, memes personnes',
      apresDemarrage.join('\n') === apresBouton.join('\n'),
      { bouton: apresBouton, demarrage: apresDemarrage });
  }

  // --- 5. Le tableau de bord ne plaide plus contre le produit (lot 7) -------
  //
  // >>> CE QU'UN PROSPECT Y LISAIT : 89 € de chiffre d'affaires hebdomadaire
  //     POUR TROIS BARBIERS, 2 % de temps rempli, « Mois dernier : 0 », des
  //     heures creuses a « aucun » cinq fois de suite, et une clientele
  //     « Nouveaux 100 % ». <<<
  //
  // Le volet « Chiffres » est le meilleur argument commercial du site ; il
  // decrivait un salon a l'agonie. Chaque verification ci-dessous correspond a
  // une ligne de l'ecran qu'on montre au patron.
  console.log('\n5. Le tableau de bord');
  {
    const r = await salon.appel('GET', '/api/admin/chiffres');
    verifie('les chiffres se lisent', r.status === 200, r.status);

    const tb = r.donnees;

    verifie('la semaine en cours a des rendez-vous', tb.semaine.rendezVous > 0, tb.semaine);
    verifie('et un chiffre d\'affaires a trois chiffres au moins',
      tb.semaine.caCents >= 100000, tb.semaine.caCents);

    verifie('>>> LE TEMPS REMPLI DU MOIS EST ENTRE 60 ET 75 % <<<',
      tb.mois.remplissage >= 60 && tb.mois.remplissage <= 75, tb.mois.remplissage);

    verifie('« mois dernier » affiche un nombre de rendez-vous plausible',
      tb.moisPrecedent.rendezVous > 100, tb.moisPrecedent.rendezVous);
    verifie('et un montant plausible', tb.moisPrecedent.caCents > 100000, tb.moisPrecedent.caCents);
    verifie('l\'ecart avec le mois dernier n\'est donc plus un tiret',
      tb.ecart.pourcent !== null, tb.ecart);

    verifie('>>> « DEJA VENUS » N\'EST PLUS A ZERO <<<',
      tb.clientele.habitues > 0, tb.clientele);
    verifie('et « nouveaux » non plus : les deux existent',
      tb.clientele.nouveaux > 0, tb.clientele);

    // ⚠️ LE TAUX D'ABSENCE SE CALCULE SUR LE MOIS EN COURS, ET SUR TOUT CE QUI
    //    EST PASSE. Le premier jour d'un mois, il n'y a rien de passe : le
    //    tableau affiche alors « — », legitimement, et aucune graine ne peut y
    //    changer quoi que ce soit. On ne verifie donc la valeur que lorsqu'il y
    //    a matiere.
    //
    // ⚠️ LA GARDE PORTE SUR `passes`, ET C'EST TOUT L'INTERET DE CETTE LIGNE.
    //    Elle portait sur `absences.pointes`, champ retire le jour ou « venu »
    //    est devenu l'etat par defaut. `undefined > 0` vaut `false` sans rien
    //    casser : le test s'est donc DESACTIVE EN SILENCE, et la suite est
    //    restee verte en verifiant une chose de moins. Une garde qui nomme un
    //    champ disparu ne saute pas, elle se tait.
    if (tb.absences.passes > 0) {
      verifie('>>> LE TAUX D\'ABSENCE EST CREDIBLE (5 A 15 %) <<<',
        tb.absences.taux >= 5 && tb.absences.taux <= 15, tb.absences);
    } else {
      console.log('     (debut de mois : rien de passe, taux non verifiable)');
    }

    verifie('les heures creuses designent de vraies heures, pas « aucun »',
      tb.creneauxMorts.length === 5 && tb.creneauxMorts.every((c) => c.nombre > 0),
      tb.creneauxMorts);

    // Le mardi matin est le creux qu'on montre : il doit sortir en tete.
    verifie('et le creux annonce, le mardi matin, sort bien en tete',
      tb.creneauxMorts[0].jour === 2 && tb.creneauxMorts[0].heure < 12,
      tb.creneauxMorts[0]);

    verifie('les trois barbiers ont tous travaille ce mois-ci',
      tb.equipe.length === 3 && tb.equipe.every((p) => p.nombre > 0), tb.equipe);
  }

  // --- 6. Les jours ecoules de la semaine ne sont pas vides -----------------
  //
  // La vue Semaine affichait « Rien de prevu » pour mardi, mercredi, jeudi et
  // vendredi derniers : c'est le second ecran qu'un prospect ouvre.
  console.log('\n6. Les sept jours ecoules');
  {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    const ilYaUneSemaine = new Date();
    ilYaUneSemaine.setDate(ilYaUneSemaine.getDate() - 7);

    const passes = await lireAgenda(salon, iso(ilYaUneSemaine), iso(hier));
    const parJour = new Map();
    for (const b of passes) parJour.set(b.date, (parJour.get(b.date) ?? 0) + 1);

    // Dimanche et lundi sont fermes, plus les eventuels jours de conges : on
    // demande donc qu'il reste au moins quatre journees garnies sur sept.
    const garnies = [...parJour.values()].filter((n) => n > 0).length;
    verifie('au moins quatre des sept derniers jours portent des rendez-vous',
      garnies >= 4, { garnies, detail: [...parJour] });
  }

  // --- 7. Des conges passes, pour que le temps rempli les exclue ------------
  console.log('\n7. Les conges passes');
  {
    const tout = await lireAgenda(salon, '2000-01-01', '2100-01-01');
    const blocages = tout.filter((b) => b.type === 'block');

    verifie('la graine pose une periode bloquee dans le passe',
      blocages.length > 0, blocages.length);
    verifie('elle est datee d\'avant aujourd\'hui',
      blocages.every((b) => b.date < jour), blocages.map((b) => b.date));
    verifie('et elle porte un motif lisible',
      blocages.every((b) => b.notes && !b.notes.includes('Journee')),
      blocages.map((b) => b.notes));
  }

  // --- 8. La graine tient a n'importe quelle date --------------------------
  //
  // >>> ELLE SERA REJOUEE DANS SIX MOIS. <<< Un agenda qui parle d'aout 2026 en
  //     fevrier 2027 est pire qu'un agenda vide, et une graine qui ne tient
  //     qu'un jour de la semaine casse un vendredi sur deux sans prevenir.
  //
  // On la rejoue donc a douze dates choisies pour leurs pieges : un premier du
  // mois, un dernier, un dimanche, un lundi (le commerce est ferme), le 29
  // fevrier d'une annee bissextile, et un passage d'annee.
  console.log('\n8. La graine, jouee a d\'autres dates');
  {
    const DATES = [
      '2026-01-01', '2026-02-28', '2028-02-29', '2026-03-31', '2026-06-14',
      '2026-06-15', '2026-07-01', '2026-09-30', '2026-10-25', '2026-11-11',
      '2026-12-25', '2026-12-31',
    ];

    const equipe = DEFAULT_CONFIG.staff.map((p) => p.id);
    const propres = new Map(DEFAULT_CONFIG.staff.filter((p) => p.hours).map((p) => [p.id, p.hours]));

    const enMinutes = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };

    /** Les plages travaillees ce jour-la, pour cette personne. */
    const plages = (staffId, dateIso) => {
      const horaires = (staffId && propres.get(staffId)) || DEFAULT_CONFIG.hours;
      const h = horaires[new Date(`${dateIso}T12:00:00`).getDay()];
      if (!h) return [];
      return h.pause
        ? [[enMinutes(h.open), enMinutes(h.pause[0])], [enMinutes(h.pause[1]), enMinutes(h.close)]]
        : [[enMinutes(h.open), enMinutes(h.close)]];
    };

    let horsPlage = 0;
    let chevauchements = 0;
    let datesSansMoisPrecedent = 0;
    let datesSansAujourdhui = 0;

    for (const quand of DATES) {
      const lignes = rendezVousDemo({ equipe, maintenant: new Date(`${quand}T10:00:00`) });
      const rdv = lignes.filter((l) => l.kind !== 'block');

      // 1. Chaque rendez-vous tient dans une plage reellement travaillee.
      for (const r of rdv) {
        const tient = plages(r.staffId, r.date)
          .some(([o, f]) => r.startMin >= o && r.startMin + r.durationMin <= f);
        if (!tient) horsPlage++;
      }

      // 2. Personne n'a deux rendez-vous en meme temps.
      const parPersonne = new Map();
      for (const r of rdv) {
        const cle = `${r.date}|${r.staffId}`;
        if (!parPersonne.has(cle)) parPersonne.set(cle, []);
        parPersonne.get(cle).push(r);
      }
      for (const liste of parPersonne.values()) {
        liste.sort((a, b) => a.startMin - b.startMin);
        for (let i = 1; i < liste.length; i++) {
          if (liste[i].startMin < liste[i - 1].startMin + liste[i - 1].durationMin) chevauchements++;
        }
      }

      // 3. Le mois precedent n'est jamais vide : c'est ce qui fait exister la
      //    ligne « Ecart avec le mois dernier ».
      const [an, mois] = quand.split('-').map(Number);
      const precedent = mois === 1
        ? `${an - 1}-12`
        : `${an}-${String(mois - 1).padStart(2, '0')}`;
      if (!rdv.some((r) => r.date.startsWith(precedent))) datesSansMoisPrecedent++;

      // 4. Le jour meme est garni, sauf si le commerce y est ferme.
      const ouvert = Boolean(DEFAULT_CONFIG.hours[new Date(`${quand}T12:00:00`).getDay()]);
      if (ouvert && !rdv.some((r) => r.date === quand)) datesSansAujourdhui++;
    }

    verifie('aucun rendez-vous ne tombe hors des heures travaillees',
      horsPlage === 0, horsPlage);
    verifie('>>> PERSONNE N\'A DEUX RENDEZ-VOUS EN MEME TEMPS <<<',
      chevauchements === 0, chevauchements);
    verifie('le mois precedent est garni a chacune des douze dates',
      datesSansMoisPrecedent === 0, datesSansMoisPrecedent);
    verifie('le jour meme est garni des que le commerce est ouvert',
      datesSansAujourdhui === 0, datesSansAujourdhui);
  }

  code = bilan();
} finally {
  arreterServeur();
  await prisma.$disconnect().catch(() => {});
  // Le fichier de base peut rester verrouille un instant apres l'arret du
  // serveur : on reessaie, plutot que de laisser un echec de menage masquer le
  // resultat des tests.
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
