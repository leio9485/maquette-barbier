// ---------------------------------------------------------------------------
// CE QUE LE SITE ECRIT AU CLIENT.
//
// Trois messages, et trois seulement : la confirmation, le deplacement,
// l'annulation. Le rappel de la veille n'est pas ici — il demande une tache
// planifiee, qui est un autre sujet.
//
// >>> POURQUOI LE TEXTE N'EST PAS DANS notifications.js. <<< Cette regle est
// ecrite en tete de ce fichier-la, et elle vaut : une phrase composee dans la
// porte de sortie serait invisible depuis ce qui la declenche. Le contenu vit
// au plus pres de ce qu'il annonce, comme les phrases du bandeau vivent dans
// src/lib/etat.js — et c'est aussi ce qui permet de le relire sans lire une
// ligne de mecanique d'envoi.
//
// LE TON EST CELUI DU SITE, et il n'y a pas deux tons dans ce projet : phrases
// courtes, voix active, on dit ce qui s'est passe et ce qu'on peut faire. Aucun
// adjectif de vente, aucune formule de politesse commerciale. Un courriel de
// confirmation qui commence par « Nous avons le plaisir de » vient d'un autre
// logiciel que celui-ci.
//
// ⚠️ AUCUN HTML. Le message part en texte brut (voir `envoyerCourrielReel()`),
//    et ces fonctions rendent donc du texte. Un gabarit HTML demanderait des
//    tableaux imbriques pour survivre a Outlook, doublerait la chance de tomber
//    dans les indesirables, et ne dirait rien de plus que six lignes.
//
// ⚠️ LA REFERENCE FIGURE DANS LES TROIS, y compris l'annulation. C'est elle que
//    le client relit s'il rappelle, et elle survit au rendez-vous : le courriel
//    d'annulation est la derniere trace ecrite qu'il en garde.
// ---------------------------------------------------------------------------

import { PUBLIC_URL } from '../config.js';
import { notifierEnFond } from './notifications.js';
import { icsDuRendezVous, nomDuFichierIcs } from './ics.js';
import { loadConfig } from './settings.js';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « samedi 15 août 2026 ». */
function dateLongue(iso) {
  const [a, m, j] = String(iso).split('-').map(Number);
  if (!a || !m || !j) return String(iso);
  const jourSemaine = JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()];
  return `${jourSemaine} ${j} ${MOIS[m - 1]} ${a}`;
}

/** 570 -> « 09:30 ». Les minutes depuis minuit, jamais un horodatage. */
function heure(minutes) {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** « 18 € », « 18,50 € ». */
function prix(cents) {
  if (cents === null || cents === undefined) return '';
  const euros = cents / 100;
  return `${Number.isInteger(euros) ? euros : euros.toFixed(2).replace('.', ',')} €`;
}

/**
 * L'adresse de la page d'annulation.
 *
 * ⚠️ SANS `PUBLIC_URL`, LE LIEN NE S'ECRIT PAS. Une adresse relative n'a aucun
 *    sens dans un courriel, et « http://localhost/annuler » chez un client
 *    serait pire qu'un lien manquant. La phrase se replie alors sur la
 *    reference et le telephone, qui suffisent a annuler.
 */
function lienAnnulation() {
  return PUBLIC_URL ? `${PUBLIC_URL}/annuler` : '';
}

/**
 * Le pied commun aux trois messages : qui ecrit, et ou l'on va.
 *
 * Il n'est pas une signature de politesse mais une carte de visite : le nom, la
 * rue, le telephone. C'est ce qu'on cherche dans un courriel de rendez-vous six
 * jours plus tard, et le chercher ailleurs veut dire ouvrir un moteur de
 * recherche — c'est-a-dire tomber sur les concurrents.
 */
function pied(salon) {
  const adresse = [salon.street, [salon.postalCode, salon.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  return [
    '—',
    salon.name,
    adresse,
    salon.phone ? `Téléphone : ${salon.phone}` : '',
  ].filter(Boolean).join('\n');
}

/** « Coupe homme · 25 min · 18 € », sans les morceaux qu'on ne connait pas. */
function laPrestation({ prestation, duree, tarifCents }) {
  return [prestation, duree ? `${duree} min` : '', prix(tarifCents)]
    .filter(Boolean).join(' · ');
}

/** Les lignes « le rendez-vous », partagees par la confirmation et le deplacement. */
function leRendezVous(rdv) {
  return [
    `Quand : ${dateLongue(rdv.date)} à ${heure(rdv.start)}`,
    `Quoi : ${laPrestation(rdv)}`,
    rdv.avec ? `Avec : ${rdv.avec}` : '',
    rdv.reference ? `Référence : ${rdv.reference}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Comment annuler ou deplacer, en deux lignes.
 *
 * >>> LES QUATRE DERNIERS CHIFFRES SONT RAPPELES, ET LE LIEN NE LES CONTIENT
 *     PAS. <<< Un lien qui ouvrirait le rendez-vous tout seul ferait du
 *     courriel un secret permanent : reexpedie, retrouve dans une boite
 *     partagee, il donnerait acces au rendez-vous a n'importe qui. La page
 *     redemande donc la reference ET quatre chiffres du telephone — c'est le
 *     second facteur de /annuler, et il ne se contourne pas depuis ici.
 */
function commentChanger(rdv, salon) {
  const lien = lienAnnulation();

  return [
    lien
      ? `Pour annuler ou déplacer : ${lien}`
      : 'Pour annuler ou déplacer, appelez-nous.',
    lien && rdv.reference
      ? `Il vous faudra la référence ${rdv.reference} et les quatre derniers chiffres de votre téléphone.`
      : '',
    salon.phone ? `Un empêchement de dernière minute ? Appelez le ${salon.phone}.` : '',
  ].filter(Boolean).join('\n');
}

/**
 * LA CONFIRMATION, juste apres la reservation.
 *
 * C'est le message qui porte tout le poids du lot : sans lui, un client repart
 * avec une reference de six caracteres qu'il a peut-etre notee, et rien
 * d'autre.
 */
export function courrielDeConfirmation({ salon, rdv }) {
  // Des BLOCS, pas des lignes : voir `courrielDeDeplacement()` juste en dessous.
  const blocs = [
    `Bonjour ${rdv.nom || ''}`.trim() + ',',
    `Votre rendez-vous chez ${salon.name} est enregistré.`,
    leRendezVous(rdv),
    // >>> RIEN A PAYER MAINTENANT, ET IL FAUT LE REDIRE. <<< C'est l'argument
    //     central du site — aucun acompte, aucun compte a creer — et un client
    //     qui recoit le courriel d'un commerce se demande souvent s'il vient de
    //     payer quelque chose.
    'À régler sur place. Aucun acompte n\'a été prélevé.',
    commentChanger(rdv, salon),
    pied(salon),
  ];

  return {
    sujet: `Rendez-vous confirmé · ${dateLongue(rdv.date)} à ${heure(rdv.start)}`,
    texte: blocs.filter(Boolean).join('\n\n'),
  };
}

/** LE DEPLACEMENT : meme reference, nouveau creneau. */
export function courrielDeDeplacement({ salon, rdv, avant }) {
  // ⚠️ LES BLOCS SONT ASSEMBLES, PAS LES LIGNES. Un `filter(Boolean)` sur une
  //    liste de lignes emporterait aussi les lignes VIDES, c'est-a-dire les
  //    respirations entre les paragraphes : le message deviendrait un pave.
  //    On filtre donc des blocs, et on les joint par une ligne vide.
  const blocs = [
    `Bonjour ${rdv.nom || ''}`.trim() + ',',
    `Votre rendez-vous chez ${salon.name} a été déplacé.`,
    // L'AVANT ET L'APRES, DANS CET ORDRE. Un courriel qui n'annonce que la
    // nouvelle heure laisse le doute : est-ce un second rendez-vous ? La ligne
    // « Avant » repond avant qu'on se pose la question.
    [
      avant ? `Avant : ${dateLongue(avant.date)} à ${heure(avant.start)}` : '',
      leRendezVous(rdv),
    ].filter(Boolean).join('\n'),
    // ⚠️ LA REFERENCE N'A PAS CHANGE, et c'est exactement ce qu'un deplacement
    //    garantit — voir PATCH /api/admin/bookings/:id. Le dire evite que le
    //    client cherche une nouvelle reference qui n'existe pas.
    rdv.reference ? 'La référence n\'a pas changé.' : '',
    commentChanger(rdv, salon),
    pied(salon),
  ];

  return {
    sujet: `Rendez-vous déplacé · ${dateLongue(rdv.date)} à ${heure(rdv.start)}`,
    texte: blocs.filter(Boolean).join('\n\n'),
  };
}

/** L'ANNULATION : ce qui a ete annule, et comment revenir. */
export function courrielDAnnulation({ salon, rdv }) {
  const lien = PUBLIC_URL || '';

  const blocs = [
    `Bonjour ${rdv.nom || ''}`.trim() + ',',
    `Votre rendez-vous chez ${salon.name} est annulé.`,
    leRendezVous(rdv),
    // ON NE DEMANDE PAS POURQUOI, ET ON NE RETIENT PERSONNE. Le creneau est
    // reparti ; la seule chose utile a dire est comment en reprendre un.
    //
    // ⚠️ SANS `PUBLIC_URL`, LA PHRASE SE REECRIT — elle ne perd pas sa
    //    premiere moitie. « Ou par téléphone au … » tout seul, sans le « Pour
    //    reprendre rendez-vous : … » qui le precede, commence par un « Ou »
    //    qui ne repond a rien.
    [
      lien ? `Pour reprendre rendez-vous : ${lien}` : '',
      salon.phone
        ? (lien ? `Ou par téléphone au ${salon.phone}.`
          : `Pour reprendre rendez-vous, appelez le ${salon.phone}.`)
        : '',
    ].filter(Boolean).join('\n'),
    pied(salon),
  ];

  return {
    sujet: `Rendez-vous annulé · ${dateLongue(rdv.date)} à ${heure(rdv.start)}`,
    texte: blocs.filter(Boolean).join('\n\n'),
  };
}

// ---------------------------------------------------------------------------
// LE POINT D'APPEL DES ROUTES
//
// >>> UNE SEULE LIGNE PAR ROUTE, ET RIEN A DECIDER SUR PLACE. <<< Une route
// dit `prevenirLeClient('confirmation', { rendezVous })` et passe a la suite.
// Ce qui est allume, ce qui est plafonne et ce qui a echoue se decide dans
// src/lib/notifications.js ; ce qui s'ecrit se decide au-dessus. La route, elle,
// n'a a savoir ni l'un ni l'autre.
//
// ⚠️ ELLE NE REND RIEN, ET ELLE NE S'ATTEND PAS. `notifierEnFond()` rend la
//    main immediatement : la reponse au client part sans attendre le
//    fournisseur. Une reservation confirmee ne doit pas attendre un courriel, et
//    encore moins echouer parce qu'il n'est pas parti — c'est la regle en tete
//    de notifications.js, et c'est elle qui commande ici.
//
// ⚠️ CE QUI PRECEDE L'ENVOI EST ASYNCHRONE ET PEUT ECHOUER : lire les reglages,
//    produire le .ics. Tout est donc dans un `catch` qui journalise et se tait.
//    Une reservation qui aboutit et dont le courriel n'est pas parti est un
//    desagrement ; une reservation qui echoue parce que la composition d'un
//    courriel a leve est un client perdu.
// ---------------------------------------------------------------------------

const COMPOSITEURS = {
  confirmation: courrielDeConfirmation,
  deplacement: courrielDeDeplacement,
  annulation: courrielDAnnulation,
};

/**
 * La ligne de la base, dans le vocabulaire des messages.
 *
 * `config` sert a nommer la prestation et la personne : la ligne ne porte que
 * leurs identifiants, et un courriel qui dirait « Quoi : coupe-homme » aurait
 * l'air d'une sortie de journal.
 */
function habillerPourLeCourriel(ligne, config) {
  const prestation = config.services.find((p) => p.id === ligne.serviceId);
  const personne = config.staff.find((p) => p.id === ligne.staffId);

  return {
    date: ligne.date,
    start: ligne.startMin,
    duree: ligne.durationMin,
    // Le TARIF CONVENU, fige a la prise du rendez-vous, et non celui d'
    // aujourd'hui : c'est la regle du champ `priceCents` (prisma/schema.prisma),
    // et un courriel qui annoncerait un autre prix que celui promis serait la
    // pire facon de la trahir.
    tarifCents: ligne.priceCents ?? null,
    prestation: prestation?.name ?? '',
    avec: personne?.name ?? '',
    reference: ligne.reference ?? '',
    nom: ligne.customerName ?? '',
  };
}

/**
 * Previens le client, s'il a laisse une adresse.
 *
 * @param {'confirmation'|'deplacement'|'annulation'} genre
 * @param {object} rendezVous  la ligne de la base, telle quelle
 * @param {object} [avant]     `{ date, start }` — le deplacement seulement
 */
export async function prevenirLeClient(genre, { rendezVous, avant = null }) {
  // LE COURRIEL EST FACULTATIF, et son absence n'est pas une anomalie : le
  // champ l'est dans le tunnel, et un rendez-vous saisi au comptoir n'en a
  // souvent aucun. On sort avant de lire quoi que ce soit.
  if (!rendezVous?.customerEmail) return;

  const composer = COMPOSITEURS[genre];
  if (!composer) {
    console.error(`Genre de courriel inconnu : ${genre}`);
    return;
  }

  try {
    const config = await loadConfig({ includeInactive: true });
    const rdv = habillerPourLeCourriel(rendezVous, config);
    const { sujet, texte } = composer({ salon: config.salon, rdv, avant });

    // >>> LE .ics VOYAGE AVEC LA CONFIRMATION ET LE DEPLACEMENT, PAS AVEC
    //     L'ANNULATION. <<< Joindre un evenement a un courriel qui annonce sa
    //     disparition est la meilleure facon de le voir reapparaitre dans
    //     l'agenda du client. Le retirer d'un agenda demande un fichier de
    //     methode `CANCEL`, qui n'est pas le meme fichier ; tant qu'il n'existe
    //     pas, on n'envoie rien plutot que d'envoyer le contraire.
    const piecesJointes = [];
    if (genre !== 'annulation') {
      const ics = await icsDuRendezVous(config, {
        date: rdv.date,
        start: rdv.start,
        duree: rdv.duree,
        prestation: rdv.prestation,
        avec: rdv.avec,
        reference: rdv.reference,
        // Le meme numero de version que celui du bouton « Ajouter à mon
        // agenda » : les secondes ecoulees depuis la creation. C'est lui qui
        // fait qu'un deplacement DEPLACE l'evenement au lieu d'en poser un
        // second — voir `pourLeClient()`, src/routes/rendezvous.js.
        version: versionDe(rendezVous),
      });

      if (ics) {
        piecesJointes.push({ nom: nomDuFichierIcs(config.salon.name, rdv.date), contenu: ics });
      }
    }

    notifierEnFond({
      canal: 'email',
      destinataire: rendezVous.customerEmail,
      sujet,
      texte,
      piecesJointes,
    });
  } catch (erreur) {
    console.error(`Courriel « ${genre} » non composé :`, erreur?.message ?? erreur);
  }
}

/**
 * Les secondes ecoulees entre la creation et la derniere ecriture.
 *
 * ⚠️ MEME CALCUL QUE `version()` DANS src/routes/rendezvous.js, ET IL LE DOIT :
 *    les deux nourrissent le `SEQUENCE` du MEME evenement, l'un par le bouton
 *    de la page, l'autre par la piece jointe. Deux calculs differents feraient
 *    deux rendez-vous dans l'agenda du client au lieu d'un.
 *
 * Borne a zero : une base restauree peut porter un `updatedAt` anterieur au
 * `createdAt`, et un `SEQUENCE` negatif rend le fichier invalide.
 */
function versionDe(rendezVous) {
  const cree = rendezVous.createdAt?.getTime?.() ?? 0;
  const modifie = rendezVous.updatedAt?.getTime?.() ?? cree;
  return Math.max(0, Math.round((modifie - cree) / 1000));
}
