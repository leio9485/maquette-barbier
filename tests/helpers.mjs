// ---------------------------------------------------------------------------
// OUTILS PARTAGES PAR LES TESTS
//
// Depuis que l'espace commercant est verrouille, les tests doivent se connecter
// comme le ferait un navigateur : envoyer un mot de passe, recevoir un cookie
// de session, puis le renvoyer a chaque requete suivante.
//
// Un compte temporaire est cree pour la duree des tests, puis supprime : on ne
// touche jamais au vrai compte du commercant, et son mot de passe n'a pas a
// etre connu ici.
// ---------------------------------------------------------------------------

import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '../src/db.js';
import { DATA_DIR } from '../src/config.js';
import { hashPassword } from '../src/lib/passwords.js';

export const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const IDENTIFIANT_TEST = 'compte-de-test-automatique';
const MOT_DE_PASSE_TEST = 'mot-de-passe-de-test-jetable-9471';

/**
 * Un "navigateur" simplifie : il retient les cookies que le serveur lui donne
 * et les renvoie ensuite, ce que fetch ne fait pas tout seul.
 *
 * `base` vaut le serveur ouvert dans le terminal d'a cote, sauf pour
 * tests/demonstration.mjs : cette suite lance sa propre instance, sur son propre
 * port, parce que ce qu'elle verifie n'existe qu'avec DEMO_MODE.
 */
export function creerClient(base = BASE) {
  const cookies = new Map();

  async function appel(methode, chemin, corps) {
    const entetes = { 'Content-Type': 'application/json' };
    if (cookies.size) {
      entetes.Cookie = [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ');
    }

    const options = { method: methode, headers: entetes };
    if (corps !== undefined) options.body = JSON.stringify(corps);

    const reponse = await fetch(base + chemin, options);
    const cookiesRecus = reponse.headers.getSetCookie?.() ?? [];

    for (const brut of cookiesRecus) {
      const paire = brut.split(';')[0];
      const separateur = paire.indexOf('=');
      if (separateur === -1) continue;

      const nom = paire.slice(0, separateur).trim();
      const valeur = paire.slice(separateur + 1).trim();

      // Une valeur vide signifie que le serveur efface le cookie.
      if (valeur) cookies.set(nom, valeur);
      else cookies.delete(nom);
    }

    let donnees = null;
    try { donnees = await reponse.json(); } catch { /* corps vide */ }

    return { status: reponse.status, donnees, cookiesRecus };
  }

  return { appel, cookies };
}

/**
 * La seule section « Prestations » de la page, entre ses deux marqueurs.
 *
 * INDISPENSABLE, et pas un raffinement : chercher dans la page entiere ne
 * prouve rien. Le JavaScript du site voyage dans le meme fichier, et il
 * contient lui-meme les chaines '<div class="service-card">' et
 * '<section class="tarif-cat" id="' — un test qui les chercherait partout
 * passerait au vert meme si le serveur n'injectait plus rien du tout.
 * Constate a l'essai, pas deduit.
 */
export function sectionServie(page) {
  const bloc = /<!--@prestations-->([\s\S]*?)<!--\/@prestations-->/.exec(page);
  return bloc ? bloc[1] : '';
}

/**
 * La seule section « Avis » de la page, entre ses deux marqueurs.
 *
 * Meme precaution que ci-dessus, et pour la meme raison : le JavaScript du site
 * voyage dans le meme fichier et contient lui-meme la chaine
 * '<div class="testimonial-card">'. Chercher dans la page entiere passerait au
 * vert alors que le serveur n'injecterait plus rien.
 */
export function avisServis(page) {
  const bloc = /<!--@temoignages-->([\s\S]*?)<!--\/@temoignages-->/.exec(page);
  return bloc ? bloc[1] : '';
}

/** Compteur de reussites et d'echecs. */
export function creerVerificateur() {
  let ok = 0;
  let ko = 0;

  function verifie(titre, condition, detail) {
    if (condition) { ok++; console.log(`  OK   ${titre}`); }
    else { ko++; console.log(`  ECHEC ${titre}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); }
  }

  function bilan() {
    console.log(`\n===== ${ok} reussites, ${ko} echecs =====`);
    return ko;
  }

  return { verifie, bilan };
}

export async function creerCompteDeTest() {
  const empreinte = await hashPassword(MOT_DE_PASSE_TEST);
  await prisma.adminUser.upsert({
    where: { username: IDENTIFIANT_TEST },
    create: { username: IDENTIFIANT_TEST, passwordHash: empreinte },
    update: { passwordHash: empreinte },
  });
  return { username: IDENTIFIANT_TEST, password: MOT_DE_PASSE_TEST };
}

export async function supprimerCompteDeTest() {
  await prisma.adminUser.deleteMany({ where: { username: IDENTIFIANT_TEST } });
  await prisma.$disconnect();
}

/** Un client deja connecte a l'espace commercant. */
export async function clientConnecte() {
  const identifiants = await creerCompteDeTest();
  const client = creerClient();

  const r = await client.appel('POST', '/api/admin/login', {
    username: identifiants.username,
    password: identifiants.password,
  });

  if (r.status !== 200) {
    throw new Error('Connexion de test impossible : ' + JSON.stringify(r));
  }
  return client;
}

// --- L'equipe, mise de cote le temps des tests -----------------------------
//
// TOUTE la suite suppose un commerce SANS equipe, et pas seulement tests/staff.mjs.
// Avec trois personnes enregistrees, reserver deux fois le meme creneau doit
// reussir — une seconde coiffeuse est libre — et c'est exactement ce que
// tests/api.mjs verifie comme devant echouer. Le probleme n'est donc pas
// rattrapable suite par suite.
//
// Or la base de developpement n'est pas jetable : on y saisit son equipe pour
// voir la vitrine vivre, puis on lance les tests. Avant ces deux fonctions, elle
// disparaissait — silencieusement, puisque la suite passait au vert une fois la
// table videe.
//
// Elle est donc RELEVEE, EFFACEE le temps des tests, puis REPOSEE.
//
// /!\ CE QUI NE REVIENT PAS : le `staffId` des rendez-vous deja pris. Supprimer
//     une personne le met a `null` (`onDelete: SetNull`), et rien ne permet de
//     retrouver a qui ils appartenaient. Ils redeviennent « non attribues »,
//     donc bloquants pour toute l'equipe — l'agenda les signale en dore, avec un
//     menu « Confier a... ». C'est le prix restant, et il est sans commune
//     mesure avec celui de tout ressaisir.

/**
 * Le fichier d'attente.
 *
 * Garder l'equipe en memoire suffirait tant que tout se passe bien. Mais un
 * Ctrl-C au milieu des tests, ou un serveur qui tombe, laisserait la base vide
 * et la memoire perdue avec le processus. Ecrite sur le disque, l'equipe est
 * reposee au lancement suivant.
 *
 * Dans data/, a cote de la base : c'est la meme donnee, et le dossier est deja
 * hors de git.
 */
const FICHIER_ATTENTE = path.join(DATA_DIR, 'equipe-mise-de-cote.json');

/**
 * Posee par tests/run.mjs sur les suites qu'il lance.
 *
 * Elle dit : « l'equipe est deja mise de cote, n'y touche pas ». Sans ce signal,
 * tests/staff.mjs refaisait l'operation pour son compte au milieu de la suite —
 * il reposait l'equipe du lanceur, la relevait aussitot, et cet aller-retour
 * cassait une assertion sur les liens prestation/personne.
 *
 * Une variable d'environnement plutot qu'une deduction a partir du fichier
 * d'attente : « quelqu'un au-dessus s'en occupe » est un fait que seul
 * l'appelant connait, et le deviner marchait dans un cas sur deux.
 */
const GEREE_PAR_LE_LANCEUR = 'EQUIPE_GEREE_PAR_LE_LANCEUR';

/**
 * Releve l'equipe enregistree et vide la table, le temps des tests.
 *
 * Repose d'abord une equipe laissee en attente par une execution interrompue :
 * sans cela, deux Ctrl-C de suite et l'attente serait ecrasee par un tableau
 * vide, ce qui perdrait pour de bon ce qu'on cherche justement a proteger.
 */
export async function mettreEquipeDeCote(salon) {
  if (process.env[GEREE_PAR_LE_LANCEUR] === '1') return null;

  await reposerEquipe(salon, { silencieux: true });

  const lecture = await salon.appel('GET', '/api/admin/settings');
  if (lecture.status !== 200) return null;
  if (!lecture.donnees.staff?.length) return null;

  await writeFile(FICHIER_ATTENTE, JSON.stringify(lecture.donnees, null, 2), 'utf8');

  const vide = await salon.appel('PUT', '/api/admin/settings',
    { ...lecture.donnees, staff: [], confirmRemovals: true });

  if (vide.status !== 200) {
    await rm(FICHIER_ATTENTE, { force: true });
    throw new Error('Equipe non mise de cote : ' + JSON.stringify(vide.donnees));
  }

  const noms = lecture.donnees.staff.map((p) => p.name).join(', ');
  console.log(`(equipe mise de cote le temps des tests : ${noms})\n`);
  return lecture.donnees;
}

/**
 * Repose l'equipe mise de cote, s'il y en a une en attente.
 *
 * Ne suppose rien de ce qui s'est passe entre-temps : elle relit le fichier, et
 * ne fait rien s'il n'existe pas. C'est ce qui permet de l'appeler sans risque
 * au demarrage comme a la fin.
 */
export async function reposerEquipe(salon, { silencieux = false } = {}) {
  if (process.env[GEREE_PAR_LE_LANCEUR] === '1') return false;

  let attente;
  try {
    attente = JSON.parse(await readFile(FICHIER_ATTENTE, 'utf8'));
  } catch {
    return false; // rien en attente : le cas courant
  }

  const retour = await salon.appel('PUT', '/api/admin/settings',
    { ...attente, confirmRemovals: true });

  const noms = attente.staff.map((p) => p.name).join(', ');
  if (retour.status !== 200) {
    console.error(`\n/!\\ EQUIPE NON REPOSEE (${retour.status}). Elle reste dans ${FICHIER_ATTENTE}`);
    return false;
  }

  await rm(FICHIER_ATTENTE, { force: true });
  if (!silencieux) console.log(`\n(equipe reposee : ${noms})`);
  return true;
}

/**
 * Prochaine journee de test, a au moins deux jours d'ici.
 *
 * ⚠️ MARDI, MERCREDI OU JEUDI UNIQUEMENT, et ce n'est pas de la superstition :
 * ce commerce n'a pas les memes heures tous les jours. Le vendredi ferme a 21h
 * (nocturne) et le samedi est en journee continue de 8h30 a 17h, sans pause.
 *
 * Les tests ci-dessous verifient des heures precises — « aucun creneau apres la
 * fermeture », « rien pendant la pause », « le premier creneau est a 09h00 ».
 * Sur un jour tire au hasard, ces assertions passeraient ou echoueraient selon
 * la date d'execution, ce qui est la pire espece de test : celui qui casse un
 * vendredi sans que personne n'ait rien touche.
 *
 * Les trois jours retenus partagent exactement les memes horaires :
 * 09h00–12h00 et 14h00–19h00.
 */
export function prochainJourOuvert() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() < 2 || d.getDay() > 4) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// LA SEMAINE DE TEST, MISE DE COTE ELLE AUSSI
//
// >>> POURQUOI CETTE SECONDE MISE DE COTE EXISTE. <<<
//
// Le lanceur retire l'equipe le temps des tests (voir plus haut) — mais PAS les
// rendez-vous que la demonstration a semes pour elle. Le generateur remplit la
// journee a 42 % pour TROIS barbiers ; sans equipe, ces memes rendez-vous
// tiennent une ressource unique, et la journee de test est pleine.
//
// CE QUE CA CASSAIT, SUR UNE BASE FRAICHEMENT SEMEE :
//
//   - tests/debit.mjs : « assez de creneaux libres pour eprouver le plafond »
//     — il en faut six, il en restait deux ;
//   - tests/blocages.mjs : poser un blocage sur une journee qui porte dix-huit
//     rendez-vous est refuse, a juste titre, par la route elle-meme ;
//   - tests/api.mjs : le bouchon d'un quart d'heure a besoin de deux creneaux
//     libres qui se suivent.
//
// Le defaut ne se voyait pas a la DEUXIEME execution : la section 5 de
// blocages.mjs annule en bloc les rendez-vous de la journee, et la libere donc
// pour toutes les suivantes. C'est-a-dire que `npm test` echouait sur une
// machine neuve et passait ensuite — la pire facon de decouvrir un test.
//
// La fenetre va d'AUJOURD'HUI a la journee de test plus six jours — le detail et
// les deux raisons sont sur `semaineDeTest()` juste en dessous.
//
// ⚠️ MEME REGLE QUE POUR L'EQUIPE : releves, effaces, REPOSES. La base de
//    developpement n'est pas jetable, et un prospect a qui l'on montre le site
//    apres un `npm test` doit retrouver son agenda plein.
// ---------------------------------------------------------------------------

const FICHIER_RENDEZ_VOUS = path.join(DATA_DIR, 'rendez-vous-mis-de-cote.json');

/**
 * La fenetre a liberer : d'AUJOURD'HUI a la journee de test plus six jours.
 *
 * ⚠️ ELLE COMMENCE AUJOURD'HUI, ET PAS A LA JOURNEE DE TEST. La section 10 de
 *    tests/api.mjs ferme « les jours qui precedent » le prochain jour ouvert,
 *    pour que le bandeau reponde sur cette journee-la et sur elle seule — et
 *    une journee qui porte des rendez-vous ne se ferme pas sans confirmation,
 *    a juste titre. Lancee un dimanche, la veille est un lundi ferme et la
 *    question ne se pose pas ; lancee un lundi, c'est un MARDI OUVERT, rempli
 *    par la demonstration, et la suite s'arretait la. Un jour de la semaine sur
 *    deux, selon le jour ou l'on lance — exactement le genre de test qui casse
 *    sans que personne n'ait rien touche.
 *
 * Sept jours a partir de la journee de test, parce que blocages.mjs pose une
 * periode de trois jours et que annulation.mjs deplace vers le jour ouvert
 * suivant, qui peut etre a cinq jours de la.
 */
function semaineDeTest() {
  const dates = [];
  const fin = new Date(`${prochainJourOuvert()}T12:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 6);

  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);

  while (d <= fin) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** Les trois colonnes de dates d'une ligne, que JSON rend en chaines. */
function revivifier(ligne) {
  return {
    ...ligne,
    annuleLe: ligne.annuleLe ? new Date(ligne.annuleLe) : null,
    createdAt: new Date(ligne.createdAt),
    updatedAt: new Date(ligne.updatedAt),
  };
}

/**
 * Vide la semaine de test de ses rendez-vous, apres les avoir releves.
 *
 * Repose d'abord ceux qu'une execution interrompue aurait laisses en attente :
 * sans cela, deux Ctrl-C de suite ecraseraient l'attente par une liste plus
 * courte, et la difference serait perdue pour de bon.
 *
 * ⚠️ LES BLOCAGES NE SONT PAS TOUCHES (`kind: 'appt'` seulement). Une periode
 *    bloquee posee a la main sur la base de developpement dit quelque chose ;
 *    la lever au passage serait une surprise, et les suites qui en posent les
 *    levent elles-memes.
 */
export async function libererLaSemaineDeTest() {
  await reposerLaSemaineDeTest({ silencieux: true });

  const dates = semaineDeTest();
  const lignes = await prisma.booking.findMany({
    where: { date: { in: dates }, kind: 'appt' },
  });
  if (!lignes.length) return 0;

  await writeFile(FICHIER_RENDEZ_VOUS, JSON.stringify(lignes, null, 2), 'utf8');
  await prisma.booking.deleteMany({ where: { id: { in: lignes.map((l) => l.id) } } });

  console.log(`(${lignes.length} rendez-vous mis de cote du ${dates[0]} au ${dates.at(-1)})`);
  return lignes.length;
}

/**
 * Repose les rendez-vous mis de cote, s'il y en a en attente.
 *
 * Ne suppose rien de ce qui s'est passe entre-temps : une ligne que les tests
 * ont recreee avec le meme identifiant n'est pas ecrasee, et un fichier absent
 * ne fait rien. C'est ce qui permet de l'appeler au demarrage comme a la fin.
 */
export async function reposerLaSemaineDeTest({ silencieux = false } = {}) {
  let attente;
  try {
    attente = JSON.parse(await readFile(FICHIER_RENDEZ_VOUS, 'utf8'));
  } catch {
    return 0; // rien en attente : le cas courant
  }

  let reposes = 0;
  for (const ligne of attente) {
    const deja = await prisma.booking.findUnique({ where: { id: ligne.id } });
    if (deja) continue;
    try {
      await prisma.booking.create({ data: revivifier(ligne) });
      reposes++;
    } catch (erreur) {
      console.error(`/!\\ Rendez-vous non repose (${ligne.id}) : ${erreur.message}`);
    }
  }

  await rm(FICHIER_RENDEZ_VOUS, { force: true });
  if (!silencieux) console.log(`(${reposes} rendez-vous reposes)`);
  return reposes;
}
