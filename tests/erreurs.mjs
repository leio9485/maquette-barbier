// ---------------------------------------------------------------------------
// TESTS DES ADRESSES QUI N'EXISTENT PAS (lot A, point A1)
//
//     npm start            (terminal 1, laisse ouvert)
//     npm run test:erreurs (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE.
//
// `GET /page-inexistante` renvoyait le gestionnaire par defaut d'Express :
// « Cannot GET /page-inexistante », en Times New Roman, en anglais, sur fond
// blanc. Les adresses en /api/ avaient deja leur 404 en JSON — l'incoherence
// n'etait donc que du cote des pages, c'est-a-dire du seul cote qu'un visiteur
// regarde. Un prospect a qui l'on montre le site n'a pas besoin de chercher :
// une lettre de trop dans la barre d'adresse suffit.
//
// LES DEUX PUBLICS SONT VERIFIES SEPAREMENT. Un navigateur annonce `text/html`
// et doit recevoir la page ; tout le reste — un appel programme, un moniteur,
// un `fetch` — doit recevoir le meme JSON que les adresses en /api/. Servir
// une page HTML a un programme qui attendait du JSON ajoute une erreur a
// diagnostiquer plutot que d'en retirer une.
// ---------------------------------------------------------------------------

import { creerVerificateur, BASE } from './helpers.mjs';
import { loadConfig } from '../src/lib/settings.js';
import { prisma } from '../src/db.js';

const { verifie, bilan } = creerVerificateur();

/** Une adresse qui n'a aucune chance d'exister, differente a chaque execution. */
const INCONNUE = `/adresse-qui-n-existe-pas-${Math.random().toString(36).slice(2, 8)}`;

async function demander(chemin, accept) {
  const reponse = await fetch(BASE + chemin, { headers: accept ? { Accept: accept } : {} });
  return {
    status: reponse.status,
    type: reponse.headers.get('content-type') ?? '',
    robots: reponse.headers.get('x-robots-tag') ?? '',
    corps: await reponse.text(),
  };
}

let code = 0;

try {
  const config = await loadConfig({ includeInactive: false });

  // --- 1. Un navigateur recoit une page ------------------------------------
  console.log('\n1. Ce que voit un visiteur');
  {
    const r = await demander(INCONNUE, 'text/html');

    verifie('le code est bien 404', r.status === 404, r.status);
    verifie('la reponse est du HTML', r.type.includes('text/html'), r.type);
    verifie('>>> PLUS AUCUN « Cannot GET » <<<', !r.corps.includes('Cannot GET'), '');
    verifie('la page est en francais', r.corps.includes('lang="fr"'), '');

    verifie('elle porte le nom du commerce',
      r.corps.includes(config.salon.name), config.salon.name);
    verifie('elle explique ce qui se passe',
      r.corps.includes('Page introuvable'), '');
    verifie('elle ramene a l\'accueil', r.corps.includes('href="/"'), '');
    verifie('elle propose de prendre rendez-vous',
      r.corps.includes('href="/#reserver"'), '');

    // Le telephone en lien `tel:` — sur un telephone, c'est la sortie de
    // secours la plus courte : on appelle, on ne cherche plus.
    const compose = String(config.salon.phone).replace(/[^\d+]/g, '');
    verifie('elle porte le telephone en lien tel:',
      r.corps.includes(`href="tel:${compose}"`), compose);
    verifie('et le numero s\'y lit comme il s\'ecrit',
      r.corps.includes(config.salon.phone), config.salon.phone);

    // >>> NI LE NOM NI LE TELEPHONE NE SONT ECRITS EN DUR. <<< Ils viennent
    // des reglages : c'est la seule raison pour laquelle cette page passe par
    // le serveur plutot que d'etre un fichier statique.
    const reglages = await prisma.settings.findUnique({ where: { id: 1 } });
    verifie('les deux viennent bien de la base',
      reglages.businessName === config.salon.name && reglages.phone === config.salon.phone,
      { nom: reglages.businessName, tel: reglages.phone });

    verifie('une page d\'erreur ne s\'indexe pas', r.robots.includes('noindex'), r.robots);
  }

  // --- 2. Un programme recoit du JSON --------------------------------------
  console.log('\n2. Ce que recoit un programme');
  {
    const r = await demander(INCONNUE, 'application/json');

    verifie('le code est bien 404', r.status === 404, r.status);
    verifie('la reponse est du JSON', r.type.includes('application/json'), r.type);
    verifie('le message est celui des autres 404',
      JSON.parse(r.corps).error === 'Adresse inconnue.', r.corps);
    verifie('aucun HTML ne s\'y glisse', !r.corps.includes('<html'), '');
  }
  {
    // Sans en-tete `Accept` du tout (curl, un moniteur, un script) : du JSON.
    const r = await demander(INCONNUE, '');
    verifie('sans en-tete Accept, c\'est du JSON', r.type.includes('application/json'), r.type);
    verifie('et toujours 404', r.status === 404, r.status);
  }

  // --- 3. Les adresses en /api/ n'ont pas change ---------------------------
  console.log('\n3. Les adresses en /api/');
  {
    // Elles repondaient deja proprement : ce test verrouille l'existant. Le
    // piege serait qu'un gestionnaire pose trop bas leur serve la page HTML.
    const r = await demander('/api/adresse-inconnue', 'text/html');

    verifie('une adresse d\'API inconnue reste du JSON',
      r.type.includes('application/json'), r.type);
    verifie('meme quand le client demande du HTML',
      !r.corps.includes('<html'), r.corps.slice(0, 80));
    verifie('et son code est 404', r.status === 404, r.status);
  }

  // --- 4. Ce qui existe n'est pas emporte ----------------------------------
  //
  // Un gestionnaire terminal pose trop haut repondrait a la place d'une photo,
  // d'une police ou du plan du site. Trois adresses temoins suffisent a le
  // dire.
  console.log('\n4. Ce qui existe repond toujours');
  for (const [chemin, attendu] of [['/', 200], ['/annuler', 200], ['/robots.txt', 200], ['/api/health', 200]]) {
    const r = await demander(chemin, 'text/html');
    verifie(`${chemin} repond ${attendu}`, r.status === attendu, r.status);
  }

  code = bilan();
} finally {
  await prisma.$disconnect();
}

process.exitCode = code;
