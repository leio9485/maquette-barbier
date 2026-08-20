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

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { creerClient, creerVerificateur, BASE } from './helpers.mjs';
import { ROOT_DIR } from '../src/config.js';

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

// --- 7. LE GARDE-FOU SUR LA NOTE GOOGLE (lot F, point F1) -----------------
//
// La vitrine affiche « 4,8/5 · 87 avis Google ». Sur une demonstration c'est
// legitime — les mentions legales disent que le commerce est fictif — mais un
// client qui reprend le gabarit sans avoir la fiche correspondante est en
// infraction (article L111-7-2 du code de la consommation, controles DGCCRF
// sur les avis en ligne).
//
// ⚠️ ET LES DEUX CHAMPS N'EXISTAIENT PAS DANS L'ECRAN. La note et le nombre ne
//    se reglaient que par un appel direct a l'API : le commercant ne pouvait
//    donc NI les corriger, NI — c'est le point — les remettre a zero.
console.log('\n7. La note Google');
{
  // ⚠️ LES CHAMPS SONT PEINTS PAR LE JAVASCRIPT, comme tout le formulaire des
  //    reglages : ce qui voyage dans le document, c'est l'appel qui les
  //    fabrique. C'est aussi ce qu'on veut verifier — que le chemin existe et
  //    qu'il est le bon.
  verifie("la note se regle depuis l'ecran",
    espace.html.includes("'reviews.rating'"), 'champ absent');
  verifie("le nombre d'avis aussi",
    espace.html.includes("'reviews.count'"), 'champ absent');
  verifie('leur conteneur existe dans le balisage',
    espace.html.includes('id="champsNoteGoogle"'), 'conteneur absent');

  // ⚠️ ON CHERCHE UNE PHRASE D'UNE SEULE LIGNE. Le balisage servi garde ses
  //    retours a la ligne : « une pratique commerciale trompeuse » est coupee
  //    en deux dans le fichier, et la chercher entiere echouerait alors que le
  //    texte est bien la.
  verifie('>>> L\'AVERTISSEMENT EST DANS LE DOCUMENT SERVI <<<',
    espace.html.includes('Ces chiffres doivent provenir de votre fiche Google'),
    'avertissement absent');
  verifie("il dit quoi faire quand on n'a pas de fiche",
    espace.html.includes("Laissez à zéro tant que vous n'avez pas"), 'consigne absente');

  // Il est AU-DESSUS des champs : le commercant doit le lire avant de taper.
  const posAvertissement = espace.html.indexOf('Ces chiffres doivent provenir');
  const posChamps = espace.html.indexOf('id="champsNoteGoogle"');
  verifie('et il vient avant les champs, pas apres',
    posAvertissement > 0 && posChamps > posAvertissement, [posAvertissement, posChamps]);

  // Le second avertissement — une note sans lien de fiche — est ecrit par le
  // JavaScript, qui voyage dans ce meme document.
  verifie('une note sans lien vers la fiche est signalee',
    espace.html.includes('aucun moyen de la vérifier'), 'alerte absente');
}

// --- LES NUMEROS DE TELEPHONE DANS L'AGENDA ---------------------------------
//
// >>> UN ECRAN D'AGENDA EST SOUVENT VISIBLE DEPUIS LA SALLE. <<< Trente numeros
// complets s'affichaient en clair sur chaque ligne. Ils sont desormais masques
// par defaut, et se revelent au clic.
//
// ⚠️ CE COMPORTEMENT VIT DANS LE NAVIGATEUR, et une suite qui ne parlerait
//    qu'au serveur ne le verrait jamais : le numero part dans la reponse comme
//    avant, et c'est l'ecran qui choisit de l'ecrire ou non. On evalue donc LE
//    VRAI MORCEAU de la page, comme tests/ics.mjs et tests/annulation.mjs le
//    font deja. Le code du site n'est pas modifie d'un caractere.
console.log('\nLes numeros de telephone dans l\'agenda');
{
  // LES DEUX MORCEAUX, RECOLLES COMME LA PAGE LES RECOLLE. `masquerLesTelephones()`
  // vit dans js/espace/etat.js avec l'etat de l'espace, `telephoneDeLaLigne()`
  // dans js/09-agenda.js : les separer ici ferait tester une moitie.
  const morceaux = await Promise.all(
    ['js/espace/etat.js', 'js/09-agenda.js'].map((f) =>
      readFile(path.join(ROOT_DIR, 'src', 'page', f), 'utf8')));
  const source = morceaux.join('\n');

  // ⚠️ `window` EST INDISPENSABLE, ET C'EST LA SEULE CHOSE QUE CE CODE REGARDE
  //    AVANT D'ETRE APPELE : `const ECRAN_LARGE = window.matchMedia(…)`
  //    s'evalue a la lecture du morceau (c'est lui qui decide des colonnes par
  //    personne). Un faux qui ne repond rien suffit — ni `telephoneDeLaLigne()`
  //    ni `masquerLesTelephones()` ne s'en servent.
  const fenetre = { matchMedia: () => ({ matches: false, addEventListener() {} }) };

  const echapper = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const creerTiroir = (valeur) => ({ getItem: () => valeur, setItem: () => {} });

  const usine = new Function('localStorage', 'esc', 'window',
    `${source}\nreturn { telephoneDeLaLigne, masquerLesTelephones, ESPACE };`);

  const RDV = { id: 'rdv-1', phone: '06 39 98 14 07' };

  // 1. PAR DEFAUT, RIEN N'EST ECRIT DANS LE TIROIR — et c'est masque. C'est le
  //    sens que doit avoir un defaut sur une donnee personnelle : celui qui n'a
  //    rien decide est protege, celui qui veut ses numeros fait un geste.
  const parDefaut = usine(creerTiroir(null), echapper, fenetre);
  const masque = parDefaut.telephoneDeLaLigne(RDV);

  verifie('>>> MASQUE PAR DEFAUT, SANS RIEN AVOIR A REGLER <<<',
    parDefaut.masquerLesTelephones() === true, parDefaut.masquerLesTelephones());
  verifie('le numero complet n\'est pas ecrit', !masque.includes('06 39 98 14 07'), masque);
  verifie('les quatre derniers chiffres restent', masque.includes('14 07'), masque);
  verifie('et il s\'annonce comme un bouton',
    masque.includes('role="button"') && masque.includes('aria-label='), masque);

  // ⚠️ LES QUATRE DERNIERS CHIFFRES NE SONT PAS UN COMPROMIS MOU : ce sont eux
  //    qui servent a reconnaitre un client au telephone, et c'est deja le
  //    second facteur de /annuler.
  verifie('l\'etiquette les dit a voix haute', /finit par 1 4 0 7/.test(masque), masque);

  // 2. UN TIROIR QUI DIT « visibles » : le numero entier.
  const visible = usine(creerTiroir('visibles'), echapper, fenetre);
  verifie('le reglage decoche rend le numero entier',
    visible.telephoneDeLaLigne(RDV).includes('06 39 98 14 07'),
    visible.telephoneDeLaLigne(RDV));

  // 3. UN NUMERO REVELE A LA MAIN, masquage toujours actif.
  const revele = usine(creerTiroir(null), echapper, fenetre);
  revele.ESPACE.telephonesReveles.add('rdv-1');
  verifie('un numero revele au clic s\'affiche entier',
    revele.telephoneDeLaLigne(RDV).includes('06 39 98 14 07'),
    revele.telephoneDeLaLigne(RDV));
  verifie('et celui d\'a cote reste masque',
    !revele.telephoneDeLaLigne({ id: 'rdv-2', phone: '06 39 98 55 44' })
      .includes('06 39 98 55 44'), '');

  // 4. LE TIROIR PEUT REFUSER (navigation privee) : on masque quand meme.
  const refuse = usine({
    getItem() { throw new Error('stockage refuse'); },
    setItem() { throw new Error('stockage refuse'); },
  }, echapper, fenetre);
  verifie('>>> UN STOCKAGE REFUSE MASQUE, IL NE DECOUVRE PAS <<<',
    refuse.masquerLesTelephones() === true, refuse.masquerLesTelephones());

  // 5. SANS NUMERO, RIEN — ni masque, ni cadre vide.
  verifie('un rendez-vous sans numero n\'ecrit rien',
    parDefaut.telephoneDeLaLigne({ id: 'rdv-3', phone: '' }) === '', '');
}

// >>> ET LE NUMERO RESTE ENTIER LA OU IL SERT. <<< Le masquage est une affaire
//     d'ecran, pas de donnee : ce que le serveur envoie n'a pas change, la
//     fiche du rendez-vous l'ecrit en entier, et les exports aussi
//     (tests/export.mjs). L'ecran de l'espace porte donc encore les deux
//     libelles qui le prouvent.
{
  const espace = await page('/espace-salon');
  verifie('la fiche d\'un rendez-vous garde son intitule « Téléphone »',
    espace.html.includes("'Téléphone'"), 'intitule absent');
  verifie('et l\'intitule dit que le numero reste entier ailleurs',
    espace.html.includes('dans la fiche du rendez-vous et dans les exports'),
    'mention absente');
}

process.exitCode = bilan() === 0 ? 0 : 1;
