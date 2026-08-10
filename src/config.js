// ---------------------------------------------------------------------------
// Reglages de l'instance, lus une seule fois et partages par tout le projet.
//
// Interet d'avoir un seul endroit : le serveur et l'outil de migration doivent
// imperativement designer LE MEME fichier de base de donnees. S'ils divergeaient,
// on creerait les tables dans un fichier et on lirait dans un autre.
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Charge le fichier .env s'il existe (en local). Une fois le site en ligne,
// l'hebergeur fournit directement ces variables : il n'y a pas de .env a lire.
try {
  process.loadEnvFile();
} catch {
  // Pas de .env : on se contente des variables d'environnement deja definies.
}

/** Racine du projet (le dossier qui contient package.json). */
export const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Transforme le chemin ecrit dans .env en chemin absolu.
 *
 * Sans cela, "file:./data/commerce.db" designerait un endroit different selon le
 * dossier depuis lequel on lance la commande. On le resout donc toujours par
 * rapport a la racine du projet.
 */
function resolveDatabaseUrl(raw) {
  const value = raw || 'file:./data/commerce.db';

  // Une autre base (PostgreSQL par exemple) : on transmet tel quel.
  if (!value.startsWith('file:')) return value;

  const filePath = value.slice('file:'.length);
  if (path.isAbsolute(filePath)) return `file:${filePath}`;
  return `file:${path.resolve(ROOT_DIR, filePath)}`;
}

export const DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);

/**
 * Le dossier des donnees du commerce, deduit de l'emplacement de la base.
 *
 * Deduit, et non reglable a part : c'est ce qui garantit que TOUT ce qui
 * appartient au client — sa base et les photos qu'il depose — tienne dans un
 * seul dossier. Sauvegarder un client reste donc "copier data/", et l'ajout des
 * photos n'a rien change a cette phrase.
 *
 * Une base ailleurs que dans un fichier (PostgreSQL un jour) laisse le dossier
 * par defaut : il n'y a plus rien a en deduire.
 */
export const DATA_DIR = DATABASE_URL.startsWith('file:')
  ? path.dirname(DATABASE_URL.slice('file:'.length))
  : path.join(ROOT_DIR, 'data');

/** Les photos de la vitrine deposees par le commercant (voir src/lib/photos.js). */
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

export const PORT = Number(process.env.PORT) || 3000;

/**
 * Adresse publique du site, une fois en ligne (ex. https://letabli-bavay.fr).
 *
 * Sert a l'en-tete de la page : adresse canonique, et lien de la fiche pour les
 * moteurs et les apercus de partage. Inconnue en local, donc facultative — sans
 * elle, ces deux lignes sont simplement omises.
 */
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

/**
 * Fuseau horaire du commerce.
 *
 * Determine ce qu'est "aujourd'hui" et "l'heure qu'il est" pour le calcul des
 * creneaux. A regler par client si un jour l'un d'eux n'est pas en metropole ;
 * il doit surtout ne PAS dependre du reglage de la machine qui heberge le site.
 */
export const TIMEZONE = process.env.TIMEZONE || 'Europe/Paris';

/**
 * Vrai quand le site tourne pour de vrai, faux sur la machine de developpement.
 *
 * Sert surtout au cookie de connexion : en production il est marque "Secure",
 * ce qui interdit au navigateur de l'envoyer ailleurs que sur une liaison
 * chiffree (https). En local, ou l'on travaille en http, cette marque
 * empecherait tout simplement de se connecter.
 */
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Instance de demonstration, montree a de futurs clients.
 *
 * Elle ouvre l'espace salon a tous, avec des identifiants affiches a l'ecran, et
 * se remet a zero chaque nuit (voir src/lib/demo.js). A n'activer QUE sur la
 * vitrine de demonstration : chez un vrai client, cela reviendrait a publier
 * l'agenda de ses clientes.
 */
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

// ---------------------------------------------------------------------------
// LES NOTIFICATIONS
//
// Deux canaux sont prevus, aucun n'est actif par defaut. Voir
// src/lib/notifications.js pour le detail de ce qui part et de ce qui ne part
// pas.
// ---------------------------------------------------------------------------

/**
 * Le SMS de confirmation et de rappel.
 *
 * >>> ECRIT, TESTE, ET VOLONTAIREMENT ETEINT. <<<
 *
 * Le code d'envoi est complet — il appelle vraiment l'API de Twilio — mais il
 * ne s'allume que si `SMS_ACTIF` vaut exactement "true" ET que les trois
 * identifiants sont fournis. Tant qu'aucun client n'a acheté l'option, aucune
 * instance n'envoie quoi que ce soit et aucune ne peut le faire par accident :
 * il faut poser quatre variables, ce qui ne se fait pas en se trompant.
 *
 * Le jour ou un client la prend, il n'y a rien a coder — seulement quatre
 * lignes a poser sur son instance, et le plafond a regler.
 */
export const SMS_ACTIF = process.env.SMS_ACTIF === 'true';

export const SMS_COMPTE = process.env.SMS_COMPTE || '';      // Twilio Account SID
export const SMS_JETON = process.env.SMS_JETON || '';        // Twilio Auth Token
export const SMS_EXPEDITEUR = process.env.SMS_EXPEDITEUR || '';

/**
 * Plafond mensuel d'envois, par canal. DUR, et jamais depasse en silence.
 *
 * Un SMS se paie a l'unite. Sans plafond, une boucle mal ecrite ou un agenda
 * charge transforme une option a quelques euros en facture a trois chiffres, et
 * personne ne s'en apercoit avant le prelevement. Au-dela, l'envoi est REFUSE,
 * compte a part, et affiche au commercant (voir src/lib/notifications.js).
 *
 * 200 par defaut : de l'ordre de ce qu'un barbier seul consomme en un mois s'il
 * envoie une confirmation et un rappel par rendez-vous en ligne.
 *
 * ⚠️ PAS DE `Number(...) || 200` ICI, ET C'EST UN BOGUE CONSTATE. Zero est
 *    faux en JavaScript : `SMS_PLAFOND_MOIS=0` — la facon la plus evidente de
 *    dire « aucun envoi » — retombait silencieusement sur 200. Un plafond qu'on
 *    croit avoir ferme et qui laisse passer deux cents SMS est exactement le
 *    genre de panne qui se decouvre sur une facture.
 */
function plafondConfigure(brut, defaut) {
  if (brut === undefined || brut === '') return defaut;
  const valeur = Number(brut);
  return Number.isFinite(valeur) && valeur >= 0 ? Math.floor(valeur) : defaut;
}

export const SMS_PLAFOND_MOIS = plafondConfigure(process.env.SMS_PLAFOND_MOIS, 200);
