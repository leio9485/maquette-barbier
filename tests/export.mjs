// ---------------------------------------------------------------------------
// TESTS DE L'EXPORT CSV — l'injection de formule (lot A, point A3)
//
//     npm start           (terminal 1, laisse ouvert)
//     npm run test:export (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE.
//
// Un rendez-vous cree au nom `=1+1` ressortait de
// /api/admin/export/rendez-vous TEL QUEL, premier caractere `=` — constate sur
// l'instance en ligne, pas suppose. Le champ « Prenom et nom » du tunnel est
// ouvert a Internet : n'importe qui peut donc ecrire une formule dans le
// tableur que le commercant ouvrira. `=cmd|'/c calc'!A1` lance un programme,
// `=HYPERLINK("http://…"&A1,"Cliquez")` emporte la ligne d'a cote.
//
// LA MOITIE DE CETTE SUITE VERIFIE CE QUI MARCHAIT DEJA, et ce n'est pas du
// remplissage : le BOM UTF-8, les fins de ligne CRLF, le point-virgule
// separateur et les guillemets doubles sont ce qui rend le fichier lisible par
// un Excel francais. Une protection ajoutee a la va-vite les casse sans qu'on
// s'en apercoive — le fichier reste « valide », il ne s'ouvre simplement plus
// comme il faut.
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import { cellule } from '../src/lib/csv.js';
import {
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  BASE,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const salon = await clientConnecte();
const JOUR = prochainJourOuvert();
const PRESTATION = 'coupe-homme';

/** Les rendez-vous crees ici, effaces a la fin quoi qu'il arrive. */
const aNettoyer = [];

/**
 * UN NOM QUE LE GENERATEUR DE DEMONSTRATION NE PEUT PAS AVOIR ECRIT.
 *
 * >>> LE TEST CHERCHAIT « Maxime Vasseur » DANS L'EXPORT ENTIER. <<< C'est un
 * prenom et un nom du Nord, tires de la meme liste que celle des rendez-vous de
 * demonstration — et le generateur en avait pose un le 30 juin. `ligneAvec()`
 * rendait donc SA ligne, pas celle qu'on venait d'ecrire, et le controle du
 * telephone echouait sur un numero qui n'etait pas le sien.
 *
 * Le suffixe est tire au hasard a chaque execution, comme les references de
 * tests/annulation.mjs : deux executions dans la meme journee ne se marchent
 * pas dessus non plus.
 */
const ORDINAIRE = `Maxime Vasseur ${Math.floor(Math.random() * 9000) + 1000}`;

/** Le fichier d'un export, en octets ET en texte : le BOM ne se lit qu'en octets. */
async function telecharger(chemin) {
  const cookie = [...salon.cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ');
  const reponse = await fetch(`${BASE}/api/admin/export/${chemin}`, { headers: { Cookie: cookie } });
  const octets = Buffer.from(await reponse.arrayBuffer());
  return { octets, texte: octets.toString('utf8'), status: reponse.status };
}

/** Les creneaux libres du jour, pour poser un rendez-vous sans deviner l'heure. */
async function creneauxLibres() {
  const r = await salon.appel('GET', `/api/admin/slots?date=${JOUR}&serviceId=${PRESTATION}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free);
}

/** Cree un rendez-vous au nom donne et renvoie la ligne du CSV qui le porte. */
async function poser(nom, { telephone = '0611000000' } = {}) {
  const libres = await creneauxLibres();
  const creneau = libres.shift();
  if (!creneau) throw new Error('aucun creneau libre pour poser le rendez-vous de test');

  const cree = await salon.appel('POST', '/api/admin/bookings', {
    date: JOUR, start: creneau.start, serviceId: PRESTATION, name: nom, phone: telephone,
  });
  if (cree.status !== 201) throw new Error(`rendez-vous refuse : ${JSON.stringify(cree.donnees)}`);
  aNettoyer.push(cree.donnees.id);
  return cree.donnees.id;
}

/** La ligne du fichier qui contient ce texte. */
function ligneAvec(fichier, extrait) {
  return fichier.split('\r\n').find((l) => l.includes(extrait)) ?? '';
}

let code = 0;

try {
  // --- 1. Ce qui ressemble a une formule est neutralise ---------------------
  console.log('\n1. Les formules');
  {
    // Les amorces que les tableurs interpretent, POSEES PAR LA ROUTE PUBLIQUE
    // — c'est-a-dire par le chemin qu'emprunterait vraiment quelqu'un.
    //
    // La tabulation et le retour chariot n'y figurent pas, et cette omission
    // est le sujet de la section 4 : les noms sont coupes de leurs espaces a
    // la saisie (`texte()`, src/lib/settings.js), ces deux-la n'atteignent
    // donc jamais l'export PAR CETTE ROUTE. Ils sont eprouves plus bas, sur la
    // fonction elle-meme.
    const charges = [
      ['=1+1', '=1+1'],
      ['+33 6 11 22 33 44', '+33 6 11'],
      ['-5 rue du Test', '-5 rue'],
      ['@toto', '@toto'],
    ];

    for (const [nom, repere] of charges) {
      await poser(nom);
      const { texte } = await telecharger('rendez-vous');
      const ligne = ligneAvec(texte, repere);

      verifie(`« ${JSON.stringify(nom)} » ressort protege par une apostrophe`,
        ligne.includes(`"'${nom}"`), ligne.slice(0, 160));
    }
  }
  {
    // >>> ET SURTOUT : CE QUI EST ORDINAIRE N'EST PAS TOUCHE. <<< Une
    // protection qui prefixerait tout rendrait chaque nom illisible dans le
    // tableur, et le commercant conclurait que l'export est casse.
    await poser(ORDINAIRE);
    const { texte } = await telecharger('rendez-vous');
    const ligne = ligneAvec(texte, ORDINAIRE);

    verifie('un nom ordinaire n\'est pas prefixe',
      ligne.includes(`"${ORDINAIRE}"`) && !ligne.includes("\"'Maxime"), ligne.slice(0, 160));

    verifie('un numero de telephone francais non plus',
      ligne.includes('"0611000000"'), ligne.slice(0, 160));
  }
  {
    // Le point-virgule et le guillemet dans un nom : l'echappement d'origine,
    // celui qui existait avant ce correctif, doit tenir tel quel.
    await poser('Durand; "Le Grand"');
    const { texte } = await telecharger('rendez-vous');
    const ligne = ligneAvec(texte, 'Durand;');

    verifie('un point-virgule reste dans sa cellule',
      ligne.includes('"Durand; ""Le Grand"""'), ligne.slice(0, 200));

    // La ligne doit garder son compte de colonnes : quatorze en-tetes, donc
    // treize point-virgules SEPARATEURS. Celui du nom est entre guillemets.
    const entete = texte.replace(/^﻿/, '').split('\r\n')[0];
    verifie('et le nombre de colonnes ne bouge pas',
      ligne.split('";"').length === entete.split('";"').length,
      { ligne: ligne.split('";"').length, entete: entete.split('";"').length });
  }

  // --- 2. Les deux exports sont couverts -----------------------------------
  console.log('\n2. Les deux exports');
  {
    // L'export des clients regroupe par telephone : le nom retenu est celui du
    // DERNIER rendez-vous. On pose donc le nom fautif sur un numero a nous.
    await poser('=SOMME(A1:A9)', { telephone: '0611000001' });
    const { texte } = await telecharger('clients');
    const ligne = ligneAvec(texte, 'SOMME(A1:A9)');

    verifie('l\'export des clients protege lui aussi',
      ligne.includes('"\'=SOMME(A1:A9)"'), ligne.slice(0, 160));
  }

  // --- 3. Ce qui marchait doit continuer de marcher -------------------------
  console.log('\n3. Le format que lit Excel');
  for (const chemin of ['rendez-vous', 'clients']) {
    const { octets, texte, status } = await telecharger(chemin);

    verifie(`${chemin} : servi`, status === 200, status);
    verifie(`${chemin} : BOM UTF-8`,
      octets[0] === 0xEF && octets[1] === 0xBB && octets[2] === 0xBF, [...octets.slice(0, 3)]);
    verifie(`${chemin} : fins de ligne CRLF`, texte.includes('\r\n'), '');
    verifie(`${chemin} : separateur point-virgule`,
      texte.replace(/^﻿/, '').split('\r\n')[0].includes('";"'), '');
    verifie(`${chemin} : les en-tetes sont en francais`,
      /Téléphone|Courriel/.test(texte), '');
  }

  // --- 4. La regle elle-meme, sans passer par le serveur -------------------
  //
  // `cellule()` est la seule fonction qui fabrique une cellule dans tout le
  // projet (src/lib/csv.js). L'eprouver directement couvre ce que la route ne
  // laisse pas passer aujourd'hui — une valeur commencant par une tabulation
  // ou un retour chariot — et qui arriverait par une base reprise d'ailleurs,
  // ou par une route ecrite plus tard.
  console.log('\n4. La cellule, eprouvee seule');
  {
    for (const amorce of ['=', '+', '-', '@', '\t', '\r']) {
      const valeur = `${amorce}1+1`;
      verifie(`une valeur commencant par ${JSON.stringify(amorce)} est protegee`,
        cellule(valeur) === `"'${valeur}"`, JSON.stringify(cellule(valeur)));
    }

    verifie('un nom ordinaire traverse sans apostrophe',
      cellule('Maxime Vasseur') === '"Maxime Vasseur"', cellule('Maxime Vasseur'));
    verifie('un tarif a la francaise non plus',
      cellule('32,00') === '"32,00"', cellule('32,00'));
    verifie('une case vide reste vide', cellule(null) === '""', cellule(null));
    verifie('les guillemets internes restent doubles',
      cellule('Le "Grand"') === '"Le ""Grand"""', cellule('Le "Grand"'));

    // Une valeur qui commence DEJA par une apostrophe n'en recoit pas une
    // seconde : l'apostrophe n'est pas dans la liste des amorces, et elle n'a
    // pas a y etre — c'est la marque « ceci est du texte », pas une formule.
    verifie("une apostrophe deja presente n'en appelle pas une seconde",
      cellule("'=1+1") === `"'=1+1"`, cellule("'=1+1"));
  }

  code = bilan();
} finally {
  for (const id of aNettoyer) {
    await prisma.booking.deleteMany({ where: { id } }).catch(() => {});
  }
  await supprimerCompteDeTest();
}

process.exitCode = code;
