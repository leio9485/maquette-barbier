// ---------------------------------------------------------------------------
// CREATION DU COMPTE D'ACCES A L'ESPACE COMMERCANT
//
// A lancer une fois par instance client, apres l'installation :
//
//     npm run admin:create -- julie
//
// Le mot de passe est tire au hasard et affiche UNE SEULE FOIS : il n'est
// enregistre nulle part en clair, personne ne pourra le retrouver ensuite.
// A transmettre au commercant, qui pourra en choisir un autre depuis son espace.
//
// Pour redonner un mot de passe a quelqu'un qui l'a perdu :
//
//     npm run admin:create -- julie --reset
//
// Cette commande ferme aussi toutes ses sessions ouvertes.
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import { hashPassword, generatePassword } from '../src/lib/passwords.js';
import { destroyAllSessions } from '../src/lib/sessions.js';

const arguments_ = process.argv.slice(2);
const REINITIALISER = arguments_.includes('--reset');
const identifiant = arguments_.find((a) => !a.startsWith('--'))?.trim();

function encadre(titre, lignes) {
  const largeur = Math.max(titre.length, ...lignes.map((l) => l.length)) + 4;
  console.log('\n' + '='.repeat(largeur));
  console.log('  ' + titre);
  console.log('='.repeat(largeur));
  for (const ligne of lignes) console.log('  ' + ligne);
  console.log('='.repeat(largeur) + '\n');
}

async function main() {
  if (!identifiant) {
    const comptes = await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });

    console.log('Usage :');
    console.log('  npm run admin:create -- <identifiant>            créer un compte');
    console.log('  npm run admin:create -- <identifiant> --reset    nouveau mot de passe\n');

    if (comptes.length === 0) {
      console.log("Aucun compte n'existe pour l'instant : l'espace commerçant est inaccessible.");
    } else {
      console.log('Comptes existants :');
      for (const c of comptes) {
        const derniere = c.lastLoginAt
          ? c.lastLoginAt.toLocaleString('fr-FR')
          : 'jamais connecté';
        console.log(`  - ${c.username} (${derniere})`);
      }
    }
    return;
  }

  if (identifiant.length < 3) {
    throw new Error("L'identifiant doit faire au moins 3 caractères.");
  }

  const existant = await prisma.adminUser.findUnique({ where: { username: identifiant } });

  if (existant && !REINITIALISER) {
    console.log(`Le compte « ${identifiant} » existe déjà.`);
    console.log('Pour lui attribuer un nouveau mot de passe :');
    console.log(`  npm run admin:create -- ${identifiant} --reset`);
    process.exitCode = 1;
    return;
  }

  const motDePasse = generatePassword();
  const empreinte = await hashPassword(motDePasse);

  if (existant) {
    await prisma.adminUser.update({
      where: { id: existant.id },
      data: { passwordHash: empreinte },
    });
    // Un mot de passe perdu peut avoir ete vu par quelqu'un d'autre : on coupe
    // tous les acces deja ouverts.
    await destroyAllSessions(existant.id);

    encadre('MOT DE PASSE RÉINITIALISÉ', [
      `Identifiant   : ${identifiant}`,
      `Mot de passe  : ${motDePasse}`,
      '',
      'Les sessions ouvertes ont été fermées.',
      'Ce mot de passe ne sera plus jamais affiché.',
    ]);
  } else {
    await prisma.adminUser.create({
      data: { username: identifiant, passwordHash: empreinte },
    });

    encadre('COMPTE CRÉÉ', [
      `Identifiant   : ${identifiant}`,
      `Mot de passe  : ${motDePasse}`,
      '',
      'Notez-le maintenant : il ne sera plus jamais affiché.',
      'Le commerçant pourra en choisir un autre depuis son espace.',
    ]);
  }
}

main()
  .catch((erreur) => {
    console.error('\nÉchec :', erreur.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
