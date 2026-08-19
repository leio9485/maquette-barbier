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
// L'HEBERGEUR, TEL QU'IL EST DECLARE DANS LES MENTIONS LEGALES
//
// Le paragraphe « Hébergement » etait ecrit en dur dans la page, et il etait
// faux : il decrivait l'hebergeur VISE (Koyeb, Francfort) et non celui qui sert
// reellement le site. Il affirmait en outre qu'aucune donnee ne quitte l'Union
// europeenne — une declaration RGPD qu'aucune ligne de code ne pouvait tenir.
//
// >>> AUCUNE VALEUR PAR DEFAUT ICI, ET C'EST LE FOND DU CORRECTIF. <<<
//
// Le code ne sait pas ou il tourne. Un defaut ecrit dans le code serait vrai
// sur une instance et faux sur la suivante, sans que personne ne s'en apercoive
// — c'est exactement ce qui vient de se produire. Ces valeurs appartiennent au
// DEPLOIEMENT : elles sont posees sur l'instance (voir render.yaml pour la
// demonstration, .env.example pour le modele). Absentes, la page affiche une
// mention neutre et verifiable plutot qu'une affirmation (src/lib/hebergement.js).
// ---------------------------------------------------------------------------

export const HEBERGEUR_NOM = (process.env.HEBERGEUR_NOM || '').trim();
export const HEBERGEUR_PAYS = (process.env.HEBERGEUR_PAYS || '').trim();
export const HEBERGEUR_URL = (process.env.HEBERGEUR_URL || '').trim();

/**
 * « Aucune donnee n'est transferee hors de l'Union europeenne. »
 *
 * >>> UNE AFFIRMATION JURIDIQUE, DONC UN INTERRUPTEUR A PART. <<< Elle ne se
 * deduit PAS du pays annonce : un hebergeur allemand peut parfaitement faire
 * transiter les requetes par un relais mondial, ce qui est le cas de l'instance
 * de demonstration (Cloudflare devant une origine Render). Il faut donc poser
 * HEBERGEUR_UE=true, en connaissance de cause, pour que la phrase apparaisse.
 */
export const HEBERGEUR_UE = process.env.HEBERGEUR_UE === 'true';

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

// ---------------------------------------------------------------------------
// LES PLAFONDS DE RESERVATION
//
// Rien n'empechait de remplir l'agenda d'un client avec une boucle de dix
// lignes. Aucun acompte, aucun compte a creer — c'est l'argument de vente
// central du produit, et c'est aussi ce qui laisse la porte grande ouverte.
//
// CE QUE CES PLAFONDS FONT, ET CE QU'ILS NE FONT PAS. Ils transforment une
// catastrophe en desagrement : au lieu de milliers de faux rendez-vous, une
// vingtaine, et le commercant a le temps de s'en apercevoir. Ils n'arretent PAS
// un adversaire determine avec plusieurs adresses — et la vraie parade contre
// celui-la (verification par SMS, acompte, CAPTCHA) est refusee par le produit,
// deliberement. C'est un ralentisseur, pas un mur, et c'est assume.
//
// >>> ILS SONT CALES POUR NE JAMAIS GENER UN CLIENT REEL, Y COMPRIS DERRIERE
//     UNE ADRESSE PARTAGEE. <<< Le reseau mobile d'un operateur, le wifi d'un
//     centre commercial, la connexion d'une entreprise : des dizaines de
//     personnes y sortent par la meme adresse. Un plafond serre y ferait des
//     victimes qu'on ne verrait jamais — quelqu'un qui n'arrive pas a reserver
//     ne se plaint pas, il appelle un autre barbier.
// ---------------------------------------------------------------------------

/**
 * En rafale : cinq reservations abouties en trois minutes.
 *
 * C'est le plafond qui protege vraiment. Personne ne prend cinq rendez-vous en
 * trois minutes ; un programme en prend cinq cents. Une famille qui en cale
 * trois d'affilee reste en dessous.
 */
export const RESERVATIONS_RAFALE_MAX = plafondConfigure(process.env.RESERVATIONS_RAFALE_MAX, 5);
export const RESERVATIONS_RAFALE_MS = 3 * 60 * 1000;

/**
 * Dans la duree : vingt reservations abouties par heure et par adresse.
 *
 * Large, et c'est voulu : il ne doit se declencher que sur un acharnement lent,
 * celui qui passe sous le plafond de rafale en espacant ses envois.
 */
export const RESERVATIONS_HEURE_MAX = plafondConfigure(process.env.RESERVATIONS_HEURE_MAX, 20);

/**
 * Les TENTATIVES, abouties ou non : soixante par heure.
 *
 * Les deux plafonds ci-dessus ne comptent que ce qui aboutit — c'est ce qui
 * salit l'agenda. Celui-ci attrape l'autre nuisance : quelqu'un qui envoie des
 * requetes malformees en boucle ne cree rien, mais fait travailler la base a
 * chaque fois. Assez haut pour qu'un client qui se trompe dix fois de suite ne
 * le rencontre jamais.
 */
export const RESERVATIONS_TENTATIVES_MAX = plafondConfigure(process.env.RESERVATIONS_TENTATIVES_MAX, 60);

/** La fenetre commune aux deux plafonds horaires. */
export const RESERVATIONS_FENETRE_MS = 60 * 60 * 1000;
