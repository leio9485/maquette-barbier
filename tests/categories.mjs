// ---------------------------------------------------------------------------
// LES RAYONS DU CATALOGUE
//
// Un salon qui propose vingt-six prestations ne peut pas les presenter en une
// seule liste. Elles se rangent donc par categorie — et TOUTE LA DIFFICULTE est
// que le salon qui en propose trois ne doit rien y perdre.
//
// D'ou la regle que cette suite verifie d'un bout a l'autre :
//
//   AUCUNE CATEGORIE = LE COMPORTEMENT D'ORIGINE, AU CARACTERE PRES.
//
// Le reste decoule d'un principe unique : une categorie ne fait que RANGER.
// Elle ne porte ni tarif, ni duree, ni disponibilite, et la supprimer ne peut
// jamais faire disparaitre une prestation — encore moins un rendez-vous.
//
// La suite laisse la base exactement dans l'etat ou elle l'a trouvee : les
// autres suites verifient le catalogue d'origine et doivent continuer de le
// faire.
// ---------------------------------------------------------------------------

import {
  BASE, creerClient, creerVerificateur, clientConnecte, supprimerCompteDeTest, sectionServie,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();
const copie = (o) => JSON.parse(JSON.stringify(o));

const visiteur = creerClient();
const salon = await clientConnecte();

const depart = await salon.appel('GET', '/api/admin/settings');
if (depart.status !== 200) {
  console.error('Impossible de lire les reglages :', depart);
  process.exit(1);
}
const ORIGINE = copie(depart.donnees);

/** Remet les reglages de depart, quoi qu'il arrive. */
function restaurer() {
  return salon.appel('PUT', '/api/admin/settings', { ...ORIGINE, confirmRemovals: true });
}

try {
  // --- 1. Le catalogue d'origine ------------------------------------------
  console.log('\n1. Le catalogue tel qu\'il est livre');
  {
    const publique = await visiteur.appel('GET', '/api/config');
    verifie('le site recoit la liste des categories',
      Array.isArray(publique.donnees.categories), publique.donnees.categories);
    verifie('chaque prestation annonce son rayon',
      publique.donnees.services.every((s) => typeof s.category === 'string'),
      publique.donnees.services[0]);

    // Le lien doit toujours pouvoir etre resolu : une prestation qui designe un
    // rayon absent de la reponse ferait ecrire au site un titre introuvable.
    const rayons = new Set(publique.donnees.categories.map((c) => c.id));
    verifie('aucune prestation ne designe un rayon inconnu',
      publique.donnees.services.every((s) => !s.category || rayons.has(s.category)),
      publique.donnees.services.filter((s) => s.category && !rayons.has(s.category)));
  }

  // --- 2. Creer, ranger, ordonner -----------------------------------------
  console.log('\n2. Creer un rayon et y ranger une prestation');
  {
    const brouillon = copie(ORIGINE);
    brouillon.categories = [
      { id: 'cat-test-a', name: 'Rayon A de test', desc: 'Une phrase d\'introduction.' },
      { id: 'cat-test-b', name: 'Rayon B de test', desc: '' },
    ];
    brouillon.services = brouillon.services.map((s) => ({ ...s, category: '' }));
    brouillon.services.find((s) => s.id === 'coupe-barbe').category = 'cat-test-a';
    brouillon.services.find((s) => s.id === 'coupe-rasage').category = 'cat-test-b';

    const r = await salon.appel('PUT', '/api/admin/settings', { ...brouillon, confirmRemovals: true });
    verifie('l\'enregistrement aboutit', r.status === 200, r.donnees);
    verifie('les deux rayons sont revenus', r.donnees?.categories?.length === 2,
      r.donnees?.categories?.map((c) => c.name));
    verifie('la phrase d\'introduction est conservee',
      r.donnees?.categories?.[0]?.desc === 'Une phrase d\'introduction.',
      r.donnees?.categories?.[0]);
    verifie('la coupe est rangee dans le rayon A',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe')?.category === 'cat-test-a');
    verifie('les autres restent sans rayon',
      r.donnees?.services?.find((s) => s.id === 'soin-visage')?.category === '');
  }
  {
    // L'ordre du tableau recu est celui affiche sur le site : on l'inverse.
    const lu = await salon.appel('GET', '/api/admin/settings');
    const brouillon = copie(lu.donnees);
    brouillon.categories.reverse();

    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('l\'ordre des rayons est celui envoye',
      r.donnees?.categories?.[0]?.id === 'cat-test-b', r.donnees?.categories?.map((c) => c.id));
  }

  // --- 3. Ce qu'une categorie ne fait PAS ---------------------------------
  //
  // Elle range, et rien d'autre. Le tarif, la duree et les disponibilites ne
  // la connaissent pas : c'est ce qui permet de reorganiser son catalogue sans
  // toucher a ce qui a ete annonce aux clientes.
  console.log('\n3. Ranger ne change ni le tarif ni les creneaux');
  {
    const publique = await visiteur.appel('GET', '/api/config');
    const coupe = publique.donnees.services.find((s) => s.id === 'coupe-barbe');
    const origine = ORIGINE.services.find((s) => s.id === 'coupe-barbe');

    verifie('le tarif n\'a pas bouge', coupe.price === origine.price, coupe.price);
    verifie('la duree non plus', coupe.duration === origine.duration, coupe.duration);
  }

  // --- 4. Supprimer un rayon ----------------------------------------------
  //
  // Le point le plus important de la suite. Supprimer une categorie ne doit
  // jamais faire disparaitre une prestation : elles retombent en « Sans
  // categorie », exactement comme un rendez-vous survit a la prestation qui le
  // portait. Aucune confirmation n'est donc demandee — rien n'est perdu.
  console.log('\n4. Supprimer un rayon ne supprime aucune prestation');
  {
    const lu = await salon.appel('GET', '/api/admin/settings');
    const avant = lu.donnees.services.length;

    const brouillon = copie(lu.donnees);
    brouillon.categories = brouillon.categories.filter((c) => c.id !== 'cat-test-a');

    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('la suppression aboutit sans confirmation', r.status === 200, r.donnees);
    verifie('aucune prestation n\'a disparu', r.donnees?.services?.length === avant,
      r.donnees?.services?.length);
    verifie('la coupe est toujours la',
      Boolean(r.donnees?.services?.find((s) => s.id === 'coupe-barbe')));
    verifie('elle est repassee en « Sans categorie »',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe')?.category === '',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe'));
    verifie('elle reste reservable en ligne',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe')?.active === true);
  }

  // --- 5. Ce que le serveur refuse ou corrige -----------------------------
  console.log('\n5. Controles a l\'enregistrement');
  {
    const lu = await salon.appel('GET', '/api/admin/settings');

    const sansNom = copie(lu.donnees);
    sansNom.categories = [{ id: 'cat-vide', name: '', desc: '' }];
    const r1 = await salon.appel('PUT', '/api/admin/settings', sansNom);
    verifie('une categorie sans nom est refusee', r1.status === 400, r1.donnees);

    const doublon = copie(lu.donnees);
    doublon.categories = [
      { id: 'cat-x', name: 'Couleur', desc: '' },
      { id: 'cat-y', name: 'couleur', desc: '' },   // meme nom, casse differente
    ];
    const r2 = await salon.appel('PUT', '/api/admin/settings', doublon);
    verifie('deux rayons de meme nom sont refuses', r2.status === 400, r2.donnees);

    const memeId = copie(lu.donnees);
    memeId.categories = [
      { id: 'cat-z', name: 'Un', desc: '' },
      { id: 'cat-z', name: 'Deux', desc: '' },
    ];
    const r3 = await salon.appel('PUT', '/api/admin/settings', memeId);
    verifie('deux rayons de meme identifiant sont refuses', r3.status === 400, r3.donnees);
  }
  {
    // Un lien vers un rayon qui n'existe pas ne doit pas faire echouer tout
    // l'enregistrement : il est simplement oublie, comme les liens de l'equipe.
    const lu = await salon.appel('GET', '/api/admin/settings');
    const brouillon = copie(lu.donnees);
    brouillon.categories = [{ id: 'cat-test-c', name: 'Rayon C de test', desc: '' }];
    brouillon.services = brouillon.services.map((s) => ({ ...s, category: '' }));
    brouillon.services.find((s) => s.id === 'coupe-barbe').category = 'cat-inventee';

    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('un rayon inconnu est ignore, pas refuse', r.status === 200, r.donnees);
    verifie('la prestation retombe sans rayon',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe')?.category === '',
      r.donnees?.services?.find((s) => s.id === 'coupe-barbe'));
  }
  {
    // Un rayon vide est permis : c'est celui qu'on vient de creer et qu'on
    // s'apprete a remplir. Le site se contente de ne pas l'afficher.
    const lu = await salon.appel('GET', '/api/admin/settings');
    verifie('un rayon sans aucune prestation est accepte',
      lu.donnees.categories.length === 1 &&
      !lu.donnees.services.some((s) => s.category === 'cat-test-c'),
      lu.donnees.categories);
  }

  // --- 6. Ce que voit un assistant ----------------------------------------
  console.log('\n6. /llms.txt suit le rangement');
  {
    const lu = await salon.appel('GET', '/api/admin/settings');
    const brouillon = copie(lu.donnees);
    brouillon.categories = [{ id: 'cat-test-d', name: 'Rayon D de test', desc: '' }];
    brouillon.services = brouillon.services.map((s) => ({ ...s, category: '' }));
    brouillon.services.find((s) => s.id === 'coupe-barbe').category = 'cat-test-d';
    await salon.appel('PUT', '/api/admin/settings', brouillon);

    const texte = await (await fetch(BASE + '/llms.txt')).text();
    verifie('le rayon apparait comme un titre', texte.includes('### Rayon D de test'), null);
    verifie('les prestations sans rayon sont regroupees a part',
      texte.includes('### Autres prestations'), null);
    verifie('les tarifs y figurent toujours', /Coupe \+ barbe.*28 €/.test(texte), null);
  }

  // --- 7. Retour a un catalogue sans aucun rayon --------------------------
  //
  // Le filet de non-regression : une fois les categories retirees, tout doit se
  // comporter comme avant qu'elles n'existent.
  console.log('\n7. Sans aucune categorie, le comportement d\'origine');
  {
    const lu = await salon.appel('GET', '/api/admin/settings');
    const brouillon = copie(lu.donnees);
    brouillon.categories = [];

    const r = await salon.appel('PUT', '/api/admin/settings', brouillon);
    verifie('l\'enregistrement aboutit', r.status === 200, r.donnees);
    verifie('plus aucun rayon', r.donnees?.categories?.length === 0, r.donnees?.categories);
    verifie('toutes les prestations sont la',
      r.donnees?.services?.length === ORIGINE.services.length, r.donnees?.services?.length);

    const publique = await visiteur.appel('GET', '/api/config');
    verifie('le site recoit une liste de rayons vide',
      Array.isArray(publique.donnees.categories) && publique.donnees.categories.length === 0,
      publique.donnees.categories);

    const texte = await (await fetch(BASE + '/llms.txt')).text();
    verifie('/llms.txt repasse a une liste plate',
      texte.includes('## Prestations') && !texte.includes('###'), null);

    const page = await (await fetch(BASE + '/')).text();
    verifie('le catalogue structure est pose a plat dans le <head>',
      page.includes('"hasOfferCatalog"') && !page.includes('Rayon D de test'), null);

    // LA SECTION NE CHANGE PAS DE FORME, et c'est le point de ce bloc.
    //
    // Le site d'origine basculait ici sur une grille de cartes : deux affichages
    // a maintenir, deux comportements a eprouver, et un catalogue qui changeait
    // d'allure selon un reglage que le visiteur ne voit pas.
    //
    // Ici, la liste tarifaire est la seule forme. Sans rayon, elle perd
    // simplement ses titres intermediaires — les lignes, elles, sont les memes.
    // C'est moins de code, et un visiteur qui revient apres que le commercant a
    // range son catalogue retrouve la page qu'il connaissait.
    //
    // On regarde la SECTION, pas la page : le JavaScript du site contient les
    // memes chaines et ferait passer n'importe quoi (voir sectionServie).
    const section = sectionServie(page);
    verifie('la liste tarifaire reste la seule forme',
      section.includes('class="tarif-liste"') && !section.includes('service-card'),
      section.slice(0, 200));
    verifie('elle n\'a plus de titre de rayon',
      !section.includes('tarif-rayon-titre'),
      section.match(/<h3[^>]*>[^<]*<\/h3>/)?.[0]);
    verifie('un seul groupe, sans intitule',
      (section.match(/class="tarif-rayon"/g) ?? []).length === 1,
      (section.match(/class="tarif-rayon"/g) ?? []).length);
    verifie('et toutes les prestations y sont',
      (section.match(/class="tarif-ligne"/g) ?? []).length === ORIGINE.services.length,
      (section.match(/class="tarif-ligne"/g) ?? []).length);
  }

  // --- 8. Remise en etat ---------------------------------------------------
  {
    const r = await restaurer();
    console.log(`\n(reglages restaures : ${r.status === 200 ? 'ok' : 'ECHEC ' + JSON.stringify(r.donnees)})`);

    const verif = await salon.appel('GET', '/api/admin/settings');
    verifie('le catalogue d\'origine est revenu, rayons compris',
      verif.donnees?.categories?.length === ORIGINE.categories.length &&
      verif.donnees?.services?.length === ORIGINE.services.length,
      { categories: verif.donnees?.categories?.length, services: verif.donnees?.services?.length });
  }
} finally {
  await restaurer();
  await supprimerCompteDeTest();
}

process.exit(bilan() > 0 ? 1 : 0);
