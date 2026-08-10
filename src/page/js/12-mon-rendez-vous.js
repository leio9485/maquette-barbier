// ---------------------------------------------------------------------------
// « VOTRE RENDEZ-VOUS » — le rappel sous l'en-tete.
//
// Un client qui a reserve la semaine derniere revient sur le site et voit, sous
// l'en-tete : « Votre rendez-vous : mardi 11 août à 09:30 avec Rémi — déplacer
// / annuler ». Il n'a rien a ressaisir, rien a chercher dans ses courriels.
//
// >>> CE QUI EST GARDE DANS LE NAVIGATEUR N'EST PAS UNE SOURCE DE VERITE. <<<
//
// C'est la seule regle de ce fichier, et elle explique tout le reste. Le salon
// a pu annuler par telephone, le client a pu annuler depuis un autre appareil,
// la base de la demonstration a pu etre remise a zero cette nuit. Le rappel est
// donc REVALIDE aupres du serveur a chaque chargement, et il ne s'affiche
// qu'apres. Un bandeau qui annonce un rendez-vous qui n'existe plus est pire
// que pas de bandeau du tout : il fait rater un rendez-vous ou vient s'ajouter
// a une annulation deja faite.
//
// LA DEGRADATION EST LE SILENCE. Serveur injoignable, reponse illisible,
// stockage refuse par le navigateur : le bandeau ne s'affiche pas, et rien
// n'est dit. Le client n'a pas demande ce rappel — il n'a pas a apprendre qu'il
// a echoue.
// ---------------------------------------------------------------------------

/** Le bandeau ne se peint qu'une fois, meme si la page en redemande. */
let rappelPeint = false;

/**
 * Revalide un rendez-vous garde en memoire.
 *
 * Renvoie l'etat que le serveur en donne, ou `null` — et `null` couvre les
 * trois cas ou il faut se taire : il n'existe plus, il a ete annule, ou on n'a
 * pas pu demander.
 *
 * Un rendez-vous qui n'existe plus est aussi OUBLIE : sans cela, on
 * l'interrogerait a chaque visite jusqu'a la fin des temps.
 */
async function revaliderRendezVous(garde) {
  if (!garde.jeton) {
    // Sans jeton, on ne peut rien revalider : la revalidation exigerait les
    // quatre chiffres du telephone, qu'on ne garde pas. On oublie l'entree
    // plutot que d'afficher quelque chose d'invérifiable.
    oublierRendezVous(garde.reference);
    return null;
  }

  let reponse;
  try {
    reponse = await fetch('/api/rendez-vous/retrouver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: garde.reference, jeton: garde.jeton }),
      credentials: 'same-origin',
    });
  } catch {
    return null; // reseau coupe : on se tait, on ne desapprend rien.
  }

  // 404 : le rendez-vous a disparu pour de bon (supprime par le salon, base
  // remise a zero). C'est le seul code qui autorise a effacer la memoire — un
  // 429 ou un 500 sont des pannes, et une panne n'annule pas un rendez-vous.
  if (reponse.status === 404) {
    oublierRendezVous(garde.reference);
    return null;
  }
  if (!reponse.ok) return null;

  let donnees;
  try {
    donnees = await reponse.json();
  } catch {
    return null;
  }

  const rdv = donnees?.rendezVous;
  if (!rdv) return null;

  if (rdv.cancelledAt || rdv.past) {
    oublierRendezVous(rdv.reference);
    return null;
  }

  // Le serveur fait foi : si le salon a decale le rendez-vous, la memoire se
  // remet a jour toute seule, sans que personne n'ait a s'en occuper.
  retenirRendezVous({ ...rdv, jeton: garde.jeton });

  return rdv;
}

/** Le bandeau lui-meme, pose juste sous l'en-tete. */
function peindreRappel(rdv) {
  if (rappelPeint) return;

  const entete = $('.entete');
  if (!entete || !entete.parentNode) return;

  const quand = `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}`;
  const avec = rdv.staffName ? ` avec ${esc(rdv.staffName)}` : '';
  const quoi = rdv.serviceName ? `${esc(rdv.serviceName)} — ` : '';

  const bandeau = document.createElement('aside');
  bandeau.className = 'rappel';
  bandeau.id = 'rappelRendezVous';
  bandeau.setAttribute('aria-label', 'Votre rendez-vous');

  // La reference part dans l'adresse, le jeton aussi : c'est le meme lien que
  // celui du courriel, et /annuler l'efface de la barre d'adresse des qu'il l'a
  // lu (voir js/annuler/03-demarrage.js).
  const lien = `/annuler?ref=${encodeURIComponent(rdv.reference)}`
    + `&jeton=${encodeURIComponent(rdv.jeton || '')}`;

  bandeau.innerHTML = `
    <div class="rappel-corps">
      <p class="rappel-texte">
        <span class="rappel-titre">Votre rendez-vous</span>
        <span class="rappel-quand donnee">${esc(quand)}</span>
        <span class="rappel-quoi">${quoi}${esc(rdv.reference)}${avec}</span>
      </p>
      <a class="rappel-lien" href="${lien}">Déplacer ou annuler</a>
    </div>`;

  entete.parentNode.insertBefore(bandeau, entete.nextSibling);
  rappelPeint = true;
}

/**
 * Cherche un rendez-vous garde, le revalide, et l'affiche s'il tient encore.
 *
 * Un seul est montre — le plus proche. Quelqu'un qui en aurait trois n'a pas
 * besoin d'un tableau en haut de la vitrine ; il a besoin de savoir quand est
 * le prochain, et d'un lien pour le reste.
 */
async function montrerMonRendezVous() {
  const gardes = rendezVousRetenus();
  if (!gardes.length) return;

  for (const garde of gardes) {
    const rdv = await revaliderRendezVous(garde);
    if (rdv) {
      peindreRappel({ ...rdv, jeton: garde.jeton });
      return;
    }
  }
}

/**
 * Retient le rendez-vous qui vient d'etre pris.
 *
 * Appele par le tunnel a la confirmation. Le nom de la prestation et celui de
 * la personne sont resolus ICI depuis CONFIG : la reponse du serveur ne porte
 * que des identifiants, et le rappel doit pouvoir s'ecrire sans rien redemander.
 */
function retenirLaReservation(reponse) {
  if (!reponse?.reference) return;

  retenirRendezVous({
    reference: reponse.reference,
    jeton: reponse.cancelToken,
    date: reponse.date,
    start: reponse.start,
    duration: reponse.duration,
    serviceName: CONFIG?.services.find((s) => s.id === reponse.serviceId)?.name || '',
    staffName: reponse.staffId
      ? (CONFIG?.staff.find((p) => p.id === reponse.staffId)?.name || '')
      : '',
  });
}
