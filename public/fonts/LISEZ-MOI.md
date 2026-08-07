# Les polices du site

Quatre fichiers, 57 Ko au total. Ils sont servis par ce site, jamais par Google :
aucune requête ne part chez un tiers pendant une visite, ce qui est une
obligation (la page de confidentialité promet qu'il n'y a aucun traceur) autant
qu'une question de vitesse.

| Fichier | Famille | Graisse | Rôle |
|---|---|---|---|
| `archivo-700.woff2` | Archivo | 700 | les titres, et rien d'autre |
| `sourcesans-400.woff2` | Source Sans 3 | 400 | le texte courant |
| `sourcesans-500.woff2` | Source Sans 3 | 500 | l'appui : citations, valeurs saisies |
| `sourcecode-400.woff2` | Source Code Pro | 400 | toute donnée : tarifs, durées, heures, dates |

Sous-ensemble latin uniquement. Aucune italique : ni fichier, ni synthèse.

## Pourquoi celles-ci

Le choix compte autant que la palette, parce que c'est ce qui date une page le
plus sûrement. Inter, Space Grotesk, Manrope, IBM Plex — surtout Plex Mono —
sont devenues la signature typographique des produits techniques des années
2020. Elles seront lisibles dans cinq ans ; elles diront aussi « fait en 2026 »,
ce qu'on ne veut pas d'un site que le barbier ne refera pas.

Les trois retenues sont antérieures à cette vague et n'appartiennent à aucun
univers de marque :

- **Archivo** — grotesque de presse, dessinée pour les titres de journaux.
  Serrée, robuste, faite pour être lue en grand.
- **Source Sans 3** et **Source Code Pro** — une superfamille dessinée ensemble
  (Paul D. Hunt, Adobe, 2012). Leurs chiffres, leur hauteur d'x et leurs
  proportions s'accordent d'origine : une durée en chasse fixe s'aligne sur le
  texte à côté sans aucun réglage. Source Sans est humaniste là où Archivo est
  néo-grotesque, ce qui donne un contraste réel entre les titres et le texte.

## Licence

Les trois sont sous **SIL Open Font License 1.1**, qui autorise l'usage
commercial et la redistribution avec le site. C'est ce qui permet de livrer ces
fichiers à un client sans rien devoir à personne.

- Archivo — Omnibus-Type
- Source Sans 3, Source Code Pro — Adobe

## Remplacer une police

⚠️ **Renommer le fichier.** Ils sont servis avec un cache d'un an et sans numéro
de version (voir `src/server.js`) : remplacer une police sans changer son nom la
laisserait dans le navigateur des visiteurs pendant des mois.

Il faut alors reporter le nouveau nom à deux endroits :
`src/page/styles/01-polices.css` (la déclaration `@font-face`) et
`src/page/index.html` (le `preload`, pour les deux polices du premier écran).
