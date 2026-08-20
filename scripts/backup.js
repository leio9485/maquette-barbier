// ---------------------------------------------------------------------------
// SAUVEGARDE D'UNE INSTANCE CLIENT
//
//     npm run db:backup
//
// C'etait le seul point du depot qui pouvait detruire les donnees d'un client
// payant : toute l'instance tient dans un dossier — la base SQLite ET les
// photos deposees par le commercant (voir le commentaire de DATA_DIR dans
// src/config.js) — et rien ne le copiait nulle part.
//
// ---------------------------------------------------------------------------
// POURQUOI `VACUUM INTO` ET NON UNE SIMPLE COPIE DU FICHIER
//
// Un `cp` sur une base ouverte copie un fichier qu'on est peut-etre en train
// d'ecrire. Le resultat parait normal — il fait la bonne taille, il porte le
// bon nom — et ne se revele corrompu que le jour ou l'on essaie de s'en
// servir, c'est-a-dire le seul jour ou il compte. Pire, une base en mode WAL
// garde une partie de ses ecritures dans un fichier voisin (`-wal`) : copier le
// seul `.db` perd tout ce qui n'a pas encore ete replie dedans.
//
// `VACUUM INTO` demande a SQLite lui-meme d'ecrire une base neuve et complete a
// partir de ce qu'il a valide. C'est coherent par construction, WAL compris, et
// cela n'interrompt personne : le serveur continue de repondre pendant ce
// temps.
//
// ---------------------------------------------------------------------------
// CE SCRIPT NE PEUT PAS FAIRE TOMBER LE SITE
//
// Il tourne dans SON PROPRE PROCESSUS, ouvre la base EN LECTURE SEULE, et
// n'ecrit que dans le dossier de destination. Il ne touche jamais a data/. Le
// pire qu'il puisse faire est de s'arreter en disant pourquoi.
//
// La lecture seule n'est pas une precaution de style : sans elle, une base
// ouverte en ecriture par un script lance a la main pendant que le serveur
// travaille peut rester verrouillee si le script est interrompu.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DATABASE_URL, DATA_DIR, ROOT_DIR } from '../src/config.js';

const executer = promisify(execFile);

// Sept quotidiennes, quatre hebdomadaires. Voir `aGarder()` pour ce que ces
// deux mots recouvrent exactement.
const QUOTIDIENNES = 7;
const HEBDOMADAIRES = 4;

const PREFIXE = 'letabli-';
const SUFFIXE = '.tar.gz';

// letabli-2026-08-20-1435.tar.gz — l'annee d'abord, pour que l'ordre
// alphabetique des noms soit l'ordre chronologique. C'est ce qui permet de
// classer les archives sans lire une seule date de fichier, donc sans dependre
// d'un `mtime` qu'une copie ou un transfert remet a l'heure du jour.
const NOM = new RegExp(`^${PREFIXE}(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})${SUFFIXE.replace('.', '\\.')}$`);

/**
 * Le dossier ou deposer les archives.
 *
 * ⚠️ Le repli est `backups/` A COTE de data/, et c'est un repli, pas une
 *    recommandation : une sauvegarde posee sur le meme disque que la base ne
 *    protege que de la fausse manoeuvre. Elle ne protege ni du disque qui
 *    lache, ni du conteneur qui repart vide. BACKUP_DIR existe pour designer
 *    un ailleurs — un volume distinct, un montage reseau, un dossier
 *    synchronise hors de la machine.
 */
function dossierDeDestination() {
  const demande = (process.env.BACKUP_DIR || '').trim();
  if (demande) return path.resolve(ROOT_DIR, demande);
  return path.join(path.dirname(DATA_DIR), 'backups');
}

/** `2026-08-20-1435`, dans l'heure de la machine. */
function horodatage(date = new Date()) {
  const d = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${d(date.getMonth() + 1)}-${d(date.getDate())}`
    + `-${d(date.getHours())}${d(date.getMinutes())}`;
}

/**
 * La semaine ISO d'une date, sous la forme `2026-S34`.
 *
 * ISO et non "les sept derniers jours" : c'est ce qui fait qu'une sauvegarde du
 * dimanche et une du lundi suivant comptent pour deux semaines, et non pour une
 * seule au gre du jour ou la rotation est passee.
 */
function semaineIso(annee, mois, jour) {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  // Le jeudi de la semaine en cours designe l'annee ISO : c'est la definition.
  const jourSemaine = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - jourSemaine + 3);
  const anneeIso = d.getUTCFullYear();
  const premierJeudi = new Date(Date.UTC(anneeIso, 0, 4));
  const decalage = (premierJeudi.getUTCDay() + 6) % 7;
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - decalage + 3);
  const numero = 1 + Math.round((d - premierJeudi) / (7 * 24 * 3600 * 1000));
  return `${anneeIso}-S${String(numero).padStart(2, '0')}`;
}

/** Les archives deja presentes, de la plus recente a la plus ancienne. */
async function archivesPresentes(destination) {
  let entrees = [];
  try {
    entrees = await fsp.readdir(destination);
  } catch {
    return []; // Le dossier n'existe pas encore : il n'y a rien a faire tourner.
  }

  return entrees
    .map((nom) => {
      const trouve = NOM.exec(nom);
      if (!trouve) return null;
      const [, annee, mois, jour] = trouve;
      return {
        nom,
        jour: `${annee}-${mois}-${jour}`,
        semaine: semaineIso(Number(annee), Number(mois), Number(jour)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.nom < b.nom ? 1 : -1));
}

/**
 * Les archives a conserver, parmi celles presentes.
 *
 * Deux regles, et leur UNION — pas leur somme : une meme archive peut etre a la
 * fois la quotidienne du jour et l'hebdomadaire de sa semaine, elle ne compte
 * alors qu'une fois.
 *
 *   - QUOTIDIENNE : la derniere archive de chacun des 7 derniers jours ou il y
 *     en a eu. Lancer la sauvegarde deux fois dans la meme journee ne consomme
 *     donc pas deux places : c'est la plus recente des deux qui est gardee.
 *   - HEBDOMADAIRE : la derniere archive de chacune des 4 dernieres semaines
 *     ISO ou il y en a eu. C'est ce qui fait qu'une erreur remarquee trois
 *     semaines plus tard — un tarif efface, une prestation supprimee — se
 *     rattrape encore.
 *
 * ⚠️ On ne s'en remet PAS a `mtime`. Un dossier de sauvegardes finit toujours
 *    par etre copie, synchronise ou restaure quelque part, et ces operations
 *    remettent les dates de fichier a l'heure du jour : la rotation croirait
 *    alors avoir douze archives d'aujourd'hui et effacerait tout l'historique.
 *    La date est celle ecrite dans le nom, qui, elle, ne bouge pas.
 */
function aGarder(archives) {
  const gardees = new Set();

  const jours = [];
  const semaines = [];

  // Les archives arrivent de la plus recente a la plus ancienne : la PREMIERE
  // rencontree pour un jour donne est donc la derniere de ce jour-la. Les
  // suivantes du meme jour ne sont pas gardees, et c'est voulu — deux
  // sauvegardes le meme matin ne doivent pas manger deux places sur sept.
  for (const archive of archives) {
    if (jours.includes(archive.jour)) continue;
    if (jours.length >= QUOTIDIENNES) break;
    jours.push(archive.jour);
    gardees.add(archive.nom);
  }

  for (const archive of archives) {
    if (semaines.includes(archive.semaine)) continue;
    if (semaines.length >= HEBDOMADAIRES) break;
    semaines.push(archive.semaine);
    gardees.add(archive.nom);
  }

  return gardees;
}

/**
 * La copie coherente de la base, ecrite dans le dossier de preparation.
 *
 * Rend `false` quand il n'y a pas de fichier de base — une instance qui n'a
 * jamais demarre, ou une base ailleurs que dans un fichier (PostgreSQL un
 * jour). Ce n'est pas une erreur : le reste de data/ merite d'etre sauvegarde
 * quand meme.
 */
function copierLaBase(versDossier) {
  if (!DATABASE_URL.startsWith('file:')) return false;

  const source = DATABASE_URL.slice('file:'.length);
  if (!fs.existsSync(source)) return false;

  const cible = path.join(versDossier, path.basename(source));

  // `readonly` : voir l'en-tete. VACUUM INTO n'ecrit que dans le fichier
  // designe, jamais dans la source — une connexion en lecture seule suffit
  // donc, et elle garantit qu'un incident ici ne laisse pas la base du client
  // dans un etat different de celui ou on l'a trouvee.
  const base = new Database(source, { readonly: true, fileMustExist: true });
  try {
    // Le chemin passe par un parametre lie, et non recopie dans la requete :
    // un dossier de destination contenant une apostrophe (« /home/René d'A/… »)
    // casserait une chaine SQL assemblee a la main.
    base.prepare('VACUUM INTO ?').run(cible);
  } finally {
    base.close();
  }

  return true;
}

/**
 * Tout data/ SAUF la base et ses fichiers de travail.
 *
 * Les `-wal`, `-shm` et `-journal` sont les brouillons de SQLite : ils n'ont de
 * sens qu'avec la base qu'ils accompagnent, a la seconde pres. La copie ecrite
 * par VACUUM INTO les a deja replies dedans ; les emporter en plus ferait
 * croire, a la restauration, a des ecritures en attente qui n'existent pas.
 */
async function copierLeReste(versDossier) {
  const baseFichier = DATABASE_URL.startsWith('file:')
    ? path.basename(DATABASE_URL.slice('file:'.length))
    : null;

  const ecarte = (nom) => nom === baseFichier
    || (baseFichier && (nom === `${baseFichier}-wal` || nom === `${baseFichier}-shm` || nom === `${baseFichier}-journal`));

  let entrees = [];
  try {
    entrees = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }

  let comptees = 0;
  for (const entree of entrees) {
    if (ecarte(entree.name)) continue;
    await fsp.cp(path.join(DATA_DIR, entree.name), path.join(versDossier, entree.name), { recursive: true });
    comptees += 1;
  }
  return comptees;
}

/** La taille d'un fichier, en unites lisibles a l'oeil. */
function taille(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

async function main() {
  const destination = dossierDeDestination();
  const nomDossierDonnees = path.basename(DATA_DIR);
  const nomArchive = `${PREFIXE}${horodatage()}${SUFFIXE}`;
  const archive = path.join(destination, nomArchive);

  await fsp.mkdir(destination, { recursive: true });

  // Le dossier de preparation porte le PID : deux sauvegardes lancees en meme
  // temps — un cron et une main — ne se marchent pas dessus.
  const preparation = path.join(destination, `.preparation-${process.pid}`);
  const dedans = path.join(preparation, nomDossierDonnees);
  await fsp.rm(preparation, { recursive: true, force: true });
  await fsp.mkdir(dedans, { recursive: true });

  try {
    const baseCopiee = copierLaBase(dedans);
    console.log(baseCopiee
      ? 'Base copiée à chaud (VACUUM INTO) : cohérente, sans interrompre le site.'
      : 'Aucun fichier de base à copier : seul le contenu de data/ est archivé.');

    const autres = await copierLeReste(dedans);
    console.log(`Contenu de ${nomDossierDonnees}/ ajouté : ${autres} élément${autres > 1 ? 's' : ''} (photos comprises).`);

    // `-C preparation nomDossierDonnees` : l'archive contient `data/…` et non
    // des chemins absolus. La restauration est alors une seule commande, et
    // elle ne peut pas ecrire ailleurs que la ou on la lance.
    await executer('tar', ['-czf', archive, '-C', preparation, nomDossierDonnees]);
    const poids = (await fsp.stat(archive)).size;
    console.log(`Archive écrite : ${archive} (${taille(poids)}).`);
  } finally {
    await fsp.rm(preparation, { recursive: true, force: true });
  }

  const archives = await archivesPresentes(destination);
  const gardees = aGarder(archives);
  const aEffacer = archives.filter((a) => !gardees.has(a.nom));

  for (const vieille of aEffacer) {
    await fsp.rm(path.join(destination, vieille.nom), { force: true });
    console.log(`Rotation : ${vieille.nom} supprimée.`);
  }

  console.log(`Rotation : ${gardees.size} archive${gardees.size > 1 ? 's' : ''} conservée${gardees.size > 1 ? 's' : ''}`
    + ` (${QUOTIDIENNES} quotidiennes, ${HEBDOMADAIRES} hebdomadaires au plus).`);

  if (!process.env.BACKUP_DIR) {
    console.log('');
    console.log('⚠️  BACKUP_DIR n\'est pas posé : les archives sont sur le même disque que la base.');
    console.log('    Cela protège de la fausse manoeuvre, pas du disque qui lâche.');
  }
}

try {
  await main();
} catch (erreur) {
  console.error('Échec de la sauvegarde :', erreur.message);
  console.error('La base du client n\'a pas été modifiée : ce script ne l\'ouvre qu\'en lecture.');
  process.exitCode = 1;
}
