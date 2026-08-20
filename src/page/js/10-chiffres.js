// ---------------------------------------------------------------------------
// LE VOLET « CHIFFRES »
//
// Ce qui manquait a l'espace commercant, et qui manquait le plus cher : un
// patron qui vient de Fresha ou de Planity ouvre l'espace, voit deux onglets et
// aucun nombre, et sait en trois secondes que le produit est plus jeune.
//
// AUCUN CALCUL ICI. Le serveur (src/lib/statistiques.js) renvoie des nombres
// finis ; ce fichier les met en forme. Recalculer un chiffre d'affaires a
// partir d'une liste de rendez-vous ferait diverger les deux le jour ou l'un
// oublierait d'ecarter les annulations.
//
// AUCUNE LIBRAIRIE DE GRAPHIQUES, et rien qui s'anime. Les seules formes
// dessinees sont des barres en CSS pur, de largeur proportionnelle. Une courbe
// demanderait quarante kilo-octets de JavaScript pour dire ce que six nombres
// en chasse fixe disent mieux.
//
// TOUTE DONNEE CHIFFREE EST EN CHASSE FIXE, comme partout ailleurs sur ce site.
// C'est la regle qui compte le plus dans cet ecran : ici, les chiffres SONT le
// contenu.
// ---------------------------------------------------------------------------

/** "3 200" centimes -> "32 €" ; "3 250" -> "32,50 €". */
function fmtEuros(cents) {
  return fmtPrix((cents ?? 0) / 100);
}

/** "+12 %", "−4 %", ou "—" quand la comparaison n'a pas de sens. */
function fmtEcart(pourcent) {
  if (pourcent === null || pourcent === undefined) return '—';
  // Le signe moins typographique, et non le trait d'union du clavier : dans une
  // colonne de chiffres en chasse fixe, le second est deux fois trop court.
  if (pourcent < 0) return `−${Math.abs(pourcent)} %`;
  return `+${pourcent} %`;
}

/** "9h" pour une heure pleine, "1h30" au-dela. */
function fmtHeuresRondes(minutes) {
  const heures = Math.round((minutes ?? 0) / 60);
  return `${heures} h`;
}

/** Un bloc de chiffres : un titre, puis des lignes « intitulé / valeur ». */
function bloc(titre, lignes, { note = '' } = {}) {
  return `<section class="chiffres-bloc">`
    + `<h3 class="etiquette">${esc(titre)}</h3>`
    + `<dl class="fiche">`
    + lignes.map(([intitule, valeur, classe = '']) =>
      `<div${classe ? ` class="${esc(classe)}"` : ''}>`
      + `<dt>${esc(intitule)}</dt><dd>${esc(valeur)}</dd></div>`).join('')
    + '</dl>'
    + (note ? `<p class="petit secondaire chiffres-note">${esc(note)}</p>` : '')
    + '</section>';
}

/**
 * Une barre proportionnelle, en CSS pur.
 *
 * La largeur est posee en style en ligne parce qu'elle est une DONNEE, pas une
 * decision de mise en forme : elle change a chaque rendez-vous. C'est la seule
 * exception a « aucune valeur en dehors de 02-jetons.css », et elle est du meme
 * ordre que la teinte d'une personne dans l'agenda.
 *
 * `aria-hidden` : la barre ne dit rien de plus que le nombre ecrit a cote. La
 * laisser lisible ferait annoncer deux fois la meme information.
 */
function barre(valeur, maximum) {
  const part = maximum > 0 ? Math.round((valeur / maximum) * 100) : 0;
  return `<span class="chiffres-barre" aria-hidden="true"><span style="width:${part}%"></span></span>`;
}

/**
 * Un classement : nom, barre, valeur.
 *
 * `echelle` borne la barre. Sans elle, la plus grande valeur de la liste fait
 * une barre pleine — c'est ce qu'il faut pour un classement de prestations, ou
 * seul le rapport entre les lignes compte.
 *
 * ⚠️ CE N'EST PAS CE QU'IL FAUT POUR UN POURCENTAGE. Les heures creuses
 *    n'affichent que les cinq plus vides : si la moins vide des cinq est
 *    remplie a 22 %, une echelle relative lui donnerait une barre PLEINE, et
 *    l'ecran redirait « c'est charge » la ou il annonce le contraire. On passe
 *    alors `echelle: 100`, et une barre courte veut dire ce qu'elle montre.
 */
function classement(titre, lignes, { note = '', vide = 'Rien sur la période.', echelle = null } = {}) {
  if (!lignes.length) {
    return `<section class="chiffres-bloc"><h3 class="etiquette">${esc(titre)}</h3>`
      + `<p class="secondaire petit">${esc(vide)}</p></section>`;
  }

  const maximum = echelle ?? Math.max(...lignes.map((l) => l.valeur));

  return `<section class="chiffres-bloc">`
    + `<h3 class="etiquette">${esc(titre)}</h3>`
    + '<ul class="chiffres-classement">'
    + lignes.map((l) => '<li>'
      + `<span class="chiffres-classement-nom">${esc(l.nom)}</span>`
      + barre(l.valeur, maximum)
      + `<span class="chiffres-classement-valeur donnee">${esc(l.affichage)}</span>`
    + '</li>').join('')
    + '</ul>'
    + (note ? `<p class="petit secondaire chiffres-note">${esc(note)}</p>` : '')
    + '</section>';
}

// --- Le dessin --------------------------------------------------------------

function peindreChiffres(c) {
  const cible = $('#chiffres');
  if (!cible) return;

  const morceaux = [];

  // --- Cette semaine -------------------------------------------------------
  morceaux.push(bloc('Cette semaine', [
    ['Rendez-vous', String(c.semaine.rendezVous)],
    ['Chiffre d\'affaires prévu', fmtEuros(c.semaine.caCents), 'appui'],
    ['Temps rempli', `${c.semaine.remplissage} %`],
    ['Temps ouvert', fmtHeuresRondes(c.semaine.minutesOuvertes)],
  ], {
    note: 'Le temps rempli compare les minutes réservées au temps réellement '
      + 'ouvert, personne par personne. Les congés et les journées bloquées '
      + 'n\'y comptent pas : le commerce n\'avait rien à vendre.',
  }));

  // --- Ce mois -------------------------------------------------------------
  //
  // L'ecart avec le mois precedent est donne en euros ET en pourcentage. Le
  // pourcentage vaut « — » quand le mois precedent etait vide : « +100 % »
  // depuis zero ne veut rien dire.
  morceaux.push(bloc('Ce mois-ci', [
    ['Rendez-vous', String(c.mois.rendezVous)],
    ['Chiffre d\'affaires prévu', fmtEuros(c.mois.caCents), 'appui'],
    ['Temps rempli', `${c.mois.remplissage} %`],
    ['Écart avec le mois dernier', `${fmtEcart(c.ecart.pourcent)} · ${c.ecart.cents >= 0 ? '+' : '−'}${fmtEuros(Math.abs(c.ecart.cents))}`],
    ['Mois dernier', `${c.moisPrecedent.rendezVous} rendez-vous · ${fmtEuros(c.moisPrecedent.caCents)}`],
  ]));

  // --- Les prestations -----------------------------------------------------
  morceaux.push(classement('Prestations, ce mois-ci',
    c.prestations.map((p) => ({
      nom: p.name,
      valeur: p.caCents,
      affichage: `${p.nombre} · ${fmtEuros(p.caCents)}`,
    })), {
      note: 'Classées par ce qu\'elles rapportent, pas par leur nombre : '
        + 'c\'est ce qui se regarde avant de revoir un tarif.',
    }));

  // --- L'equipe ------------------------------------------------------------
  //
  // ⚠️ CE N'EST PAS UN CLASSEMENT, et le libelle le dit. Les personnes sont
  //    rangees dans l'ordre de l'equipe, pas du plus gros au plus petit :
  //    quelqu'un a trois jours fera toujours moins que quelqu'un a cinq, et un
  //    podium ferait dire a ce tableau une chose qu'il ne sait pas.
  if (c.equipe.length) {
    morceaux.push(classement('Réalisé par chacun, ce mois-ci',
      c.equipe.map((p) => ({
        nom: p.name,
        valeur: p.caCents,
        affichage: `${p.nombre} · ${fmtEuros(p.caCents)}`,
      })), {
        note: 'Dans l\'ordre de l\'équipe, pas du plus au moins. Les horaires '
          + 'de chacun ne sont pas les mêmes : ces lignes ne se comparent pas '
          + 'entre elles.',
      }));
  }

  // --- Les creneaux morts --------------------------------------------------
  //
  // Le chiffre le plus actionnable de l'ecran : on ne fait pas grand-chose d'un
  // chiffre d'affaires, on peut fermer le mardi matin.
  //
  // >>> IL SE LISAIT A L'ENVERS. <<< La barre encodait le VIDE et le nombre
  //     encodait le VOLUME : les deux allaient en sens inverse sur la meme
  //     ligne, si bien qu'une barre longue accompagnait « 6 rdv » et une barre
  //     courte « 19 rdv ». Un patron qui survole lit « grande barre =
  //     beaucoup », c'est-a-dire l'exact contraire de ce que le tableau dit.
  //
  //     La barre montre desormais LE REMPLISSAGE, dans le meme sens que le
  //     chiffre ecrit a cote : barre courte = heure creuse. Et son echelle est
  //     absolue (0 a 100 %), pas relative aux cinq lignes affichees — voir
  //     `classement()`.
  morceaux.push(classement('Heures les plus creuses',
    c.creneauxMorts.map((h) => ({
      nom: `${JOURS_LONGS[h.jour]} ${String(h.heure).padStart(2, '0')}:00`,
      valeur: h.remplissage,
      // Le pourcentage decide, le nombre brut donne l'ordre de grandeur :
      // 0 % sur deux places offertes et 0 % sur quarante ne demandent pas la
      // meme decision.
      affichage: `${h.remplissage} % · ${h.nombre === 0 ? 'aucun rdv' : `${h.nombre} rdv`}`,
    })), {
      echelle: 100,
      note: `Part du temps réellement vendue sur cette heure-là, sur les `
        + `${c.reculSemaines} dernières semaines — heures d'ouverture seulement, `
        + "congés déduits. C'est là qu'on peut fermer, décaler, ou proposer "
        + 'quelque chose.',
      vide: 'Pas encore assez de recul.',
    }));

  // --- La clientele --------------------------------------------------------
  const total = c.clientele.total;
  morceaux.push(bloc('Clientèle, ce mois-ci', [
    ['Nouveaux', `${c.clientele.nouveaux}${total ? ` · ${Math.round((c.clientele.nouveaux / total) * 100)} %` : ''}`],
    ['Déjà venus', `${c.clientele.habitues}${total ? ` · ${Math.round((c.clientele.habitues / total) * 100)} %` : ''}`],
  ], {
    note: 'Comptés par numéro de téléphone, sur tout l\'historique : quelqu\'un '
      + 'qui revient après un an n\'est pas un nouveau client.',
  }));

  // --- Les absences --------------------------------------------------------
  //
  // ⚠️ LA NOTE ENONCE LA CONVENTION, ET CE N'EST PAS UN ORNEMENT. Le
  //    denominateur est tout ce qui est passe, et « venu » est l'etat par
  //    defaut : sans la phrase, un taux a 0 % se lirait comme un sans-faute
  //    alors qu'il decrit aussi bien un commercant qui n'a rien signale. La
  //    regle complete est en tete de `absences()`, src/lib/statistiques.js.
  //
  //    L'ecran disait auparavant « pointes : 3 sur 42 ». Ce chiffre n'existe
  //    plus : depuis qu'on ne coche que les absences, « ce qui a ete pointe »
  //    ne contient plus que des absents, et le taux aurait affiche 100 % a
  //    quelqu'un qui a eu deux lapins sur quarante-deux rendez-vous.
  const a = c.absences;
  morceaux.push(bloc('Absences, ce mois-ci', [
    ['Rendez-vous passés', String(a.passes)],
    ['Absents', String(a.absents)],
    ['Taux d\'absence', a.passes ? `${a.taux} %` : '—', 'appui'],
  ], {
    note: 'Un rendez-vous passé compte comme honoré tant qu\'il n\'est pas '
      + 'marqué « pas venu » dans l\'agenda. Le taux porte sur tous les '
      + 'rendez-vous passés du mois.',
  }));

  // --- Les notifications ---------------------------------------------------
  //
  // N'apparait que si un canal est plafonne, c'est-a-dire aujourd'hui : jamais.
  // Le bloc est ecrit maintenant pour que l'allumage du SMS n'ait rien a
  // ajouter ici.
  const sms = c.notifications?.sms;
  if (sms && (sms.envoyes > 0 || sms.refuses > 0)) {
    morceaux.push(bloc('SMS envoyés ce mois-ci', [
      ['Partis', `${sms.envoyes}${sms.plafond === null ? '' : ` sur ${sms.plafond}`}`],
      ['Non partis (plafond atteint)', String(sms.refuses), sms.refuses ? 'appui' : ''],
    ], {
      note: sms.refuses
        ? 'Des rappels n\'ont pas été envoyés. Le plafond mensuel est atteint.'
        : '',
    }));
  }

  cible.innerHTML = `<div class="chiffres-grille">${morceaux.join('')}</div>`;
}

// --- Le chargement ----------------------------------------------------------

async function chargerChiffres() {
  const message = $('#messageChiffres');

  try {
    const chiffres = await lireChiffres();
    afficherMessage(message, '');
    peindreChiffres(chiffres);
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  }
}
