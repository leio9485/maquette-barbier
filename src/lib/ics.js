// ---------------------------------------------------------------------------
// LE FICHIER .ics, COTE SERVEUR — pour la piece jointe du courriel.
//
// >>> IL N'Y A QU'UNE SEULE IMPLEMENTATION, ET C'EST TOUT L'OBJET DE CE
//     FICHIER. <<<
//
// Le generateur vit dans le navigateur depuis le debut (src/page/js/07-mon-
// agenda.js) : le bouton « Ajouter à mon agenda » ecrit le fichier sur place,
// sans rien demander au reseau. Le courriel de confirmation a besoin du meme
// fichier, et la tentation evidente etait d'en recopier trois cents lignes ici.
//
// C'EST EXACTEMENT CE QU'IL NE FAUT PAS FAIRE. L'evenement pose dans l'agenda
// du client par le bouton et celui pose par la piece jointe doivent porter le
// MEME identifiant et le MEME numero de version, sans quoi le client se
// retrouve avec deux rendez-vous au lieu d'un — le defaut que `SEQUENCE` existe
// precisement pour eviter (voir le commentaire de `fabriquerIcs()`). Deux
// copies d'une regle aussi fine divergent au premier correctif.
//
// On EVALUE donc le vrai morceau, avec les deux choses que la page lui fournit
// — `CONFIG` et `location`. Ce n'est pas un artifice : tests/ics.mjs fait
// exactement cela depuis le lot D pour eprouver le fichier, et le code du site
// n'est modifie d'aucun caractere.
//
// ⚠️ LE MORCEAU NE DECLARE QUE DES FONCTIONS. Rien ne s'execute a l'evaluation,
//    et rien n'y touche au DOM : `fabriquerIcs()` compose une chaine, et c'est
//    tout. Le reste du fichier — le telechargement par `blob:`, le branchement
//    du bouton — n'est jamais appele ici.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ROOT_DIR, PUBLIC_URL } from '../config.js';

/** L'usine, compilee une fois. `null` tant que le morceau n'a pas ete lu. */
let usine = null;

/**
 * Compile le morceau de page, une seule fois par processus.
 *
 * ⚠️ ELLE NE LEVE PAS VERS L'APPELANT. Un fichier de page illisible est un
 *    incident de deploiement, pas une raison de faire echouer une reservation :
 *    l'appelant recoit `null`, le courriel part sans piece jointe, et le
 *    rendez-vous est pris. C'est la meme regle que `notifier()`.
 */
async function chargerUsine() {
  if (usine) return usine;

  try {
    const source = await readFile(
      path.join(ROOT_DIR, 'src', 'page', 'js', '07-mon-agenda.js'), 'utf8');

    usine = new Function('CONFIG', 'location', `${source}\nreturn fabriquerIcs;`);
  } catch (erreur) {
    console.error('Generateur .ics illisible, les courriels partiront sans pièce jointe :',
      erreur.message);
    return null;
  }

  return usine;
}

/**
 * Le faux `location` que le morceau regarde.
 *
 * Il s'en sert pour deux choses : le domaine de l'identifiant d'evenement
 * (`UID`) et le lien d'annulation ecrit dans la description.
 *
 * ⚠️ LE DOMAINE DOIT ETRE CELUI DU SITE, ET PAS CELUI DU SERVEUR. C'est lui qui
 *    entre dans l'`UID` : si le fichier envoye par courriel et celui telecharge
 *    depuis la page n'annoncaient pas le meme, l'agenda du client verrait deux
 *    evenements differents. `PUBLIC_URL` est la seule valeur que les deux
 *    partagent.
 *
 * Sans `PUBLIC_URL` — en local — on retombe sur un domaine neutre. Le fichier
 * reste valide ; c'est en production que la coherence compte, et la variable y
 * est posee (voir .env.example).
 */
function fausseAdresse() {
  const brut = PUBLIC_URL || 'https://localhost';
  try {
    const url = new URL(brut);
    return { origin: url.origin, hostname: url.hostname };
  } catch {
    return { origin: 'https://localhost', hostname: 'localhost' };
  }
}

/**
 * Le contenu du fichier .ics d'un rendez-vous, ou `null`.
 *
 * `config` est celle que le site sert (`loadConfig()`), c'est-a-dire exactement
 * l'objet que la page appelle `CONFIG`.
 */
export async function icsDuRendezVous(config, rendezVous) {
  const fabrique = await chargerUsine();
  if (!fabrique) return null;

  try {
    return fabrique(config, fausseAdresse())(rendezVous);
  } catch (erreur) {
    console.error('Fichier .ics non produit :', erreur.message);
    return null;
  }
}

/** « letabli-13-08-2026.ics » — un nom qui se retrouve dans un dossier. */
export function nomDuFichierIcs(nomDuCommerce, date) {
  const base = String(nomDuCommerce || 'rendez-vous')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [a, m, j] = String(date).split('-');
  return `${base || 'rendez-vous'}-${j}-${m}-${a}.ics`;
}
