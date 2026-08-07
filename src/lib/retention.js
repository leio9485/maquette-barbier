// ---------------------------------------------------------------------------
// DUREE DE CONSERVATION DES RENDEZ-VOUS
//
// La politique de confidentialite du site annonce pendant combien de temps les
// coordonnees des clientes sont gardees. Ce fichier est ce qui rend cette phrase
// vraie : sans lui, on ecrirait « douze mois » et on garderait tout pour
// toujours. Une mention legale que le logiciel dement ne protege personne.
//
// Le RGPD demande de ne pas conserver des donnees personnelles au-dela de ce
// que justifie leur usage. Douze mois apres le rendez-vous, le nom et le
// telephone d'une cliente n'aident plus a tenir un agenda.
//
// La suppression est definitive et porte sur la ligne entiere : ce n'est pas un
// masquage. Le commercant perd donc son historique ancien — c'est voulu, et
// c'est ce que la page de confidentialite annonce.
// ---------------------------------------------------------------------------

import { prisma } from '../db.js';
import { todayIso } from './time.js';

/** Duree annoncee dans la politique de confidentialite. Les deux doivent concorder. */
export const CONSERVATION_MOIS = 12;

/** Une fois par jour suffit : ces donnees se perimemt a la journee, pas a la minute. */
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

/** La date limite : tout rendez-vous anterieur n'a plus lieu d'etre conserve. */
export function dateLimite(maintenant = new Date()) {
  const limite = new Date(maintenant);
  limite.setMonth(limite.getMonth() - CONSERVATION_MOIS);
  return todayIso(limite);
}

/** Supprime les rendez-vous passes au-dela de la duree annoncee. */
export async function purgeOldBookings() {
  const { count } = await prisma.booking.deleteMany({
    where: { date: { lt: dateLimite() } },
  });
  return count;
}

/** Lance le menage maintenant, puis une fois par jour. */
export function startRetention() {
  const passage = async () => {
    try {
      const supprimes = await purgeOldBookings();
      if (supprimes > 0) {
        console.log(`Rendez-vous de plus de ${CONSERVATION_MOIS} mois supprimes : ${supprimes}`);
      }
    } catch (erreur) {
      console.error('Menage des anciens rendez-vous impossible :', erreur.message);
    }
  };

  passage();

  const minuterie = setInterval(passage, INTERVALLE_MS);
  // Ne pas retenir le processus en vie pour cette seule minuterie.
  minuterie.unref?.();
}
