# Les polices du site

Quatre fichiers, 80 Ko au total. Ils sont servis par ce site, jamais par Google :
aucune requête ne part chez un tiers pendant une visite, ce qui est une
obligation (la page de confidentialité promet qu'il n'y a aucun traceur) autant
qu'une question de vitesse.

| Fichier | Famille | Graisse | Rôle |
|---|---|---|---|
| `plexcond-600.woff2` | IBM Plex Sans Condensed | 600 | les titres, et rien d'autre |
| `plexsans-400.woff2` | IBM Plex Sans | 400 | le texte courant |
| `plexsans-500.woff2` | IBM Plex Sans | 500 | l'appui : citations, valeurs saisies |
| `plexmono-400.woff2` | IBM Plex Mono | 400 | toute donnée : tarifs, durées, heures, dates |

Sous-ensemble latin uniquement. Aucune italique : ni fichier, ni synthèse.

## Pourquoi celles-ci

**Une seule superfamille, trois cuts.** C'était Archivo + Source Sans 3 +
Source Code Pro : trois familles de trois fonderies, chacune bonne pour
elle-même. Elles se tenaient, mais elles ne formaient pas un système, et
l'ensemble se lisait comme un assemblage.

Plex est dessiné d'un bloc par Mike Abbink pour IBM. Le Condensed, le Sans et le
Mono partagent leur squelette, leur hauteur d'x et leurs chiffres : une durée en
chasse fixe s'aligne sur le texte à côté sans un réglage, et les trois rôles se
lisent comme trois voix de la même personne. C'est ce qui distingue une identité
d'une sélection de polices.

Le Condensed n'est pas une graisse de plus du Sans, c'est la police d'affichage
du système : « COUPE, BARBE ET RASAGE » tient sur trois lignes courtes en 72 px,
là où une grotesque de chasse normale obligeait à descendre la taille.

## ⚠️ Ce fichier disait le contraire

L'argument précédent était que Inter, Space Grotesk, Manrope et Plex — surtout
Plex Mono — sont la signature typographique des produits techniques des années
2020, et qu'un site qu'un barbier ne refera pas ne devrait pas porter de date.
Il est gardé ici plutôt qu'effacé, parce qu'il n'est pas faux.

L'arbitrage a été rendu dans l'autre sens, en connaissance de cause, pour deux
raisons :

1. **Le défaut constaté n'était pas que le site aurait l'air daté en 2031, mais
   qu'il avait l'air amateur en 2026.** Un risque certain pèse plus qu'un risque
   supposé.
2. **Ce que Plex date, ce sont les interfaces de logiciel, pas les commerces.**
   Sur le site d'un barbier, personne n'a la référence ; il ne reste que le
   dessin. Et Plex Mono n'y sert qu'aux chiffres — jamais à un paragraphe, qui
   est l'endroit où la citation technique se ferait entendre.

Si l'ensemble devait vieillir malgré tout, **c'est un fichier à changer** :
`src/page/styles/01-polices.css`. Plus les trois jetons de familles et le jeton
de graisse dans `02-jetons.css`, et les deux `preload` du squelette. Rien
d'autre du site ne nomme une police.

## Licence

Les quatre fichiers sont sous **SIL Open Font License 1.1**, qui autorise
l'usage commercial et la redistribution avec le site. C'est ce qui permet de
livrer ces fichiers à un client sans rien devoir à personne.

- IBM Plex Sans, Sans Condensed, Mono — IBM (Mike Abbink, Bold Monday)

Récupérés en sous-ensemble latin depuis les paquets `@fontsource/ibm-plex-*`,
qui redistribuent les fichiers officiels sans les modifier.

## Remplacer une police

⚠️ **Renommer le fichier.** Ils sont servis avec un cache d'un an et sans numéro
de version (voir `src/server.js`) : remplacer une police sans changer son nom la
laisserait dans le navigateur des visiteurs pendant des mois.

Il faut alors reporter le nouveau nom à deux endroits :
`src/page/styles/01-polices.css` (la déclaration `@font-face`) et
`src/page/index.html` (le `preload`, pour les deux polices du premier écran).

⚠️ **Vérifier la graisse disponible.** Le Condensed n'est livré qu'en 600 : tout
`font-weight: 700` écrit dans le style ferait synthétiser un faux gras par le
navigateur. C'est pour cela que la graisse des titres passe par le jeton
`--g-titre` et n'est écrite nulle part ailleurs.
