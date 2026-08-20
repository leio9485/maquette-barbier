// ---------------------------------------------------------------------------
// TESTS DE L'ANNULATION PAR LE CLIENT
//
//     npm start              (terminal 1, laisse ouvert)
//     npm run test:annulation (terminal 2)
//
// Ce que couvre cette suite, cas par cas :
//
//   - la reference est bien engendree, unique, et dans le bon alphabet ;
//   - annulation nominale, par reference + telephone ;
//   - annulation par le lien signe (reference + jeton) ;
//   - mauvais couple, reference inconnue : MEME reponse, au mot pres ;
//   - rendez-vous deja passe ;
//   - double annulation ;
//   - le creneau libere revient immediatement dans le calendrier public ;
//   - deplacement : nominal, creneau occupe, et surtout — L'ANCIEN CRENEAU
//     N'EST JAMAIS PERDU quand la seconde moitie echoue ;
//   - la limitation des tentatives.
//
// >>> L'ORDRE DES SECTIONS COMPTE. <<< La limitation de debit vit en memoire du
// serveur et porte sur l'adresse IP, laquelle est la meme pour toute la suite.
// La section 9 la declenche donc volontairement ; elle est la DERNIERE, et elle
// se termine par un appel muni d'un jeton valide, qui remet le compteur a zero
// (voir src/routes/rendezvous.js). Sans cette derniere etape, relancer `npm
// test` dans le quart d'heure echouerait d'un bout a l'autre.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  creerClient,
  clientConnecte,
  supprimerCompteDeTest,
  creerVerificateur,
  prochainJourOuvert,
  BASE,
} from './helpers.mjs';
import { ROOT_DIR } from '../src/config.js';

const { verifie, bilan } = creerVerificateur();

const visiteur = creerClient();
const salon = await clientConnecte();

const JOUR = prochainJourOuvert();
const TELEPHONE = '06 39 98 12 34';
const QUATRE = '1234';

/** L'alphabet de Crockford : ni I, ni L, ni O, ni U. Voir src/lib/reference.js. */
const ALPHABET = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/** Les creneaux libres d'une journee, pour une prestation. */
async function creneauxLibres(date, serviceId = 'coupe-homme') {
  const r = await visiteur.appel('GET', `/api/slots?date=${date}&serviceId=${serviceId}`);
  return (r.donnees?.slots ?? []).filter((c) => c.free);
}

/** Prend un rendez-vous et renvoie ce que le serveur en dit. */
async function reserver(date, start, serviceId = 'coupe-homme', telephone = TELEPHONE) {
  const r = await visiteur.appel('POST', '/api/bookings', {
    date, start, serviceId, name: 'Cliente de test', phone: telephone,
  });
  return r;
}

/** Les rendez-vous crees par cette suite, effaces a la fin quoi qu'il arrive. */
const aNettoyer = [];

async function reserverEtSuivre(date, start, serviceId, telephone) {
  const r = await reserver(date, start, serviceId, telephone);
  if (r.donnees?.id) aNettoyer.push(r.donnees.id);
  return r;
}

const addJours = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

console.log(`Journee de test : ${JOUR}\n`);

try {
  // --- 1. La reference ------------------------------------------------------
  console.log('1. La reference remise au client');

  let rdv = null;
  {
    const libres = await creneauxLibres(JOUR);
    verifie('la journee de test a des creneaux libres', libres.length > 0, libres.length);

    const r = await reserverEtSuivre(JOUR, libres[0].start);
    rdv = r.donnees;

    verifie('la reservation aboutit', r.status === 201, r.status);
    verifie('une reference est remise', typeof rdv?.reference === 'string', rdv?.reference);
    verifie('elle fait six caracteres du bon alphabet', ALPHABET.test(rdv?.reference ?? ''), rdv?.reference);
    verifie('le jeton long est remis lui aussi', (rdv?.cancelToken ?? '').length >= 40, rdv?.cancelToken?.length);
    verifie("elle n'est pas un morceau du jeton",
      !(rdv?.cancelToken ?? '').toUpperCase().startsWith(rdv?.reference ?? 'x'), rdv?.reference);
  }

  {
    // Deux reservations d'affilee ne portent jamais la meme reference.
    const libres = await creneauxLibres(JOUR);
    const r = await reserverEtSuivre(JOUR, libres[0].start);
    verifie('deux rendez-vous ont deux references differentes',
      r.donnees?.reference !== rdv.reference, [rdv.reference, r.donnees?.reference]);
  }

  // --- 2. Retrouver son rendez-vous ----------------------------------------
  console.log('\n2. Retrouver son rendez-vous');
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, telephone: QUATRE,
    });
    verifie('reference + quatre chiffres suffisent', r.status === 200, r.status);

    const trouve = r.donnees?.rendezVous;
    verifie('le recapitulatif porte la prestation', trouve?.serviceName === 'Coupe homme', trouve?.serviceName);
    verifie('il porte le jour et l\'heure', trouve?.date === JOUR && trouve?.start === rdv.start, trouve);
    verifie('il ne revele NI le jeton NI le telephone complet',
      trouve?.cancelToken === undefined && trouve?.phone === undefined, Object.keys(trouve ?? {}));
  }
  {
    // La saisie tolerante : minuscules, espaces, et les jumeaux de Crockford.
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: ` ${rdv.reference.toLowerCase()} `, telephone: QUATRE,
    });
    verifie('la reference est acceptee en minuscules et avec des espaces', r.status === 200, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, telephone: '06 39 98 12 34',
    });
    verifie('le numero complet marche aussi bien que les quatre chiffres', r.status === 200, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, jeton: rdv.cancelToken,
    });
    verifie('le lien signe se passe du telephone', r.status === 200, r.status);
  }

  // --- 3. Aucun oracle ------------------------------------------------------
  console.log('\n3. Un refus ne dit jamais lequel des deux est faux');

  let refusInconnue = null;
  let refusMauvaisTelephone = null;
  {
    // Tiree au hasard plutot que figee a « ZZZZZZ » : depuis le lot 6, les
    // echecs sont comptes par reference sur un quart d'heure, et une reference
    // figee finissait bloquee au bout de trois executions de la suite. Elle
    // repondait alors 429 la ou ce test attend le refus ordinaire — c'est-a-dire
    // qu'il ne verifiait plus du tout ce qu'il annonce.
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: referenceJetable(), telephone: QUATRE,
    });
    refusInconnue = r;
    verifie('une reference inconnue est refusee', r.status === 404, r.status);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, telephone: '0000',
    });
    refusMauvaisTelephone = r;
    verifie('une reference valide avec un mauvais telephone est refusee', r.status === 404, r.status);
  }
  {
    verifie('les deux refus ont le MEME code',
      refusInconnue.status === refusMauvaisTelephone.status,
      [refusInconnue.status, refusMauvaisTelephone.status]);
    verifie('les deux refus ont le MEME message, au caractere pres',
      refusInconnue.donnees?.error === refusMauvaisTelephone.donnees?.error,
      [refusInconnue.donnees?.error, refusMauvaisTelephone.donnees?.error]);
    verifie('le refus ne laisse filtrer aucune donnee',
      refusInconnue.donnees?.rendezVous === undefined, refusInconnue.donnees);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: rdv.reference, jeton: 'jeton-invente-de-la-bonne-longueur-ou-pas',
    });
    verifie('un jeton invente est refusé de la meme facon',
      r.status === 404 && r.donnees?.error === refusInconnue.donnees?.error, r.donnees);
  }

  // --- 4. L'annulation nominale --------------------------------------------
  console.log('\n4. L\'annulation');
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: rdv.reference, telephone: QUATRE,
    });
    verifie('le rendez-vous est annule', r.status === 200 && r.donnees?.ok === true, r.donnees);
    verifie('la reponse dit quand il etait', r.donnees?.rendezVous?.date === JOUR, r.donnees?.rendezVous);
    verifie('il porte desormais une date d\'annulation',
      typeof r.donnees?.rendezVous?.cancelledAt === 'string', r.donnees?.rendezVous?.cancelledAt);
  }
  {
    const libres = await creneauxLibres(JOUR);
    verifie('le creneau libere reapparait immediatement dans le calendrier public',
      libres.some((c) => c.start === rdv.start), rdv.start);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: rdv.reference, telephone: QUATRE,
    });
    verifie('annuler deux fois le dit clairement', r.status === 409, r.status);
    verifie('et le message est explicite', /déjà été annulé/.test(r.donnees?.error ?? ''), r.donnees?.error);
    verifie('le rendez-vous est joint au refus, pour pouvoir le montrer',
      r.donnees?.rendezVous?.reference === rdv.reference, r.donnees?.rendezVous);
  }

  // --- 5. Le rendez-vous deja passe ----------------------------------------
  console.log('\n5. Un rendez-vous deja passe');
  {
    // Ecrit directement en base : le serveur refuse, a juste titre, de prendre
    // un rendez-vous dans le passe par l'API publique.
    const { prisma } = await import('../src/db.js');
    const hier = addJours(new Date().toISOString().slice(0, 10), -1);

    const passe = await prisma.booking.create({
      data: {
        kind: 'appt', date: hier, startMin: 600, durationMin: 25,
        serviceId: 'coupe-homme', customerName: 'Client d\'hier', customerPhone: TELEPHONE,
        source: 'online', reference: 'PASSE1',
        cancelToken: 'jeton-de-test-du-rendez-vous-passe-0000000',
      },
    });
    aNettoyer.push(passe.id);

    const trouve = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: 'PASSE1', telephone: QUATRE,
    });
    verifie('on peut le retrouver — c\'est bien le sien', trouve.status === 200, trouve.status);
    verifie('et le serveur dit qu\'il est passe', trouve.donnees?.rendezVous?.past === true, trouve.donnees);

    const r = await visiteur.appel('POST', '/api/rendez-vous/annuler', {
      reference: 'PASSE1', telephone: QUATRE,
    });
    verifie('mais on ne peut plus l\'annuler', r.status === 409, r.status);
    verifie('et le message le dit', /déjà passé/.test(r.donnees?.error ?? ''), r.donnees?.error);
  }

  // --- 6. Ce qui n'est pas annulable en ligne ------------------------------
  console.log('\n6. Ce qui ne se gere pas depuis cette page');
  {
    const libres = await creneauxLibres(JOUR);
    const cree = await salon.appel('POST', '/api/admin/bookings', {
      date: JOUR, start: libres[0].start, serviceId: 'coupe-homme',
      name: 'Appel telephonique', phone: TELEPHONE,
    });
    aNettoyer.push(cree.donnees.id);

    verifie('un rendez-vous saisi par le salon n\'a pas de reference',
      cree.donnees?.reference === null, cree.donnees?.reference);
  }

  // --- 7. Le deplacement ----------------------------------------------------
  console.log('\n7. Le deplacement');

  let aDeplacer = null;
  const JOUR2 = prochainJourOuvertApres(JOUR);
  {
    const libres = await creneauxLibres(JOUR);
    const r = await reserverEtSuivre(JOUR, libres[0].start);
    aDeplacer = r.donnees;
    verifie('un rendez-vous a deplacer est pris', r.status === 201, r.status);
  }
  {
    const libres = await creneauxLibres(JOUR2);
    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, telephone: QUATRE,
      date: JOUR2, start: libres[0].start,
    });

    verifie('le deplacement aboutit', r.status === 200, r.donnees);
    verifie('le rendez-vous est au nouveau jour', r.donnees?.rendezVous?.date === JOUR2, r.donnees?.rendezVous);
    verifie('IL GARDE SA REFERENCE — le client n\'a rien de nouveau a noter',
      r.donnees?.rendezVous?.reference === aDeplacer.reference, r.donnees?.rendezVous?.reference);
  }
  {
    const libres = await creneauxLibres(JOUR);
    verifie('l\'ancien creneau est libere', libres.some((c) => c.start === aDeplacer.start), aDeplacer.start);
  }
  {
    // Le cas qui compte : la seconde moitie echoue. L'ancien rendez-vous ne
    // doit PAS avoir bouge — c'est ce que garantit la transaction serveur.
    const avant = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });

    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, telephone: QUATRE,
      date: JOUR2, start: 3, // 00h03 : hors des heures d'ouverture
    });
    verifie('un creneau impossible est refuse', r.status === 409, r.status);

    const apres = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });
    verifie('>>> LE RENDEZ-VOUS N\'A PAS BOUGE APRES UN DEPLACEMENT REFUSE <<<',
      apres.donnees?.rendezVous?.date === avant.donnees?.rendezVous?.date
      && apres.donnees?.rendezVous?.start === avant.donnees?.rendezVous?.start,
      [avant.donnees?.rendezVous, apres.donnees?.rendezVous]);
    verifie('et il n\'est pas annule', apres.donnees?.rendezVous?.cancelledAt === null,
      apres.donnees?.rendezVous?.cancelledAt);
  }
  {
    // Deplacer sur un creneau deja occupe par quelqu'un d'autre.
    const libres = await creneauxLibres(JOUR2);
    const autre = await reserverEtSuivre(JOUR2, libres[0].start);

    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, telephone: QUATRE,
      date: JOUR2, start: autre.donnees.start,
    });
    // Avec une equipe, un autre barbier peut etre libre : le refus n'est certain
    // que si le commerce travaille seul. On verifie donc l'invariant qui vaut
    // dans les deux cas — jamais deux rendez-vous sur la meme personne.
    if (r.status === 200) {
      verifie('s\'il aboutit, c\'est avec quelqu\'un d\'autre',
        r.donnees?.rendezVous?.staffId !== autre.donnees.staffId,
        [r.donnees?.rendezVous?.staffId, autre.donnees.staffId]);
    } else {
      verifie('sinon il est refuse proprement, en francais',
        r.status === 409 && typeof r.donnees?.error === 'string', r.donnees);
    }
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, telephone: '0000',
      date: JOUR2, start: 600,
    });
    verifie('deplacer sans preuve est refuse comme le reste', r.status === 404, r.status);
  }

  // --- 7 bis. CE QUE L'ECRAN DE CONFIRMATION A BESOIN DE SAVOIR (lot C) ----
  //
  // Apres un deplacement, le bouton « Annuler ce rendez-vous » disparaissait de
  // l'ecran de confirmation, alors qu'il est la apres une reservation. La cause
  // etait en deux morceaux, et ces controles tiennent les deux.
  console.log('\n7 bis. Ce que renvoie un deplacement');
  {
    // 1. PROUVE PAR LE JETON : le jeton repart avec la reponse. L'appelant
    //    vient de l'ecrire dans sa requete — lui rendre n'apprend rien a
    //    personne, et lui evite de le retenir d'un ecran a l'autre.
    const libres = await creneauxLibres(JOUR2);
    const cible = libres.find((c) => c.start !== aDeplacer.start) ?? libres[0];

    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, jeton: aDeplacer.cancelToken,
      date: JOUR2, start: cible.start,
    });

    verifie('un deplacement prouve par le jeton aboutit', r.status === 200, r.donnees);
    verifie('>>> ET LA REPONSE PORTE UN JETON NON VIDE <<<',
      typeof r.donnees?.jeton === 'string' && r.donnees.jeton.length > 0,
      r.donnees?.jeton === undefined ? '(absent)' : r.donnees.jeton.length);
    verifie('c\'est le meme qu\'avant : le rendez-vous n\'a pas ete recree',
      r.donnees?.jeton === aDeplacer.cancelToken, '');
    verifie('la reference non plus n\'a pas bouge',
      r.donnees?.rendezVous?.reference === aDeplacer.reference, r.donnees?.rendezVous?.reference);
  }
  {
    // 2. PROUVE PAR LES QUATRE CHIFFRES : le jeton ne repart PAS, et c'est
    //    volontaire — quelqu'un qui aurait devine une reference et quatre
    //    chiffres repartirait sinon avec un secret permanent, qui ouvre seul.
    //    Le navigateur, lui, garde celui qu'il avait deja (js/00-memoire.js).
    const libres = await creneauxLibres(JOUR2);
    const cible = libres[libres.length - 1];

    const r = await visiteur.appel('POST', '/api/rendez-vous/deplacer', {
      reference: aDeplacer.reference, telephone: QUATRE,
      date: JOUR2, start: cible.start,
    });

    verifie('un deplacement prouve par quatre chiffres aboutit aussi', r.status === 200, r.donnees);
    verifie('>>> MAIS LE JETON N\'Y FIGURE PAS <<<',
      r.donnees?.jeton === undefined, r.donnees?.jeton);
    verifie('et le recapitulatif ne le porte pas davantage',
      r.donnees?.rendezVous?.cancelToken === undefined
      && r.donnees?.rendezVous?.jeton === undefined, r.donnees?.rendezVous);
  }
  {
    // 3. LA LIGNE « AVEC » : le rendez-vous a ete pris SANS choisir de barbier
    //    (« peu importe »), et le serveur a donc attribue quelqu'un. Il doit le
    //    DIRE — sans quoi le client apprend en arrivant a qui il a affaire.
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });

    const attribue = r.donnees?.rendezVous?.staffId;

    // Sans equipe enregistree, il n'y a personne a nommer : le commerce
    // travaille seul, et la ligne n'aurait rien a dire.
    if (attribue) {
      verifie('la personne attribuee est nommee, pas seulement designee',
        typeof r.donnees.rendezVous.staffName === 'string'
        && r.donnees.rendezVous.staffName.length > 0,
        r.donnees.rendezVous.staffName);
    } else {
      verifie('sans equipe, aucune personne n\'est inventee',
        r.donnees?.rendezVous?.staffName === null, r.donnees?.rendezVous?.staffName);
    }
  }

  // --- 7 ter. LA PAGE /annuler SANS RIEN EN MEMOIRE (lot C, point C5) ------
  //
  // Le rappel « Votre rendez-vous du … » est un RACCOURCI : il pre-remplit la
  // reference que le navigateur garde deja. Il ne doit jamais devenir un
  // passage oblige — quelqu'un qui arrive d'un autre appareil, ou qui annule
  // pour un proche, saisit sa reference comme avant.
  console.log('\n7 ter. La page d\'annulation sans memoire');
  {
    const page = await fetch(`${BASE}/annuler`).then((r) => r.text());

    verifie('le formulaire est servi sans condition',
      page.includes('id="formulaireRecherche"')
      && page.includes('id="champReference"')
      && page.includes('id="champTelephone"'), '');

    verifie('>>> LE RAPPEL PART MASQUE <<<',
      /<div class="annuler-memoire" id="rappelMemoire" hidden>/.test(page), '');

    // Le second facteur reste demande : le rappel ne pose que la reference.
    verifie('les quatre chiffres restent un champ a remplir',
      page.includes('Les 4 derniers chiffres de votre téléphone'), '');
  }

  // --- 8. L'agenda du commercant -------------------------------------------
  console.log('\n8. Ce que le commercant voit');
  {
    const r = await salon.appel('GET', `/api/admin/bookings?from=${JOUR}&to=${JOUR}`);
    const annule = (r.donnees?.bookings ?? []).find((b) => b.reference === rdv.reference);

    verifie('un rendez-vous annule par le client reste visible dans l\'agenda',
      Boolean(annule), rdv.reference);
    verifie('et il porte sa date d\'annulation',
      typeof annule?.cancelledAt === 'string', annule?.cancelledAt);
  }

  // --- 9. La limitation des tentatives -------------------------------------
  //
  // EN DERNIER, ET CE N'EST PAS UN CAPRICE : le compteur porte sur l'adresse IP,
  // qui est la meme pour toute la suite. Tout ce qui precede doit donc etre
  // passe avant qu'on le declenche.
  console.log('\n9. La limitation des tentatives');

  // --- 9 a. Le compteur PAR REFERENCE (lot 6) ------------------------------
  //
  // >>> LE COMPTEUR PAR ADRESSE NE PROTEGE PAS DE CE QUI MENACE VRAIMENT. <<<
  //
  // La reference vaut trente bits, mais les quatre derniers chiffres du
  // telephone n'en valent que treize : DIX MILLE possibilites. Qui a vu une
  // reference — capture d'ecran, courriel transfere, bout de papier — n'a que
  // dix mille essais a faire. Repartis sur plusieurs adresses, le compteur par
  // adresse ne les voit jamais.
  //
  // CE QUE CE TEST DEMONTRE, et c'est tout son interet : le blocage survient
  // ALORS QUE LE COMPTEUR PAR ADRESSE EST BAS. On le remet a zero toutes les
  // quatre tentatives — une saisie juste sur une AUTRE reference suffit — et
  // le blocage tombe quand meme.
  {
    const cible = referenceJetable();

    const client = creerClient();

    /**
     * Une saisie JUSTE sur une AUTRE reference.
     *
     * Elle remet a zero le compteur d'adresse — et lui seul, puisque l'autre
     * est indexe par reference. C'est ce qui permet de faire onze tentatives
     * sur `cible` sans jamais approcher le seuil par adresse.
     */
    const remettreLAdresseAZero = async () => {
      const r = await client.appel('POST', '/api/rendez-vous/retrouver', {
        reference: aDeplacer.reference, telephone: QUATRE,
      });
      return r.status === 200;
    };

    // ⚠️ AVANT DE COMMENCER : les sections precedentes ont produit des refus, et
    //    le compteur d'adresse n'est donc pas a zero. Sans cette remise a zero,
    //    c'est lui qui bloquerait en premier et le test ne mesurerait rien de ce
    //    qu'il pretend mesurer.
    const depart = await remettreLAdresseAZero();
    verifie('le compteur par adresse repart de zero', depart, 'remise a zero impossible');

    let bloqueA = null;
    let adresseAuBlocage = null;
    let echecsDepuisLaRemiseAZero = 0;

    for (let essai = 1; essai <= 20 && bloqueA === null; essai++) {
      const r = await client.appel('POST', '/api/rendez-vous/retrouver', {
        reference: cible, telephone: '0000',
      });

      if (r.status === 429) {
        bloqueA = essai;
        adresseAuBlocage = echecsDepuisLaRemiseAZero;
        break;
      }

      echecsDepuisLaRemiseAZero++;

      // Toutes les trois tentatives : le seuil par adresse est a cinq, on reste
      // donc large. Le compteur par reference, lui, continue de monter.
      if (echecsDepuisLaRemiseAZero >= 3) {
        if (!await remettreLAdresseAZero()) break;
        echecsDepuisLaRemiseAZero = 0;
      }
    }

    verifie('>>> UNE REFERENCE ACHARNEE FINIT PAR ETRE BLOQUEE <<<',
      bloqueA !== null, bloqueA);
    verifie('le blocage survient au onzieme essai sur cette reference',
      bloqueA === 11, bloqueA);
    verifie('et le compteur par adresse etait loin du seuil a ce moment-la',
      adresseAuBlocage !== null && adresseAuBlocage < 5, adresseAuBlocage);
    console.log(`     bloque a la tentative n°${bloqueA} sur la reference ${cible}`);
  }
  {
    // Le blocage vise CETTE reference, pas le service : une autre s'ouvre encore.
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });
    verifie('une autre reference reste accessible', r.status === 200, r.status);
  }

  // --- 9 b. Le compteur PAR ADRESSE ----------------------------------------
  {
    // Le compteur repart de zero : les sections precedentes ont produit des
    // refus, et une reussite les efface (`resetFailures`). Sans cette ligne, on
    // mesurerait « le sixieme echec DEPUIS LE DEBUT DE LA SUITE », ce qui n'est
    // pas ce que le critere demande.
    await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });

    const client = creerClient();
    let bloqueAu = null;

    // ⚠️ UNE REFERENCE DIFFERENTE A CHAQUE EXECUTION, et non « ZZZZZZ ».
    //    Depuis le lot 6, les echecs sont AUSSI comptes par reference, sur un
    //    quart d'heure : une reference figee accumulait ses echecs d'une
    //    execution a l'autre, et deux `npm test` d'affilee bloquaient des le
    //    troisieme essai au lieu du sixieme. Le test mesurait alors l'autre
    //    compteur que celui qu'il annonce.
    const jetable = referenceJetable();

    for (let essai = 1; essai <= 10 && bloqueAu === null; essai++) {
      const r = await client.appel('POST', '/api/rendez-vous/retrouver', {
        reference: jetable, telephone: '0000',
      });
      if (r.status === 429) bloqueAu = essai;
    }

    verifie('les tentatives repetees finissent par etre bloquees', bloqueAu !== null, bloqueAu);
    verifie('le blocage survient au sixieme essai', bloqueAu === 6, bloqueAu);
    console.log(`     bloque a la tentative n°${bloqueAu}`);
  }
  {
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });
    verifie('une fois bloquee, meme la bonne saisie est refusee', r.status === 429, r.status);
  }
  {
    // Le lien du courriel passe outre — mais seulement avec le bon jeton.
    const faux = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, jeton: 'un-jeton-faux-qui-ne-doit-pas-passer',
    });
    verifie('un jeton FAUX ne contourne pas le blocage', faux.status === 404, faux.status);

    const bon = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, jeton: aDeplacer.cancelToken,
    });
    verifie('un jeton JUSTE passe malgre le blocage', bon.status === 200, bon.status);
  }
  {
    // Et il a remis le compteur a zero : la suite est rejouable dans la foulee.
    const r = await visiteur.appel('POST', '/api/rendez-vous/retrouver', {
      reference: aDeplacer.reference, telephone: QUATRE,
    });
    verifie('le jeton juste a debloque la ligne', r.status === 200, r.status);
  }

  // --- L'ECRAN APRES L'ANNULATION -------------------------------------------
  //
  // >>> UN RENDEZ-VOUS ANNULE NE S'AJOUTE PLUS A UN AGENDA. <<<
  //
  // « Ajouter a mon agenda » restait affiche, et cliquable, sous « Le
  // rendez-vous est annule ». Le client repartait avec un fichier .ics pour un
  // rendez-vous qui n'existe plus, et un evenement fantome dans son agenda, a
  // l'heure exacte ou il ne doit pas se presenter. C'est pire que pas de bouton
  // du tout : l'agenda, lui, n'a aucun moyen d'apprendre l'annulation.
  //
  // ⚠️ CE COMPORTEMENT VIT DANS LE NAVIGATEUR, et une suite qui ne parlerait
  //    qu'au serveur ne le verrait jamais. On evalue donc LE VRAI MORCEAU de la
  //    page, comme tests/ics.mjs le fait pour le fichier d'agenda : le fichier
  //    ne declare que des fonctions, aucune ligne ne s'execute a l'evaluation,
  //    et les seules choses qu'il regarde en dehors de ses arguments sont
  //    passees en parametres. Le code du site n'est pas modifie d'un caractere.
  console.log('\n10. L\'ecran de confirmation, une fois le rendez-vous annule');
  {
    const source = await readFile(
      path.join(ROOT_DIR, 'src', 'page', 'js', '07-tunnel.js'), 'utf8');

    /** Les deux boutons de l'ecran 04, et leur visibilite. */
    const boutons = {
      '#ajouterAgenda': { hidden: false, disabled: false },
      '#annulerReservation': { hidden: false, disabled: false },
      '#messageAnnulation': { hidden: true, textContent: '' },
    };

    // ⚠️ ON NE FOURNIT QUE CE QUE LE FICHIER N'A PAS. `allerEtape()`,
    //    `peindreFiche()` et `defilerVersTunnel()` sont declares DANS
    //    07-tunnel.js : un parametre du meme nom serait masque par la
    //    declaration, et c'est le vrai code qui tournerait — ce qu'on veut. Ils
    //    ne demandent alors rien d'autre que `$` et `$$`, et s'arretent d'eux-
    //    memes sur les elements absents.
    const usine = new Function(
      '$', '$$', 'montrer', 'afficherMessage', 'poserTexte', 'dateLongue', 'fmtHeure',
      'annulerReservation', 'annulerParReference', 'oublierRendezVous',
      'document', 'CONFIG',
      `${source}\nreturn { demanderAnnulation, confirmer, RESERVATION };`);

    const tunnel = usine(
      (selecteur) => boutons[selecteur] ?? null,
      () => [],
      (element, visible = true) => { if (element) element.hidden = !visible; },
      (element, texte) => { if (element) element.textContent = texte; },
      () => {},
      () => '',
      () => '',
      async () => ({ ok: true }),
      async () => ({ ok: true }),
      () => {},
      { dispatchEvent: () => {} },
      { staff: [] },
    );

    // On arrive de la reservation : identifiant, jeton, et la matiere du .ics.
    tunnel.RESERVATION.confirmee = { id: 'rdv-de-test', cancelToken: 'jeton', reference: 'MQJYBK' };
    tunnel.RESERVATION.pourAgenda = { date: JOUR, start: 570, duree: 25, reference: 'MQJYBK' };

    verifie('avant : les deux boutons sont affiches',
      boutons['#ajouterAgenda'].hidden === false
      && boutons['#annulerReservation'].hidden === false,
      [boutons['#ajouterAgenda'].hidden, boutons['#annulerReservation'].hidden]);

    await tunnel.demanderAnnulation();

    verifie('« Annuler ce rendez-vous » disparait',
      boutons['#annulerReservation'].hidden === true, boutons['#annulerReservation'].hidden);
    verifie('>>> « AJOUTER A MON AGENDA » DISPARAIT AVEC LUI <<<',
      boutons['#ajouterAgenda'].hidden === true, boutons['#ajouterAgenda'].hidden);

    // La matiere du fichier part aussi, et pas seulement le bouton : sans cela,
    // tout chemin qui remontrerait le bouton ecrirait encore l'ancien
    // rendez-vous.
    verifie('et la matiere du fichier .ics est effacee',
      tunnel.RESERVATION.pourAgenda === null, tunnel.RESERVATION.pourAgenda);

    // >>> LE MEME ECRAN DOIT REDEVENIR COMPLET. <<< « Prendre un autre
    //     rendez-vous » ramene a l'etape 1, et l'ecran de confirmation suivant
    //     doit retrouver SES DEUX boutons — sans quoi le correctif aurait
    //     simplement deplace le defaut d'un cran : plus d'evenement fantome,
    //     mais plus d'ajout a l'agenda du tout apres la premiere annulation.
    tunnel.RESERVATION.prestation = { name: 'Coupe homme', duration: 25 };
    tunnel.confirmer({
      date: JOUR, start: 600, duration: 25, reference: 'PQRSTV', staffId: null,
    });

    verifie('>>> UNE NOUVELLE RESERVATION LES REMONTRE TOUS LES DEUX <<<',
      boutons['#ajouterAgenda'].hidden === false
      && boutons['#annulerReservation'].hidden === false,
      [boutons['#ajouterAgenda'].hidden, boutons['#annulerReservation'].hidden]);
    verifie('et la matiere du fichier .ics est de nouveau posee',
      tunnel.RESERVATION.pourAgenda?.reference === 'PQRSTV',
      tunnel.RESERVATION.pourAgenda);
  }
} finally {
  // Menage : la base doit retrouver son etat initial.
  for (const id of aNettoyer) {
    await salon.appel('DELETE', `/api/admin/bookings/${id}`);
  }
  await supprimerCompteDeTest();
}

/**
 * Une reference du bon alphabet, differente a chaque execution.
 *
 * ⚠️ INDISPENSABLE DEPUIS LE LOT 6. Les echecs sont desormais comptes par
 *    reference autant que par adresse, sur un quart d'heure. Une reference
 *    figee dans le test accumulerait ses echecs d'une execution a l'autre : le
 *    second `npm test` lance dans le quart d'heure verrait le blocage tomber
 *    trois essais trop tot, et l'echec ressemblerait a un bogue du produit.
 */
function referenceJetable() {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let sortie = '';
  for (let i = 0; i < 6; i++) sortie += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return sortie;
}

/** Le jour ouvert suivant celui passe, dans la meme fenetre mardi-jeudi. */
function prochainJourOuvertApres(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() < 2 || d.getUTCDay() > 4);
  return d.toISOString().slice(0, 10);
}

process.exitCode = bilan() === 0 ? 0 : 1;
