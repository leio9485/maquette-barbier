// ---------------------------------------------------------------------------
// TESTS DE LA SEPARATION VITRINE / ESPACE COMMERCANT (lot 4)
//
//     npm start           (terminal 1, laisse ouvert)
//     npm run test:espace (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE. Le balisage, le style et le JavaScript de
// l'espace commercant partaient dans la meme page que la vitrine, chez chaque
// visiteur : 58 154 octets sur 164 244, soit 35 % du poids d'une page de
// barbier. Ils ont leur propre document depuis le lot 4.
//
// Une regression y serait INVISIBLE — le site marcherait exactement pareil, il
// serait seulement redevenu lourd. C'est le genre de chose qu'on ne remarque
// que six mois plus tard, sur le rapport Lighthouse d'un prospect. D'ou une
// suite qui compte les octets et cherche les chaines mot pour mot.
// ---------------------------------------------------------------------------

import { creerClient, creerVerificateur, BASE } from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();
const visiteur = creerClient();

/** Le poids au-dela duquel on considere que l'admin est revenu dans la vitrine. */
const PLAFOND_VITRINE = 130 * 1024;

const page = async (chemin) => {
  const reponse = await fetch(BASE + chemin);
  return { statut: reponse.status, entetes: reponse.headers, html: await reponse.text() };
};

const vitrine = await page('/');
const espace = await page('/espace-salon');
const annuler = await page('/annuler');

console.log(`Vitrine      : ${vitrine.html.length} octets`);
console.log(`Espace       : ${espace.html.length} octets`);
console.log(`Annulation   : ${annuler.html.length} octets\n`);

// --- 1. Les trois documents existent ---------------------------------------
console.log('1. Les trois documents');
{
  verifie('la vitrine repond', vitrine.statut === 200, vitrine.statut);
  verifie('/espace-salon repond 200', espace.statut === 200, espace.statut);
  verifie('/annuler repond 200', annuler.statut === 200, annuler.statut);

  verifie('/espace-salon affiche la connexion',
    espace.html.includes('id="formulaireConnexion"'), 'formulaire absent');
  verifie('ce sont bien trois documents distincts',
    vitrine.html !== espace.html && espace.html !== annuler.html, 'documents identiques');
}

// --- 2. La vitrine ne contient plus une ligne d'administration -------------
//
// >>> LE CRITERE D'ACCEPTATION DU LOT 4, MOT POUR MOT : « un curl sur / ne
//     contient aucune chaine de l'interface d'administration ». <<<
console.log('\n2. La vitrine est purgee');
{
  const INTERDITS = [
    // Le balisage
    'vueEspace', 'ecranConnexion', 'ecranEspace', 'espace-barre', 'espace-onglet',
    'formulaireConnexion', 'connexionMotDePasse', 'demo-bandeau', 'surimpressionRdv',
    'surimpressionBlocage', 'formulaireBlocage', 'reglages-bloc', 'champsCoordonnees',
    'brouillon',
    // Le JavaScript
    'chargerAgenda', 'brancherReglages', 'brancherCompte', 'chargerChiffres',
    'peindreAgenda', 'remettreDemoAZero', 'seConnecter', 'enregistrerReglages',
    // Le style
    'agenda-ligne', 'agenda-pointage', 'agenda-absences', 'chiffres-bloc',
    'connexion-boite', 'reglages-grille',
    // Les adresses reservees au commercant
    '/api/admin/settings', '/api/admin/bookings', '/api/admin/chiffres',
  ];

  const restants = INTERDITS.filter((mot) => vitrine.html.includes(mot));
  verifie('aucune chaine de l\'interface d\'administration ne subsiste',
    restants.length === 0, restants);
}
{
  verifie('la vitrine pese moins que le plafond fixe',
    vitrine.html.length < PLAFOND_VITRINE,
    `${vitrine.html.length} octets, plafond ${PLAFOND_VITRINE}`);
  verifie('elle est plus legere que l\'espace n\'est lourd',
    vitrine.html.length < 164244, `${vitrine.html.length} contre 164244 avant le lot 4`);
}

// --- 3. L'espace ne contient plus la vitrine -------------------------------
//
// La reciproque compte autant : servir la vitrine entiere a un commercant qui
// ouvre son agenda vingt fois par jour serait le meme gaspillage, dans l'autre
// sens.
console.log('\n3. L\'espace est purge lui aussi');
{
  // ⚠️ DES CHAINES STRUCTURELLES, PAS DES MOTS. Ce test cherchait « accueil »
  //    et trouvait « Photo d'accueil » — l'intitule du choix de photo dans les
  //    reglages, qui est parfaitement a sa place ici. Un test qui crie pour un
  //    libelle finit par etre desactive.
  const INTERDITS = [
    'id="vueSite"', 'id="bandeau"', 'id="tunnelFrise"', 'id="calendrierGrille"',
    'galerie-case', 'id="equipeListe"', 'id="accueil"', 'peindreVitrine',
    'RESERVATION',
  ];

  // `poserReservation` et les autres appels publics restent : ils vivent dans
  // js/03-donnees.js, que les deux documents chargent pour `api()` et
  // `lireConfig()`. Un kilo-octet de fonctions inutilisees contre un troisieme
  // fichier de donnees a maintenir — le partage est le bon compromis, et il
  // est ecrit ici pour qu'on ne le redecouvre pas comme un oubli.
  const restants = INTERDITS.filter((mot) => espace.html.includes(mot));
  verifie('la vitrine ne voyage pas dans l\'espace', restants.length === 0, restants);
}

// --- 4. Les moteurs de recherche -------------------------------------------
console.log('\n4. Ce que voient les moteurs');
{
  verifie('/espace-salon porte X-Robots-Tag: noindex',
    (espace.entetes.get('x-robots-tag') ?? '').includes('noindex'),
    espace.entetes.get('x-robots-tag'));
  verifie('et une balise robots dans la page',
    espace.html.includes('name="robots"') && espace.html.includes('noindex'), 'balise absente');

  // ⚠️ L'EN-TETE NE DEPEND PAS DE DEMO_MODE, contrairement a celui de la
  //    vitrine de demonstration : l'agenda d'un vrai client n'a pas plus a
  //    figurer dans Google. Cette suite tourne sans DEMO_MODE, donc la vitrine
  //    n'a PAS d'en-tete — et l'espace, si.
  verifie('la vitrine, elle, reste indexable',
    vitrine.entetes.get('x-robots-tag') === null, vitrine.entetes.get('x-robots-tag'));
}
{
  const robots = await fetch(BASE + '/robots.txt').then((r) => r.text());
  verifie('robots.txt ecarte l\'espace', robots.includes('Disallow: /espace-salon'), robots);
}

// --- 5. Le lien public -----------------------------------------------------
//
// Il n'existe que sur la demonstration. Cette suite tourne SANS `DEMO_MODE` —
// c'est une condition de tout le projet — donc il ne doit pas etre la.
console.log('\n5. L\'entree de l\'espace');
{
  verifie('le lien « Espace commerçant » est absent de la vitrine d\'un client',
    !vitrine.html.includes('Espace commerçant'), 'lien present');
  verifie('il est RETIRE du document, pas seulement masque',
    !vitrine.html.includes('lienEspace'), 'balise presente mais cachee');
  verifie('la route reste accessible a qui connait l\'adresse', espace.statut === 200, espace.statut);
}

// --- 6. Rien n'est casse cote session --------------------------------------
console.log('\n6. La session');
{
  const r = await visiteur.appel('GET', '/api/admin/me');
  verifie('sans session, l\'API reste fermee', r.status === 401, r.status);
}
{
  // Le cookie de session ne porte pas de chemin restreint : une session ouverte
  // depuis /espace-salon vaut pour /api/… comme avant le decoupage.
  const r = await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'inconnu-de-ce-test', password: 'peu-importe' }),
  });
  const cookies = r.headers.getSetCookie?.() ?? [];
  verifie('un echec de connexion ne pose aucun cookie', cookies.length === 0, cookies);
}

process.exitCode = bilan() === 0 ? 0 : 1;
