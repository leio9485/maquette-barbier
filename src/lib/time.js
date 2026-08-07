// ---------------------------------------------------------------------------
// Dates et heures.
//
// Deux conventions, reprises telles quelles du site :
//   - une date s'ecrit "AAAA-MM-JJ" (ex. "2026-08-04") ;
//   - une heure est un nombre de minutes depuis minuit (9h30 = 570).
//
// Le fuseau horaire est explicite. Sans cela, un serveur heberge a l'etranger
// (souvent regle sur UTC) pourrait se tromper de jour ou proposer des creneaux
// deja passes : a 00h30 a Paris, il serait encore la veille en heure UTC.
// ---------------------------------------------------------------------------

import { TIMEZONE } from '../config.js';

// "en-CA" formate les dates en AAAA-MM-JJ, exactement la forme voulue.
const formatDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatHeure = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "09:30" -> 570. Renvoie null si le format n'est pas reconnu. */
export function toMin(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;

  const heures = Number(m[1]);
  const minutes = Number(m[2]);
  if (heures > 23 || minutes > 59) return null;

  return heures * 60 + minutes;
}

/** 570 -> "09:30". */
export function toHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Vrai si la chaine est une date "AAAA-MM-JJ" qui existe reellement. */
export function isValidIso(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;

  // Ecarte le 31 février : on reconstruit la date et on verifie qu'elle n'a
  // pas ete "corrigee" en 3 mars par le calendrier.
  const [a, m, j] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(a, m - 1, j));
  return date.getUTCFullYear() === a
    && date.getUTCMonth() === m - 1
    && date.getUTCDate() === j;
}

/**
 * Jour de la semaine d'une date : 0 = dimanche ... 6 = samedi.
 * Calcule en UTC pour que le resultat ne depende pas du reglage du serveur.
 */
export function weekdayOf(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).getUTCDay();
}

/** Date obtenue en ajoutant (ou retirant, si negatif) des jours. */
export function addDaysIso(iso, nombre) {
  const [a, m, j] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(a, m - 1, j));
  date.setUTCDate(date.getUTCDate() + nombre);
  return date.toISOString().slice(0, 10);
}

/** Date du jour, dans le fuseau du commerce. */
export function todayIso(maintenant = new Date()) {
  return formatDate.format(maintenant);
}

/** Heure actuelle en minutes depuis minuit, dans le fuseau du commerce. */
export function nowMinutes(maintenant = new Date()) {
  const [h, m] = formatHeure.format(maintenant).split(':').map(Number);
  return h * 60 + m;
}
