// ---------------------------------------------------------------------------
// MOTS DE PASSE
//
// Un mot de passe n'est JAMAIS enregistre tel quel. On en calcule une empreinte
// a sens unique : facile a produire depuis le mot de passe, impossible a
// remonter dans l'autre sens. Verifier une connexion, c'est recalculer
// l'empreinte de ce qui est saisi et la comparer a celle qui est stockee.
//
// Consequence concrete : meme en lisant toute la base de donnees, on ne peut
// pas retrouver le mot de passe du commercant. Et si un jour il l'oublie,
// personne ne peut le lui redonner — on lui en fixe un nouveau.
//
// L'algorithme utilise est scrypt, fourni par Node lui-meme : aucune brique
// externe a installer, donc rien de plus a compiler ni a maintenir. Il est
// volontairement LENT et gourmand en memoire, ce qui rend le fait d'essayer des
// millions de mots de passe a la chaine bien trop couteux pour un attaquant.
// ---------------------------------------------------------------------------

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const calculer = promisify(scrypt);

// Parametres de cout. Ils sont ecrits dans l'empreinte elle-meme : on pourra
// les durcir plus tard sans invalider les mots de passe deja enregistres.
const COUT = 16384;      // N — travail demande
const BLOCS = 8;         // r
const PARALLELE = 1;     // p
const LONGUEUR = 64;     // octets d'empreinte
const SEL_OCTETS = 16;
const MEMOIRE_MAX = 64 * 1024 * 1024;

export const LONGUEUR_MINIMALE = 10;

/**
 * Transforme un mot de passe en empreinte enregistrable.
 *
 * Le "sel" est une valeur aleatoire, differente pour chaque mot de passe et
 * rangee a cote de l'empreinte. Sans lui, deux personnes ayant choisi le meme
 * mot de passe auraient la meme empreinte, et une table de correspondances
 * pre-calculee suffirait a les percer toutes les deux d'un coup.
 */
export async function hashPassword(motDePasse) {
  const sel = randomBytes(SEL_OCTETS);
  const empreinte = await calculer(motDePasse.normalize('NFKC'), sel, LONGUEUR, {
    N: COUT, r: BLOCS, p: PARALLELE, maxmem: MEMOIRE_MAX,
  });

  return [
    'scrypt', COUT, BLOCS, PARALLELE,
    sel.toString('base64'),
    empreinte.toString('base64'),
  ].join('$');
}

/**
 * Verifie un mot de passe face a une empreinte enregistree.
 *
 * La comparaison finale se fait en temps constant : une comparaison ordinaire
 * s'arrete au premier caractere different, et la duree de la reponse revelerait
 * petit a petit le contenu de l'empreinte.
 */
export async function verifyPassword(motDePasse, empreinteStockee) {
  if (typeof motDePasse !== 'string' || typeof empreinteStockee !== 'string') return false;

  const morceaux = empreinteStockee.split('$');
  if (morceaux.length !== 6 || morceaux[0] !== 'scrypt') return false;

  const [, cout, blocs, parallele, selBase64, empreinteBase64] = morceaux;

  try {
    const sel = Buffer.from(selBase64, 'base64');
    const attendue = Buffer.from(empreinteBase64, 'base64');

    const calculee = await calculer(motDePasse.normalize('NFKC'), sel, attendue.length, {
      N: Number(cout), r: Number(blocs), p: Number(parallele), maxmem: MEMOIRE_MAX,
    });

    return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
  } catch {
    // Empreinte illisible : on refuse, sans faire echouer la requete.
    return false;
  }
}

/** Mot de passe solide tire au hasard, pour la creation d'un compte. */
export function generatePassword() {
  // Alphabet sans caracteres ambigus (0/O, 1/l/I) : ce mot de passe sera lu a
  // l'ecran puis recopie a la main par le commercant.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const octets = randomBytes(20);
  let resultat = '';
  for (const octet of octets) resultat += alphabet[octet % alphabet.length];
  return resultat;
}

/** Message expliquant pourquoi un mot de passe est refuse, ou null s'il convient. */
export function checkPasswordStrength(motDePasse) {
  if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MINIMALE) {
    return `Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE} caractères.`;
  }
  if (motDePasse.length > 200) {
    return 'Le mot de passe est trop long (200 caractères au maximum).';
  }
  return null;
}
