// ---------------------------------------------------------------------------
// LANCEUR DE LA SUITE
//
//     npm start   (terminal 1, laisse ouvert)
//     npm test    (terminal 2)
//
// Il ne fait que deux choses de plus qu'un enchainement de `&&` :
//
//   1. Il MET L'EQUIPE DE COTE avant, et la REPOSE apres — y compris quand une
//      suite echoue ou plante, puisque c'est dans un `finally`. Toute la suite
//      suppose un commerce sans equipe : avec trois personnes enregistrees,
//      reserver deux fois le meme creneau doit reussir, alors que tests/api.mjs
//      verifie precisement que ca echoue. Voir `mettreEquipeDeCote()` dans
//      tests/helpers.mjs pour le detail, et pour ce qui ne revient pas.
//
//   2. Il s'arrete a la premiere suite en echec, comme le faisait `&&`, mais en
//      disant laquelle plutot qu'en laissant lire un code de sortie.
//
// L'ORDRE DES SUITES COMPTE et n'est pas alphabetique : `categories` remet le
// catalogue d'origine, dont `staff` a besoin ; `staff` finit sur un commerce
// sans equipe, ce que les autres verifient.
//
// Chaque suite reste lancable seule (`npm run test:staff`) : tests/staff.mjs
// fait la meme mise de cote pour son propre compte, et les deux ne se genent
// pas — la seconde ne trouve plus personne a relever.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clientConnecte, supprimerCompteDeTest, mettreEquipeDeCote, reposerEquipe } from './helpers.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));

// `annulation.mjs` est en dernier, et ce n'est pas alphabetique non plus : sa
// derniere section declenche VOLONTAIREMENT la limitation de debit de
// /api/rendez-vous, qui porte sur l'adresse IP. Elle la leve avant de rendre la
// main (voir le commentaire en tete du fichier), mais la placer avant une autre
// suite ferait dependre celle-ci d'un deblocage.
const SUITES = ['api.mjs', 'settings.mjs', 'auth.mjs', 'categories.mjs', 'staff.mjs', 'chiffres.mjs', 'annulation.mjs'];

/**
 * Lance une suite dans son propre processus, sortie affichee telle quelle.
 *
 * `EQUIPE_GEREE_PAR_LE_LANCEUR` dit a la suite de ne pas toucher a l'equipe :
 * c'est fait ici, une fois pour toutes. Sans ce signal, tests/staff.mjs refaisait
 * l'operation pour son compte, reposait l'equipe et la relevait aussitot — et cet
 * aller-retour cassait une assertion sur les liens prestation/personne.
 */
function lancer(fichier) {
  return new Promise((resoudre) => {
    const enfant = spawn(process.execPath, [path.join(ICI, fichier)], {
      stdio: 'inherit',
      env: { ...process.env, EQUIPE_GEREE_PAR_LE_LANCEUR: '1' },
    });
    enfant.on('close', (code) => resoudre(code ?? 1));
  });
}

let code = 0;

try {
  await mettreEquipeDeCote(await clientConnecte());

  for (const suite of SUITES) {
    code = await lancer(suite);
    if (code !== 0) {
      console.error(`\n/!\\ Arret : tests/${suite} a echoue.`);
      break;
    }
  }
} finally {
  // Meme si une suite a plante, meme si le serveur est tombe : c'est la seule
  // chose que ce fichier doive garantir.
  //
  // On se RECONNECTE ici plutot que de reutiliser le client du debut : chaque
  // suite se termine par `supprimerCompteDeTest()`, qui efface le compte
  // partage et donc la session ouverte au demarrage. Sans cette reconnexion, la
  // remise en place repondrait 401 — au moment precis ou elle compte.
  try {
    await reposerEquipe(await clientConnecte());
  } catch (erreur) {
    console.error('/!\\ Equipe non reposee :', erreur.message);
    console.error('    Elle reste dans data/equipe-mise-de-cote.json et sera reposee au prochain `npm test`.');
    code = code || 1;
  }
  await supprimerCompteDeTest();
}

process.exitCode = code;
