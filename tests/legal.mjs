// ---------------------------------------------------------------------------
// TESTS DES MENTIONS LEGALES (lot A, point A2)
//
//     npm start          (terminal 1, laisse ouvert)
//     npm run test:legal (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE. Deux phrases, et toutes deux etaient fausses.
//
//   - « Le site est hébergé en Allemagne (Francfort), au sein de l'Union
//     européenne. Aucune donnée n'est transférée hors de l'Union. » Les
//     en-tetes de l'instance en ligne disent autre chose : un relais mondial
//     (Cloudflare) devant une origine Render. Le texte decrivait l'hebergeur
//     VISE, pas celui qui sert la page. Sur la demonstration c'est une
//     incoherence ; chez un client, c'est une declaration RGPD inexacte.
//
//   - « SIRET : à compléter. » Un gabarit visible sur la vitrine qu'on montre
//     a un prospect.
//
// LA REGLE QUI EN SORT, ET QUE CETTE SUITE TIENT : on n'ecrit que ce qui a ete
// configure. Rien de configure, rien d'affirme.
// ---------------------------------------------------------------------------

import { paragrapheHebergement } from '../src/lib/hebergement.js';
import { clientConnecte, supprimerCompteDeTest, creerVerificateur, BASE } from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const salon = await clientConnecte();

/** La page des mentions legales, telle qu'elle part sur le reseau. */
const lirePage = () => fetch(BASE + '/mentions-legales').then((r) => r.text());

/** Les reglages d'origine, remis en place a la fin quoi qu'il arrive. */
const ORIGINE = (await salon.appel('GET', '/api/admin/settings')).donnees;
const copie = (o) => JSON.parse(JSON.stringify(o));

let code = 0;

try {
  // --- 1. Le paragraphe d'hebergement, eprouve seul ------------------------
  //
  // La fonction prend un objet plutot que de lire l'environnement : c'est ce
  // qui permet d'eprouver les quatre cas sans relancer un serveur avec
  // d'autres variables.
  console.log('\n1. L\'hebergeur');
  {
    const rien = paragrapheHebergement({});

    verifie('sans configuration, une mention neutre et verifiable',
      rien.includes('voir la configuration du déploiement'), rien);
    verifie('>>> ET AUCUNE AFFIRMATION SUR LES TRANSFERTS HORS UE <<<',
      !rien.includes('Union'), rien);
    verifie('aucun pays inventé non plus',
      !/Allemagne|Francfort|France/.test(rien), rien);
  }
  {
    const nomme = paragrapheHebergement({
      nom: 'Exemple Hébergement SAS',
      pays: 'France',
      url: 'https://exemple.test',
    });

    verifie('le nom de l\'hebergeur apparait tel quel',
      nomme.includes('Exemple Hébergement SAS'), nomme);
    verifie('le pays aussi', nomme.includes('France'), nomme);
    verifie('l\'adresse devient un lien',
      nomme.includes('href="https://exemple.test"'), nomme);
    verifie('NOMMER UN HEBERGEUR N\'AFFIRME RIEN SUR LES TRANSFERTS',
      !nomme.includes('hors de l\'Union'), nomme);
  }
  {
    // La phrase sur les transferts n'a QU'UNE facon d'exister : la demander.
    const ue = paragrapheHebergement({ nom: 'Exemple SAS', pays: 'France', ue: true });
    verifie('demandee explicitement, la mention UE s\'ecrit',
      ue.includes('hors de l\'Union'), ue);

    const pasUe = paragrapheHebergement({ nom: 'Exemple SAS', pays: 'France', ue: false });
    verifie('refusee, elle disparait', !pasUe.includes('Union'), pasUe);

    // Un pays europeen ne suffit pas : c'est le piege exact d'ou vient la
    // phrase fausse. Un hebergeur allemand derriere un relais mondial ne
    // permet pas de l'ecrire.
    const allemagne = paragrapheHebergement({ nom: 'Render, Inc.', pays: 'Allemagne, Francfort' });
    verifie('>>> UN PAYS EUROPEEN NE SUFFIT PAS A L\'ECRIRE <<<',
      !allemagne.includes('Union'), allemagne);
  }
  {
    // Une adresse qui n'est pas du http(s) n'entre pas dans un href.
    const douteux = paragrapheHebergement({ nom: 'Exemple', url: 'javascript:alert(1)' });
    verifie('une adresse douteuse n\'est pas posee en lien',
      !douteux.includes('javascript:'), douteux);
  }

  // --- 2. La page servie ----------------------------------------------------
  console.log('\n2. La page');
  {
    const page = await lirePage();

    verifie('>>> PLUS AUCUN « à compléter » DANS LA PAGE <<<',
      !page.includes('à compléter'), '');
    verifie('l\'ancienne phrase sur l\'hebergement a disparu',
      !page.includes('hébergé en Allemagne'), '');
    verifie('rien n\'est affirme sur les transferts hors UE',
      !page.includes("transférée hors de l'Union"), '');
    verifie('le paragraphe d\'hebergement existe malgre tout',
      page.includes('data-champ="hebergement"'), '');
    verifie('et il dit ou regarder',
      page.includes('voir la configuration du déploiement'), '');
  }

  // --- 3. Le SIRET ----------------------------------------------------------
  //
  // Il se saisit dans Reglages > Coordonnees, et il ressort dans les mentions
  // legales. Vide, la LIGNE ENTIERE disparait — pas seulement sa valeur.
  console.log('\n3. Le SIRET');
  {
    const sans = await lirePage();
    verifie('sans SIRET, la ligne est masquee',
      sans.includes('<p data-ligne="siret" hidden>'), '');

    const brouillon = copie(ORIGINE);
    brouillon.salon.legal = { ...brouillon.salon.legal, siret: '123 456 789 00012' };
    const enregistre = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('le SIRET s\'enregistre depuis les reglages', enregistre.status === 200, enregistre.status);

    const avec = await lirePage();
    verifie('>>> ET IL RESSORT DANS LES MENTIONS LEGALES <<<',
      avec.includes('123 456 789 00012'), '');
    verifie('la ligne n\'est plus masquee',
      avec.includes('<p data-ligne="siret">'), '');
    verifie('elle est bien annoncee « SIRET »',
      /SIRET : <span class="donnee" data-champ="siret">123 456 789 00012<\/span>/.test(avec), '');
  }
  {
    // La forme juridique et le directeur de publication gardent leur repli :
    // « Entreprise individuelle », et le nom du commerce. Ce sont des mentions
    // vraies par defaut, contrairement a un numero SIRET.
    const page = await lirePage();
    verifie('la forme juridique garde son repli',
      page.includes('Entreprise individuelle'), '');
    verifie('le directeur de publication retombe sur le nom du commerce',
      page.includes(`data-champ="directeur-publication">${ORIGINE.salon.name}<`), ORIGINE.salon.name);
  }

  code = bilan();
} finally {
  await salon.appel('PUT', '/api/admin/settings', ORIGINE);
  await supprimerCompteDeTest();
}

process.exitCode = code;
