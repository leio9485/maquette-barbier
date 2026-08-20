// ---------------------------------------------------------------------------
// LES NOTIFICATIONS — une seule porte de sortie.
//
// Tout ce que le site envoie a un client passe par `notifier()`. Deux canaux
// existent derriere cette porte, et AUCUN DES DEUX N'EST ACTIF PAR DEFAUT :
//
//   email  ECRIT ET TESTE. Le code appelle vraiment l'API du fournisseur, avec
//          le fichier .ics en piece jointe ; il ne s'allume que si
//          COURRIEL_ACTIF vaut "true" et que la cle et l'expediteur sont poses.
//          C'est le canal du SOCLE : sans lui, un client repart d'une
//          reservation sans aucune trace ecrite, et la promesse « moins
//          d'oublis » n'est tenue que par l'option payante.
//
//   sms    ECRIT ET TESTE, mais eteint. Le code appelle vraiment l'API de
//          Twilio ; il ne s'allume que si SMS_ACTIF vaut "true" et que les
//          trois identifiants sont poses. Le jour ou un client achete
//          l'option, il n'y a rien a coder — quatre variables a poser.
//
// POURQUOI UNE INTERFACE PLUTOT QUE DEUX FONCTIONS. Parce que l'appelant ne
// doit rien savoir du canal. Le tunnel, l'agenda et le rappel de la veille
// disent « previens cette personne de ceci » ; ce qui est allume, ce qui est
// plafonne et ce qui a echoue se decide ICI. Sans cela, chaque appelant
// porterait sa propre condition `if (SMS_ACTIF)`, et il suffirait d'en oublier
// une pour envoyer des SMS depuis une instance qui n'en vend pas.
//
// >>> UNE NOTIFICATION NE FAIT JAMAIS ECHOUER CE QUI L'A DECLENCHEE. <<<
//
// C'est la regle la plus importante du fichier. Une reservation qui aboutit
// mais dont le SMS n'est pas parti est un desagrement ; une reservation qui
// echoue parce que Twilio ne repond pas est un client perdu. `notifier()` ne
// leve donc JAMAIS : elle renvoie un compte rendu, que l'appelant peut ignorer.
//
// CE QUI N'EST PAS ICI, ET N'Y SERA PAS : le contenu des messages. Une phrase
// composee ici serait invisible depuis la page qui la declenche. Les textes
// vivent au plus pres de ce qu'ils annoncent, comme les phrases du bandeau
// d'etat vivent dans src/lib/etat.js.
// ---------------------------------------------------------------------------

import {
  COURRIEL_ACTIF,
  COURRIEL_API,
  COURRIEL_CLE,
  COURRIEL_EXPEDITEUR,
  COURRIEL_PLAFOND_MOIS,
  DEMO_MODE,
  SMS_ACTIF,
  SMS_COMPTE,
  SMS_JETON,
  SMS_EXPEDITEUR,
  SMS_PLAFOND_MOIS,
  TIMEZONE,
} from '../config.js';
import { prisma } from '../db.js';

/** Les canaux connus. Un canal absent d'ici est une erreur de programme. */
export const CANAUX = ['email', 'sms'];

/**
 * Le mois en cours, "AAAA-MM", DANS LE FUSEAU DU COMMERCE.
 *
 * Pas `new Date().toISOString()` : le 31 janvier a 23h30 a Paris, cette
 * ecriture-la renvoie fevrier une demi-heure trop tot en ete. Le plafond
 * mensuel se remettrait a zero avant la fin du mois de facturation, ce qui est
 * exactement ce qu'un plafond ne doit pas faire.
 */
export function moisCourant(maintenant = new Date()) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(maintenant);

  const valeur = (type) => parties.find((p) => p.type === type)?.value ?? '';
  return `${valeur('year')}-${valeur('month')}`;
}

/**
 * Le plafond mensuel d'un canal.
 *
 * ⚠️ L'EMAIL EN A UN, ET IL DISAIT AUTREFOIS LE CONTRAIRE — « il ne se paie pas
 *    a l'unite », ce qui est vrai et ne suffisait pas. Ce que borne ce
 *    plafond-la n'est pas la facture mais L'ABUS : ce qu'une boucle de
 *    reservations peut faire partir depuis l'adresse du commerce avant que
 *    quiconque s'en apercoive, et qui abimerait sa reputation d'expediteur pour
 *    longtemps. Il est simplement beaucoup plus large (voir COURRIEL_PLAFOND_MOIS).
 */
function plafondDe(canal) {
  if (canal === 'sms') return SMS_PLAFOND_MOIS;
  if (canal === 'email') return COURRIEL_PLAFOND_MOIS;
  return Infinity;
}

// --- Le compteur -----------------------------------------------------------

/**
 * Reserve un envoi, ou constate que le plafond est atteint.
 *
 * >>> LE COMPTEUR EST INCREMENTE AVANT L'ENVOI, PAS APRES. <<<
 *
 * Compter apres coup laisserait une fenetre pendant laquelle deux envois
 * simultanes verraient tous deux « il reste une unite ». Le plafond serait
 * alors une indication, pas une limite. Ici, la lecture et l'increment se font
 * d'un seul bloc : le depassement est impossible, au prix d'un SMS compte mais
 * non parti quand Twilio refuse — ce que `rendre()` corrige juste apres.
 */
async function reserverUneUnite(canal, mois) {
  const plafond = plafondDe(canal);

  return prisma.$transaction(async (tx) => {
    const ligne = await tx.notificationCounter.findUnique({
      where: { mois_canal: { mois, canal } },
    });

    const dejaEnvoyes = ligne?.envoyes ?? 0;

    if (dejaEnvoyes >= plafond) {
      await tx.notificationCounter.upsert({
        where: { mois_canal: { mois, canal } },
        create: { mois, canal, envoyes: 0, refuses: 1 },
        update: { refuses: { increment: 1 } },
      });
      return { accorde: false, envoyes: dejaEnvoyes, plafond };
    }

    await tx.notificationCounter.upsert({
      where: { mois_canal: { mois, canal } },
      create: { mois, canal, envoyes: 1, refuses: 0 },
      update: { envoyes: { increment: 1 } },
    });
    return { accorde: true, envoyes: dejaEnvoyes + 1, plafond };
  });
}

/**
 * Rend l'unite reservee quand l'envoi a finalement echoue.
 *
 * Sans cela, une panne de Twilio consommerait le plafond du mois sans qu'un
 * seul message ne parte. `catch {}` : si cette correction echoue a son tour, il
 * n'y a rien de mieux a faire que de laisser le compteur un cran trop haut —
 * une unite perdue vaut mieux qu'une exception remontee depuis une fonction
 * dont tout le contrat est de ne jamais lever.
 */
async function rendreUneUnite(canal, mois) {
  try {
    await prisma.notificationCounter.update({
      where: { mois_canal: { mois, canal } },
      data: { envoyes: { decrement: 1 } },
    });
  } catch { /* voir ci-dessus */ }
}

/** Ce qui a ete envoye ce mois-ci, pour l'espace commercant. */
export async function consommationDuMois(mois = moisCourant()) {
  const lignes = await prisma.notificationCounter.findMany({ where: { mois } });

  return Object.fromEntries(CANAUX.map((canal) => {
    const ligne = lignes.find((l) => l.canal === canal);
    return [canal, {
      envoyes: ligne?.envoyes ?? 0,
      refuses: ligne?.refuses ?? 0,
      plafond: plafondDe(canal),
    }];
  }));
}

// --- Les journaux ----------------------------------------------------------

/**
 * Ce qu'on ecrit dans la console quand rien ne part.
 *
 * LE MESSAGE COMPLET Y FIGURE, et c'est le but : c'est ce qui permet de
 * verifier ce qu'on ENVERRAIT avant d'allumer quoi que ce soit. Sur la
 * demonstration, c'est aussi ce qui remplace l'envoi.
 *
 * ⚠️ Le destinataire est reduit a ses quatre derniers caracteres. Les journaux
 *    d'un hebergeur se conservent, se copient et se lisent a plusieurs : un
 *    numero de telephone entier n'y a pas sa place. Quatre caracteres suffisent
 *    a reconnaitre le sien pendant une mise au point.
 */
function journaliser(mention, { canal, destinataire, sujet, texte }) {
  const abrege = String(destinataire ?? '').slice(-4).padStart(6, '…');

  console.log('');
  console.log(`  ${mention} (${canal} → ${abrege})`);
  if (sujet) console.log(`  Objet : ${sujet}`);
  for (const ligne of String(texte ?? '').split('\n')) console.log(`  | ${ligne}`);
  console.log('');
}

// --- Le canal COURRIEL -----------------------------------------------------

/**
 * L'envoi reel, par l'API du fournisseur.
 *
 * AUCUNE DEPENDANCE AJOUTEE, exactement comme pour le SMS : un envoi tient en
 * une requete `fetch` avec un jeton en « Bearer ». C'est ce qui a exclu SMTP,
 * qui aurait demande une bibliotheque entiere — negociation, STARTTLS, encodage
 * MIME — pour le meme resultat.
 *
 * ⚠️ LE CORPS EST DU JSON, ET C'EST CE QUI PERMET LA PIECE JOINTE. Le fichier
 *    .ics voyage dans le meme objet, encode en base64 : aucun message MIME a
 *    composer a la main, aucune frontiere multipart a inventer. C'est la raison
 *    pour laquelle ce format d'API a ete retenu plutot qu'un autre.
 *
 * ⚠️ LE COURRIEL PART EN TEXTE BRUT, PAS EN HTML. Un rendez-vous chez le
 *    barbier tient en six lignes ; un gabarit HTML demanderait des tableaux
 *    imbriques pour survivre a Outlook, doublerait la chance de tomber dans les
 *    indesirables, et ne dirait rien de plus. Le texte brut s'affiche partout et
 *    ne se demode pas — c'est la meme decision que le reste du site.
 *
 * N'est appelee que lorsque `COURRIEL_ACTIF` est vrai ET que la cle et
 * l'expediteur sont poses : c'est verifie par `notifier()`, une seule fois.
 */
async function envoyerCourrielReel({ destinataire, sujet, texte, piecesJointes = [] }) {
  const corps = {
    from: COURRIEL_EXPEDITEUR,
    to: [destinataire],
    subject: sujet,
    text: texte,
  };

  if (piecesJointes.length) {
    corps.attachments = piecesJointes.map((piece) => ({
      filename: piece.nom,
      content: Buffer.from(piece.contenu, 'utf8').toString('base64'),
      // Le type dit a l'application de courrier qu'il s'agit d'un evenement :
      // sans lui, iOS et Gmail proposent de telecharger un fichier au lieu
      // d'offrir « Ajouter au calendrier ».
      content_type: piece.type || 'text/calendar; charset=utf-8; method=PUBLISH',
    }));
  }

  // Le meme delai que pour le SMS, et pour la meme raison : sans lui, une
  // requete qui n'aboutit pas retiendrait un envoi en fond jusqu'a ce que le
  // systeme d'exploitation s'en lasse.
  const minuterie = AbortSignal.timeout(10_000);

  const reponse = await fetch(COURRIEL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COURRIEL_CLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corps),
    signal: minuterie,
  });

  if (!reponse.ok) {
    // Le detail est lu pour le journal du serveur, jamais renvoye au visiteur :
    // il peut contenir la cle ou l'adresse d'expedition.
    let detail = '';
    try { detail = JSON.stringify(await reponse.json()); } catch { /* corps illisible */ }
    throw new Error(`Le fournisseur de courriel a répondu ${reponse.status} ${detail}`);
  }
}

// --- Le canal SMS ----------------------------------------------------------

/**
 * L'envoi reel, par l'API de Twilio.
 *
 * AUCUNE DEPENDANCE AJOUTEE, et ce n'est pas une economie de bouts de chandelle :
 * le paquet `twilio` tire une cinquantaine de modules pour ce qui tient en une
 * requete HTTP avec une authentification « Basic ». Le projet en compte quatre,
 * chacune justifiee ; une cinquieme aurait demande mieux que « c'est plus
 * pratique ».
 *
 * Cette fonction n'est appelee que lorsque `SMS_ACTIF` est vrai ET que les
 * identifiants sont poses : c'est verifie par `notifier()`, une seule fois.
 */
async function envoyerSmsReel({ destinataire, texte }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(SMS_COMPTE)}/Messages.json`;

  const corps = new URLSearchParams({
    To: destinataire,
    From: SMS_EXPEDITEUR,
    Body: texte,
  });

  // Un delai : sans lui, une requete qui n'aboutit pas retiendrait la reponse
  // au client jusqu'a ce que le systeme d'exploitation s'en lasse. Dix secondes
  // sont largement au-dela de ce que met un envoi normal.
  const minuterie = AbortSignal.timeout(10_000);

  const reponse = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SMS_COMPTE}:${SMS_JETON}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: corps,
    signal: minuterie,
  });

  if (!reponse.ok) {
    // Le detail de la reponse est lu pour le journal du serveur, jamais renvoye
    // au visiteur : il peut contenir l'identifiant du compte.
    let detail = '';
    try { detail = JSON.stringify(await reponse.json()); } catch { /* corps illisible */ }
    throw new Error(`Twilio a répondu ${reponse.status} ${detail}`);
  }
}

// --- La porte de sortie ----------------------------------------------------

/**
 * Envoie un message, ou explique pourquoi il n'est pas parti.
 *
 * Renvoie toujours `{ envoye, raison }` et ne leve JAMAIS. Les raisons
 * possibles sont fermees, pour qu'un appelant puisse les distinguer :
 *
 *   'canal-inconnu'        erreur de programme
 *   'sans-destinataire'    le client n'a pas laisse de numero / d'adresse
 *   'eteint'               le canal existe mais n'est pas allume sur cette instance
 *   'demonstration'        DEMO_MODE : on journalise, on n'envoie pas
 *   'plafond'              le plafond du mois est atteint
 *   'panne'                le fournisseur a refuse ou n'a pas repondu
 *
 * ⚠️ `'non-implemente'` A DISPARU DE CETTE LISTE, et c'est la seule chose que
 *    ce lot retire a l'appelant. C'etait la reponse de l'email tant qu'il
 *    n'existait pas ; aucun appelant ne la distinguait de `'eteint'`, qui la
 *    remplace exactement — le canal existe, il n'est pas allume ici.
 *
 * `piecesJointes` est une liste de `{ nom, contenu, type }`. Elle ne concerne
 * que le courriel : le SMS l'ignore, et personne n'a a s'en soucier a l'appel.
 */
export async function notifier({ canal, destinataire, sujet = '', texte = '', piecesJointes = [] }) {
  const trace = { canal, destinataire, sujet, texte, piecesJointes };

  if (!CANAUX.includes(canal)) {
    console.error(`Canal de notification inconnu : ${canal}`);
    return { envoye: false, raison: 'canal-inconnu' };
  }

  // Le champ courriel est facultatif, et le telephone peut manquer sur un
  // rendez-vous saisi par le salon. Ce n'est pas une anomalie.
  if (!destinataire || !texte) return { envoye: false, raison: 'sans-destinataire' };

  // --- CE QUI EST ALLUME, ET COMMENT ON L'ENVOIE ---------------------------
  //
  // >>> LES DEUX CANAUX PARTAGENT DESORMAIS TOUT CE QUI SUIT. <<< Le compteur,
  //     la demonstration, le plafond, la reprise de l'unite en cas de panne :
  //     c'etait ecrit pour le SMS seul, et l'email s'arretait avant, sur son
  //     `return 'non-implemente'`. Les rebrancher separement aurait donne deux
  //     chemins a tenir d'accord — c'est exactement ce que cette porte unique
  //     existe pour eviter.
  const allume = canal === 'sms'
    ? Boolean(SMS_ACTIF && SMS_COMPTE && SMS_JETON && SMS_EXPEDITEUR)
    : Boolean(COURRIEL_ACTIF && COURRIEL_CLE && COURRIEL_EXPEDITEUR);

  if (!allume) {
    journaliser(canal === 'sms' ? '[SMS INACTIF]' : '[COURRIEL INACTIF]', trace);
    return { envoye: false, raison: 'eteint' };
  }

  // La demonstration ne fait sonner le telephone de personne et n'ecrit dans la
  // boite de personne. Le controle est ici, apres celui du canal : meme sur une
  // instance ou tout serait correctement configure, DEMO_MODE suffit a tout
  // retenir.
  if (DEMO_MODE) {
    journaliser(canal === 'sms'
      ? '[SMS RETENU — DÉMONSTRATION]'
      : '[COURRIEL RETENU — DÉMONSTRATION]', trace);
    return { envoye: false, raison: 'demonstration' };
  }

  const mois = moisCourant();

  let reservation;
  try {
    reservation = await reserverUneUnite(canal, mois);
  } catch (erreur) {
    // Le compteur est injoignable. ON N'ENVOIE PAS : sans compteur, il n'y a
    // plus de plafond, et c'est precisement la situation qu'il existe pour
    // eviter.
    console.error('Compteur de notifications illisible, envoi annulé :', erreur.message);
    return { envoye: false, raison: 'panne' };
  }

  if (!reservation.accorde) {
    const variable = canal === 'sms' ? 'SMS_PLAFOND_MOIS' : 'COURRIEL_PLAFOND_MOIS';
    console.error('');
    console.error(`  PLAFOND ${canal.toUpperCase()} ATTEINT pour ${mois} : ${reservation.plafond} envois.`);
    console.error(`  Le message n'est pas parti. Relever ${variable} pour en envoyer davantage.`);
    console.error('');
    return { envoye: false, raison: 'plafond' };
  }

  try {
    if (canal === 'sms') await envoyerSmsReel(trace);
    else await envoyerCourrielReel(trace);
    return { envoye: true, raison: '' };
  } catch (erreur) {
    // >>> LE FOURNISSEUR EST INJOIGNABLE, ET RIEN NE DOIT S'ARRETER POUR
    //     AUTANT. <<< On journalise, on rend l'unite reservee — sans quoi une
    //     panne consommerait le plafond du mois sans qu'un seul message ne
    //     parte — et on rend la main. L'appelant, lui, a deja repondu au
    //     client : voir `notifierEnFond()`.
    console.error(`Envoi ${canal} impossible : ${erreur.message}`);
    await rendreUneUnite(canal, mois);
    return { envoye: false, raison: 'panne' };
  }
}

/**
 * Le meme envoi, en arriere-plan.
 *
 * >>> C'EST CETTE FONCTION QU'APPELLE UNE ROUTE, PAS `notifier()`. <<<
 *
 * Elle rend la main immediatement : la reponse au client part sans attendre le
 * fournisseur. Une reservation confirmee ne doit pas attendre un SMS, et encore
 * moins echouer parce qu'il n'est pas parti.
 *
 * Le `catch` final est une ceinture par-dessus la bretelle — `notifier()` ne
 * leve deja jamais — mais une promesse rejetee sans gestionnaire arrete le
 * processus Node. Un rappel manque ne doit pas coucher le serveur.
 */
export function notifierEnFond(message) {
  notifier(message).catch((erreur) => {
    console.error('Notification abandonnée :', erreur?.message ?? erreur);
  });
}
