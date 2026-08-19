// ---------------------------------------------------------------------------
// TESTS DES PERSONNES AUTORISEES
//
//     npm start            (terminal 1, laisse ouvert)
//     npm run test:comptes (terminal 2)
//
// >>> CE QUE CETTE SUITE PROTEGE. <<<
//
// La base acceptait plusieurs comptes depuis le premier jour (`username` est
// unique), mais la seule facon d'en creer un etait `npm run admin:create`, en
// ligne de commande, sur le serveur — que le commercant n'a pas. Un salon de
// trois personnes se retrouvait donc avec UN mot de passe partage, ecrit pres
// de la caisse :
//
//   - aucune tracabilite : personne ne sait qui a supprime le rendez-vous ;
//   - couper l'acces de quelqu'un qui part obligeait a changer LE mot de passe,
//     donc a deconnecter tout le monde et a le redistribuer ;
//   - un ancien employe gardait l'entree de tout le fichier client.
//
// ⚠️ LES DEUX GARDE-FOUS SONT LE COEUR DE CETTE SUITE. Revoquer le dernier
//    compte fermerait l'espace pour tout le monde, et il ne se rouvrirait qu'en
//    ligne de commande sur le serveur. Se revoquer soi-meme est toujours un
//    accident. Les deux se testent ici parce qu'aucun des deux ne se rattrape.
//
// ⚠️ LA REVOCATION NE FERME QUE LES SESSIONS DU COMPTE VISE. C'est la section 5,
//    et c'est la difference avec le changement de mot de passe, qui les ferme
//    toutes. Un test verifie donc qu'un TIERS reste connecte pendant qu'un autre
//    est coupe — sans quoi « revoquer Karim » deconnecterait le salon entier,
//    exactement ce que la fonction existe pour eviter.
// ---------------------------------------------------------------------------

import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
} from './helpers.mjs';

import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/passwords.js';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

/**
 * Un suffixe tire au hasard a chaque execution.
 *
 * ⚠️ MEME RAISON QUE POUR LES REFERENCES DE tests/annulation.mjs : un
 *    identifiant fige laisserait, apres une execution interrompue avant son
 *    menage, un compte du meme nom en base — et la creation suivante
 *    repondrait 409 « deja pris » sur un test qui verifie qu'elle reussit.
 */
const SUFFIXE = Math.random().toString(36).slice(2, 8);
const KARIM = `karim-${SUFFIXE}`;
const LEA = `lea-${SUFFIXE}`;
const MOT_DE_PASSE = 'mot-de-passe-de-test-jetable-2743';

/** Les comptes crees ici, effaces a la fin quoi qu'il arrive. */
const aNettoyer = [KARIM, LEA];

/** Un client connecte sous un compte precis. */
async function connecteSous(identifiant, motDePasse = MOT_DE_PASSE) {
  const client = creerClient();
  const r = await client.appel('POST', '/api/admin/login',
    { username: identifiant, password: motDePasse });
  return { client, status: r.status };
}

console.log(`Comptes de test : ${KARIM}, ${LEA}\n`);

try {
  // --- 1. La liste ----------------------------------------------------------
  console.log('1. Qui a le droit d\'entrer');
  {
    const r = await salon.appel('GET', '/api/admin/users');
    verifie('la liste est renvoyee', r.status === 200 && Array.isArray(r.donnees?.users), r.donnees);

    const moi = r.donnees.users.find((u) => u.isSelf);
    verifie('le compte de la session en cours se reconnait', Boolean(moi), r.donnees.users);

    // >>> AUCUNE EMPREINTE DE MOT DE PASSE NE SORT. <<< Elle ne se casse pas en
    //     une soiree, mais elle n'a rien a faire dans une reponse HTTP : la
    //     sortir, c'est offrir a qui lit la page de quoi travailler hors ligne.
    const champs = Object.keys(r.donnees.users[0] ?? {});
    verifie('la reponse ne porte aucune empreinte de mot de passe',
      !champs.some((c) => /password|hash/i.test(c)), champs);

    const visiteurTente = await visiteur.appel('GET', '/api/admin/users');
    verifie('un visiteur non connecte ne voit pas la liste',
      visiteurTente.status === 401, visiteurTente.status);
  }

  // --- 2. Creer un acces ----------------------------------------------------
  console.log('\n2. Ajouter un acces');
  {
    const cree = await salon.appel('POST', '/api/admin/users',
      { username: KARIM, password: MOT_DE_PASSE });

    verifie('l\'acces est cree', cree.status === 201, cree.donnees);
    verifie('la reponse porte l\'identifiant', cree.donnees?.username === KARIM, cree.donnees);
    verifie('et pas l\'empreinte du mot de passe',
      !Object.keys(cree.donnees ?? {}).some((c) => /password|hash/i.test(c)),
      Object.keys(cree.donnees ?? {}));

    // >>> IL SERT VRAIMENT. <<< Un compte cree qui ne permet pas d'entrer est
    //     un compte cree pour rien, et c'est la seule verification qui le dit.
    const { status } = await connecteSous(KARIM);
    verifie('le nouveau compte permet de se connecter', status === 200, status);

    const doublon = await salon.appel('POST', '/api/admin/users',
      { username: KARIM, password: MOT_DE_PASSE });
    verifie('le meme identifiant deux fois est refuse en 409', doublon.status === 409, doublon.status);
    verifie('et le refus le dit en francais',
      /déjà pris/.test(doublon.donnees?.error ?? ''), doublon.donnees?.error);

    const visiteurTente = await visiteur.appel('POST', '/api/admin/users',
      { username: 'intrus', password: MOT_DE_PASSE });
    verifie('un visiteur non connecte ne cree pas d\'acces',
      visiteurTente.status === 401, visiteurTente.status);
  }

  // --- 3. Les saisies refusees ---------------------------------------------
  console.log('\n3. Ce qui ne fait pas un identifiant');
  {
    const cas = [
      ['vide', { username: '   ', password: MOT_DE_PASSE }],
      ['trop court', { username: 'ab', password: MOT_DE_PASSE }],
      ['avec un espace', { username: 'jean pierre', password: MOT_DE_PASSE }],
      ['avec un accent', { username: 'rémi', password: MOT_DE_PASSE }],
    ];

    for (const [nom, corps] of cas) {
      const r = await salon.appel('POST', '/api/admin/users', corps);
      verifie(`un identifiant ${nom} est refuse`, r.status === 400, [r.status, r.donnees?.error]);
    }

    // Le mot de passe passe par le meme controle de robustesse que partout
    // ailleurs : dix caracteres au minimum (src/lib/passwords.js).
    const faible = await salon.appel('POST', '/api/admin/users',
      { username: `court-${SUFFIXE}`, password: '123' });
    verifie('un mot de passe trop court est refuse', faible.status === 400, faible.donnees?.error);

    const apres = await salon.appel('GET', '/api/admin/users');
    verifie('aucun de ces refus n\'a cree de compte',
      !apres.donnees.users.some((u) => u.username.startsWith('court-')),
      apres.donnees.users.map((u) => u.username));
  }

  // --- 4. LES DEUX GARDE-FOUS ----------------------------------------------
  //
  // Aucun des deux ne se rattrape : le premier ferme l'espace pour tout le
  // monde, le second se deconnecte au milieu de son travail.
  console.log('\n4. Les deux garde-fous');
  {
    const liste = await salon.appel('GET', '/api/admin/users');
    const moi = liste.donnees.users.find((u) => u.isSelf);

    const soiMeme = await salon.appel('DELETE', `/api/admin/users/${moi.id}`);
    verifie('>>> ON NE REVOQUE PAS SON PROPRE ACCES <<<', soiMeme.status === 409, soiMeme.status);
    verifie('et le refus propose la sortie qui existe',
      /déconnect/i.test(soiMeme.donnees?.error ?? ''), soiMeme.donnees?.error);

    // Le dernier compte se teste sur une base ou il n'en reste QU'UN : on met
    // donc les autres de cote le temps du controle, puis on les remet. Les
    // supprimer pour de bon effacerait le compte du commercant.
    const tous = await prisma.adminUser.findMany();
    const survivant = tous.find((c) => c.username === KARIM) ?? tous[0];
    const misDeCote = tous.filter((c) => c.id !== survivant.id);

    await prisma.session.deleteMany({ where: { adminUserId: { in: misDeCote.map((c) => c.id) } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: misDeCote.map((c) => c.id) } } });

    const { client: seul } = await connecteSous(survivant.username);

    // Il ne peut pas se revoquer lui-meme (garde-fou 1), donc le garde-fou du
    // dernier compte se constate en creant puis revoquant : c'est le compteur
    // total qui est verifie, et il vaut 1.
    const dernier = await seul.appel('DELETE', `/api/admin/users/${survivant.id}`);
    verifie('>>> ON NE REVOQUE PAS LE DERNIER ACCES <<<', dernier.status === 409, dernier.status);

    const compte = await prisma.adminUser.count();
    verifie('le compte est toujours la apres les deux refus', compte === 1, compte);

    // On remet ceux qu'on avait mis de cote, avec leur empreinte d'origine.
    for (const c of misDeCote) {
      await prisma.adminUser.create({
        data: {
          id: c.id, username: c.username, passwordHash: c.passwordHash,
          role: c.role, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt,
        },
      });
    }
  }

  // --- 5. LA REVOCATION NE COUPE QUE CELUI QU'ON VISE ----------------------
  //
  // >>> C'EST LA DIFFERENCE AVEC LE CHANGEMENT DE MOT DE PASSE. <<< Celui-la
  //     ferme TOUTES les sessions, volontairement. Ici, revoquer Karim ne doit
  //     pas deconnecter Lea ni le patron — sinon la fonction fait exactement ce
  //     qu'elle existe pour eviter.
  console.log('\n5. Revoquer, et seulement lui');
  {
    const patron = await clientConnecte();

    await patron.appel('POST', '/api/admin/users', { username: LEA, password: MOT_DE_PASSE });

    const { client: karim } = await connecteSous(KARIM);
    const { client: lea } = await connecteSous(LEA);

    const avant = await Promise.all([
      karim.appel('GET', '/api/admin/me'),
      lea.appel('GET', '/api/admin/me'),
    ]);
    verifie('les deux sont bien connectes',
      avant.every((r) => r.status === 200), avant.map((r) => r.status));

    const liste = await patron.appel('GET', '/api/admin/users');
    const ligneKarim = liste.donnees.users.find((u) => u.username === KARIM);
    verifie('la liste compte ses appareils ouverts',
      ligneKarim?.openSessions >= 1, ligneKarim?.openSessions);

    const revoque = await patron.appel('DELETE', `/api/admin/users/${ligneKarim.id}`);
    verifie('l\'acces est revoque', revoque.status === 200, revoque.donnees);

    const apresKarim = await karim.appel('GET', '/api/admin/me');
    verifie('>>> SA SESSION EST FERMEE TOUT DE SUITE <<<', apresKarim.status === 401, apresKarim.status);

    const apresLea = await lea.appel('GET', '/api/admin/me');
    verifie('>>> ET CELLE DE QUELQU\'UN D\'AUTRE NE BOUGE PAS <<<',
      apresLea.status === 200, apresLea.status);

    const reconnexion = await connecteSous(KARIM);
    verifie('le compte revoque ne se reconnecte plus', reconnexion.status === 401, reconnexion.status);

    const restant = await patron.appel('GET', '/api/admin/users');
    verifie('il a disparu de la liste',
      !restant.donnees.users.some((u) => u.username === KARIM),
      restant.donnees.users.map((u) => u.username));

    const inconnu = await patron.appel('DELETE', '/api/admin/users/compte-invente');
    verifie('un compte inconnu renvoie 404', inconnu.status === 404, inconnu.status);

    const visiteurTente = await visiteur.appel('DELETE',
      `/api/admin/users/${restant.donnees.users[0].id}`);
    verifie('un visiteur non connecte ne revoque rien',
      visiteurTente.status === 401, visiteurTente.status);
  }

  // --- 5 bis. LE PLAFOND COMPTE LES ECHECS, PAS LES PASSAGES ---------------
  //
  // >>> CE TEST EXISTE PARCE QUE LE DEFAUT A ETE INTRODUIT ICI MEME. <<<
  //
  // Le plafond consommait un jeton a CHAQUE appel, reussi comme rate. Deux
  // consequences, et la seconde est celle qui a mordu :
  //
  //   - un commercant qui enregistre son equipe se serait vu refuser l'acces
  //     a sa propre section, sans avoir rien fait de mal ;
  //   - la suite passait au vert la premiere fois et au ROUGE au SECOND
  //     `npm test` lance dans le quart d'heure, les operations du premier
  //     restant au compteur. Exactement le piege deja connu du depot pour les
  //     references d'annulation (voir CLAUDE.md).
  //
  // `POST /api/admin/login` fait ce qu'il faut depuis toujours : compter dans
  // la seule branche de refus, remettre a zero au succes. Ce test verifie que
  // les routes de gestion des acces s'alignent sur elle.
  //
  // ⚠️ ON NE DECLENCHE PAS LE PLAFOND ICI, ET C'EST DELIBERE. Une fois la
  //    limite atteinte, plus AUCUN appel ne passe — pas meme un appel
  //    legitime, puisque le controle precede l'action. Il n'y a donc aucune
  //    facon de la lever depuis l'API, contrairement a /api/rendez-vous ou un
  //    jeton juste rouvre la porte (tests/annulation.mjs). La declencher
  //    bloquerait l'adresse un quart d'heure et casserait le `npm test`
  //    suivant : c'est-a-dire le defaut meme que cette section protege.
  console.log('\n5 bis. Le plafond ne mord pas sur ce qui reussit');
  {
    // ⚠️ UN CLIENT NEUF, ET PAS `salon`. La section 4 supprime tous les
    //    comptes sauf un pour verifier le garde-fou du dernier acces, puis les
    //    recree — mais une session tombe EN CASCADE avec son compte
    //    (prisma/schema.prisma), et recreer la ligne ne la ressuscite pas.
    //    `salon` est donc deconnecte a partir de la, et tout ce qui suit
    //    repondrait 401. La section 5 s'ouvre deja sur un `patron` neuf pour
    //    cette raison ; celle-ci fait pareil.
    const admin = await clientConnecte();

    const noms = [];
    let refus = null;

    // Vingt-cinq creations d'affilee. Le plafond par adresse est a cinquante :
    // en comptant les passages, DEUX executions de la suite le franchissaient.
    // En ne comptant que les echecs, aucune ne l'approche.
    for (let i = 0; i < 25; i++) {
      const nom = `masse-${SUFFIXE}-${i}`;
      const r = await admin.appel('POST', '/api/admin/users',
        { username: nom, password: MOT_DE_PASSE });

      if (r.status !== 201) {
        refus = { rang: i, status: r.status, error: r.donnees?.error };
        break;
      }
      noms.push(nom);
    }

    verifie('vingt-cinq acces se creent d\'affilee sans declencher le plafond',
      refus === null, refus);

    // Et la revocation compte pareil : elle passe par le meme plafond.
    const liste = await admin.appel('GET', '/api/admin/users');
    const aRetirer = liste.donnees.users.filter((u) => noms.includes(u.username));

    let refusRevocation = null;
    for (const u of aRetirer) {
      const r = await admin.appel('DELETE', `/api/admin/users/${u.id}`);
      if (r.status !== 200) { refusRevocation = { u: u.username, status: r.status }; break; }
    }

    verifie('et vingt-cinq revocations non plus', refusRevocation === null, refusRevocation);

    // Menage de ce qui resterait si une boucle s'est arretee en chemin.
    await prisma.adminUser.deleteMany({ where: { username: { in: noms } } });
  }

  // --- 6. La colonne des roles, posee et inutilisee ------------------------
  //
  // Elle est en base pour ne pas avoir a migrer une seconde fois chez un client
  // qui tourne. Aucun code ne la lit : ce test le CONSTATE, pour que personne ne
  // croie a une regle d'autorisation qui n'existe pas.
  console.log('\n6. Les roles n\'existent pas encore');
  {
    const compte = await prisma.adminUser.findFirst({ where: { username: LEA } });
    verifie('la colonne role existe et part vide', compte?.role === '', compte?.role);

    await prisma.adminUser.update({ where: { id: compte.id }, data: { role: 'employe' } });

    const { client, status } = await connecteSous(LEA);
    verifie('un role pose ne change rien a la connexion', status === 200, status);

    const reglages = await client.appel('GET', '/api/admin/settings');
    verifie('et rien aux droits : tous les acces peuvent tout faire',
      reglages.status === 200, reglages.status);
  }
} finally {
  // Les comptes de test partent quoi qu'il arrive : un compte oublie en base
  // est un acces oublie, et c'est precisement le defaut que ce lot corrige.
  await prisma.adminUser.deleteMany({ where: { username: { in: aNettoyer } } });
  await prisma.adminUser.deleteMany({ where: { username: { startsWith: 'court-' } } });
  await prisma.adminUser.deleteMany({ where: { username: { startsWith: `masse-${SUFFIXE}` } } });
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
