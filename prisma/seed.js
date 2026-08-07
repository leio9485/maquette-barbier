// ---------------------------------------------------------------------------
// REMPLISSAGE INITIAL DE LA BASE ("seed", la graine)
//
// Prepare une base neuve avec les valeurs de src/lib/defaults.js — le fichier
// a adapter pour chaque nouveau client.
//
// PRUDENCE : si la base contient deja des reglages, ce script n'y touche PAS.
// Sans ce garde-fou, le relancer par megarde sur l'instance d'un vrai client
// effacerait les prestations et horaires qu'il a lui-meme saisis.
// Pour forcer malgre tout le retour aux valeurs d'origine :
//
//     node prisma/seed.js --force
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import { DEFAULT_CONFIG } from '../src/lib/defaults.js';
import { normalizeConfig, validateConfig, saveConfig } from '../src/lib/settings.js';
// Les rendez-vous d'exemple sont ceux du mode demonstration : une seule
// definition, pour que la base de depart ressemble a ce que verra un prospect.
import { rendezVousDemo } from '../src/lib/demo.js';

const FORCER = process.argv.includes('--force');

async function main() {
  const dejaReglee = await prisma.settings.findUnique({ where: { id: 1 } });

  if (dejaReglee && !FORCER) {
    console.log('La base contient déjà des réglages : ils sont laissés intacts.');
    console.log('Pour les remplacer par les valeurs d\'origine : node prisma/seed.js --force');
  } else {
    const config = normalizeConfig(DEFAULT_CONFIG);

    // Les valeurs d'origine passent par les mêmes contrôles que celles saisies
    // depuis l'espace commerçant : une erreur dans defaults.js se voit tout de
    // suite, et pas le jour où un créneau manque.
    const probleme = validateConfig(config);
    if (probleme) throw new Error(`Valeurs d'origine invalides : ${probleme}`);

    await saveConfig(config);
    console.log(dejaReglee ? 'Réglages remis aux valeurs d\'origine.' : 'Réglages enregistrés.');
  }

  // Rendez-vous de démonstration : uniquement si l'agenda est encore vide, pour
  // ne jamais écraser de vrais rendez-vous.
  const dejaPris = await prisma.booking.count();
  if (dejaPris === 0) {
    // Les rendez-vous s'attribuent a l'equipe REELLEMENT enregistree. Avec les
    // valeurs d'origine d'un client qui demarre seul, il n'y en a pas, et ils
    // partent sans personne attribuee — ce qui est exact.
    const equipe = (await prisma.staff.findMany({ select: { id: true } })).map((p) => p.id);
    await prisma.booking.createMany({ data: rendezVousDemo({ equipe }) });
  }

  const compte = {
    prestations: await prisma.service.count(),
    horaires: await prisma.openingHours.count(),
    equipe: await prisma.staff.count(),
    rendezVous: await prisma.booking.count(),
  };

  console.log('\nÉtat de la base :');
  console.log(`  - commerce    : ${DEFAULT_CONFIG.salon.name}, ${DEFAULT_CONFIG.salon.city}`);
  console.log(`  - prestations : ${compte.prestations}`);
  console.log(`  - horaires    : ${compte.horaires} jours`);
  console.log(`  - equipe      : ${compte.equipe === 0 ? 'aucune (agenda unique)' : compte.equipe + ' personnes'}`);
  console.log(`  - rendez-vous : ${compte.rendezVous}${dejaPris === 0 ? ' (démonstration)' : ' (déjà présents, inchangés)'}`);
}

main()
  .catch((erreur) => {
    console.error('Échec du remplissage de la base :', erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
