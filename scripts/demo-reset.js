// ---------------------------------------------------------------------------
// Remet la vitrine de demonstration dans son etat de depart, depuis le terminal.
//
//     npm run demo:reset
//
// Le serveur le fait deja tout seul chaque nuit, et le bouton du bandeau le fait
// depuis le site. Cette commande sert quand on n'a ni l'un ni l'autre sous la
// main : juste avant un rendez-vous, ou apres avoir malmene la demonstration en
// la preparant.
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import { resetDemo, DEMO_USERNAME, DEMO_PASSWORD } from '../src/lib/demo.js';

try {
  await resetDemo();
  console.log('Démonstration remise à zéro.');
  console.log(`  Rendez-vous replacés sur la semaine qui vient.`);
  console.log(`  Espace salon : ${DEMO_USERNAME} / ${DEMO_PASSWORD}`);
} catch (erreur) {
  console.error('Échec de la remise à zéro :', erreur.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
