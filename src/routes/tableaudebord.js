// ---------------------------------------------------------------------------
// LE TABLEAU DE BORD ET L'EXPORT
//
//   GET /api/admin/chiffres          les nombres du volet « Chiffres »
//   GET /api/admin/export/clients    un CSV des clients
//   GET /api/admin/export/rendez-vous  un CSV des rendez-vous
//
// Tout est derriere `requireAdmin` : ces reponses portent des noms et des
// numeros de telephone.
//
// L'EXPORT N'EST PAS UN GADGET. « Vos donnees vous appartiennent » est un
// argument de vente, et un prospect averti demandera a le verifier. Sans bouton,
// l'argument est une phrase ; avec, c'est une demonstration de dix secondes.
// C'est aussi ce qui rend le depart possible — et le dire franchement est ce
// qui donne envie de rester.
// ---------------------------------------------------------------------------

import express from 'express';

import { prisma } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { loadStaff } from '../lib/availability.js';
import { tableauDeBord, clePhone, absencesParClient } from '../lib/statistiques.js';
import { consommationDuMois } from '../lib/notifications.js';

export const tableauDeBordRouter = express.Router();

/** 570 -> "09:30". Meme ecriture que partout ailleurs. */
function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// --- Les chiffres ----------------------------------------------------------

/**
 * GET /api/admin/chiffres
 *
 * Le volet « Chiffres » en un seul appel. On y joint la consommation de
 * notifications du mois : le commercant doit voir arriver son plafond avant de
 * le heurter, pas apres.
 */
tableauDeBordRouter.get('/admin/chiffres', requireAdmin, async (req, res, next) => {
  try {
    const [chiffres, notifications] = await Promise.all([
      tableauDeBord(),
      consommationDuMois(),
    ]);

    // `Infinity` ne survit pas a JSON.stringify : il devient `null`, ce qui
    // aurait fait afficher « plafond : null » a l'ecran. On le dit en clair.
    const propres = Object.fromEntries(Object.entries(notifications).map(([canal, ligne]) => [
      canal,
      { ...ligne, plafond: Number.isFinite(ligne.plafond) ? ligne.plafond : null },
    ]));

    res.json({ ...chiffres, notifications: propres });
  } catch (erreur) {
    next(erreur);
  }
});

// --- L'export --------------------------------------------------------------

/**
 * Une cellule de CSV, au format qu'Excel comprend.
 *
 * Guillemets doubles autour de tout, guillemets internes doubles. On n'essaie
 * pas de deviner ce qui a besoin d'etre protege : un nom peut contenir un
 * point-virgule, une note un saut de ligne, et un tarif une virgule decimale.
 */
function cellule(valeur) {
  return `"${String(valeur ?? '').replaceAll('"', '""')}"`;
}

function ligneCsv(valeurs) {
  return valeurs.map(cellule).join(';');
}

/**
 * Le fichier complet, pret a etre ouvert par un tableur francais.
 *
 * DEUX DETAILS QUI DECIDENT DE TOUT, et qui ne se voient qu'a l'ouverture :
 *
 *   - LE SEPARATEUR EST LE POINT-VIRGULE. Excel en configuration francaise lit
 *     la virgule comme separateur decimal ; un CSV « comma-separated » y arrive
 *     en une seule colonne, et le commercant conclut que l'export est casse.
 *
 *   - LE FICHIER COMMENCE PAR UN BOM UTF-8 (﻿). Sans lui, Excel suppose
 *     l'encodage de la machine et affiche « RÃ©mi » au lieu de « Rémi ». Le
 *     fichier serait pourtant parfaitement valide — c'est le genre de bogue
 *     qu'on ne voit jamais en le testant sous Linux.
 *
 * Les fins de ligne sont en CRLF, ce qu'attendent les tableurs sous Windows.
 */
function fichierCsv(entetes, lignes) {
  return '﻿' + [ligneCsv(entetes), ...lignes.map(ligneCsv)].join('\r\n') + '\r\n';
}

/** Pose les en-tetes qui font telecharger le fichier plutot que l'afficher. */
function servirCsv(res, nom, contenu) {
  const jour = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}-${jour}.csv"`);
  // Ces donnees changent a chaque rendez-vous : rien a mettre en cache, et
  // surtout rien qu'un relais aurait le droit de garder.
  res.setHeader('Cache-Control', 'no-store');
  res.send(contenu);
}

/** "3200" centimes -> "32,00" : la virgule decimale, celle qu'attend le tableur. */
function euros(cents) {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * GET /api/admin/export/rendez-vous
 *
 * Tout l'historique, une ligne par rendez-vous. Les blocages sont ecartes : ce
 * ne sont pas des rendez-vous, et leur presence ferait fausser tout comptage
 * fait dans le tableur.
 *
 * LES ANNULATIONS SONT INCLUSES, avec leur date d'annulation. Les retirer
 * donnerait un fichier plus propre et moins vrai.
 */
tableauDeBordRouter.get('/admin/export/rendez-vous', requireAdmin, async (req, res, next) => {
  try {
    const [rendezVous, prestations, equipe] = await Promise.all([
      prisma.booking.findMany({
        where: { kind: 'appt' },
        orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
      }),
      prisma.service.findMany(),
      loadStaff({ includeInactive: true }),
    ]);

    const nomPrestation = (id) => prestations.find((p) => p.id === id)?.name ?? '';
    const nomPersonne = (id) => equipe.find((p) => p.id === id)?.name ?? '';

    const etat = (r) => {
      if (r.annuleLe) return 'Annulé par le client';
      if (r.presence === 'venu') return 'Venu';
      if (r.presence === 'absent') return 'Absent';
      return '';
    };

    const lignes = rendezVous.map((r) => [
      r.date,
      hhmm(r.startMin),
      r.durationMin,
      nomPrestation(r.serviceId),
      nomPersonne(r.staffId),
      r.customerName ?? '',
      r.customerPhone ?? '',
      r.customerEmail ?? '',
      euros(r.priceCents),
      r.source === 'online' ? 'En ligne' : 'Salon',
      r.reference ?? '',
      etat(r),
      r.annuleLe ? r.annuleLe.toISOString().slice(0, 10) : '',
      r.notes ?? '',
    ]);

    servirCsv(res, 'rendez-vous', fichierCsv([
      'Date', 'Heure', 'Durée (min)', 'Prestation', 'Avec', 'Client', 'Téléphone',
      'Courriel', 'Tarif (€)', 'Origine', 'Référence', 'État', 'Annulé le', 'Note',
    ], lignes));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/admin/export/clients
 *
 * Une ligne par personne, regroupee par numero de telephone normalise — pas par
 * nom : deux « Martin » ne sont pas la meme personne, et le meme client tape
 * son nom differemment d'une fois sur l'autre.
 *
 * Le nom retenu est celui du DERNIER rendez-vous : c'est le plus recent, donc
 * le plus probablement correct.
 */
tableauDeBordRouter.get('/admin/export/clients', requireAdmin, async (req, res, next) => {
  try {
    const rendezVous = await prisma.booking.findMany({
      where: { kind: 'appt' },
      orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
    });

    const clients = new Map();

    for (const r of rendezVous) {
      const cle = clePhone(r.customerPhone);
      if (!cle) continue;

      const fiche = clients.get(cle) ?? {
        nom: '', telephone: r.customerPhone, courriel: '',
        premier: r.date, dernier: r.date, venus: 0, absents: 0, annules: 0, total: 0,
      };

      fiche.nom = r.customerName || fiche.nom;
      fiche.telephone = r.customerPhone || fiche.telephone;
      if (r.customerEmail) fiche.courriel = r.customerEmail;
      if (r.date < fiche.premier) fiche.premier = r.date;
      if (r.date > fiche.dernier) fiche.dernier = r.date;

      if (r.annuleLe) fiche.annules += 1;
      else {
        fiche.total += 1;
        if (r.presence === 'venu') fiche.venus += 1;
        if (r.presence === 'absent') fiche.absents += 1;
      }

      clients.set(cle, fiche);
    }

    const lignes = [...clients.values()]
      .sort((a, b) => b.dernier.localeCompare(a.dernier))
      .map((c) => [
        c.nom, c.telephone, c.courriel,
        c.total, c.venus, c.absents, c.annules,
        c.premier, c.dernier,
      ]);

    servirCsv(res, 'clients', fichierCsv([
      'Client', 'Téléphone', 'Courriel', 'Rendez-vous', 'Venus', 'Absents',
      'Annulés', 'Premier', 'Dernier',
    ], lignes));
  } catch (erreur) {
    next(erreur);
  }
});

// --- Le suivi des absences -------------------------------------------------

/**
 * GET /api/admin/absences
 *
 * Combien d'absences par numero, pour le marqueur discret de l'agenda.
 *
 * >>> LES NUMEROS SONT RENVOYES NORMALISES, ET SEULEMENT CEUX QUI COMPTENT. <<<
 * Deux absences au moins : en dessous, le marqueur ne s'affiche pas, et envoyer
 * la liste entiere reviendrait a exporter le repertoire du commerce a chaque
 * ouverture de l'agenda.
 */
tableauDeBordRouter.get('/admin/absences', requireAdmin, async (req, res, next) => {
  try {
    const compte = await absencesParClient();
    const signales = Object.fromEntries([...compte].filter(([, n]) => n >= 2));
    res.json({ seuil: 2, absences: signales });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PUT /api/admin/bookings/:id/presence  { presence: "venu" | "absent" | null }
 *
 * Le pointage, depuis l'agenda.
 *
 * ⚠️ AUCUNE CONSEQUENCE AUTOMATIQUE. Marquer une absence n'envoie rien, ne
 *    bloque rien, ne demande aucun acompte. C'est une note que le commercant
 *    prend pour lui-meme, et le produit n'a pas a decider a sa place qui merite
 *    encore un rendez-vous.
 *
 * On peut revenir en arriere (`null`) : le bouton clique par erreur est le cas
 * le plus frequent d'un pointage, et un etat qu'on ne peut pas defaire ferait
 * hesiter avant chaque clic.
 */
tableauDeBordRouter.put('/admin/bookings/:id/presence', requireAdmin, async (req, res, next) => {
  try {
    const valeur = req.body?.presence;
    if (valeur !== 'venu' && valeur !== 'absent' && valeur !== null) {
      return res.status(400).json({ error: 'Valeur de présence inattendue.' });
    }

    const rendezVous = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!rendezVous) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

    if (rendezVous.kind !== 'appt') {
      return res.status(409).json({ error: "Un blocage n'a personne à pointer." });
    }

    const maj = await prisma.booking.update({
      where: { id: rendezVous.id },
      data: { presence: valeur },
    });

    res.json({ ok: true, id: maj.id, presence: maj.presence });
  } catch (erreur) {
    next(erreur);
  }
});

// --- Le message pour demander un avis --------------------------------------

/**
 * GET /api/admin/message-avis
 *
 * Le SMS tout prêt que le commercant copie et envoie a quelqu'un qui sort de la
 * boutique. Compose ICI, cote serveur, pour la meme raison que les phrases du
 * bandeau d'etat : une seule formulation existe dans le projet.
 *
 * Le lien est celui des reglages, et l'ordre de preference compte : l'adresse
 * qui ouvre DIRECTEMENT la fenetre d'avis, sinon la fiche, sinon rien. Un
 * message qui renvoie vers une recherche Google Maps generique fait perdre la
 * moitie des gens en route ; mieux vaut alors dire au commercant qu'il lui
 * manque un reglage.
 */
tableauDeBordRouter.get('/admin/message-avis', requireAdmin, async (req, res, next) => {
  try {
    const reglages = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!reglages) return res.status(404).json({ error: 'Réglages introuvables.' });

    const lien = reglages.reviewUrl || reglages.googleUrl || '';

    if (!lien) {
      return res.json({
        pret: false,
        message: '',
        aide: 'Renseignez « Lien pour laisser un avis » dans les réglages : '
          + "sans lui, le message renverrait vers une recherche Google, et la moitié des gens abandonnent en route.",
      });
    }

    const message = `Merci de votre visite chez ${reglages.businessName} !`
      + ` Un avis nous aide beaucoup : ${lien}`;

    res.json({ pret: true, message, lien });
  } catch (erreur) {
    next(erreur);
  }
});
