# Plan de conception — L'Établi, barbier (Bavay)

Étape 1 de la section 7 du brief. À valider avant toute ligne de code.

---

## 1. Jetons de couleur

### 1.1 Contrastes vérifiés (WCAG 2.1, fond craie `#EFEEEA`)

| Jeton | Hex | Sur craie | Sur encre | Emploi |
|---|---|---|---|---|
| `--encre` | `#16191B` | **15,2:1** ✓ | — | texte principal, aplats sombres |
| `--bleu-travail` | `#24405C` | **9,2:1** ✓ | 1,7:1 ✗ | action : boutons, liens, états actifs |
| `--craie` | `#EFEEEA` | — | **15,2:1** ✓ | fond principal, texte sur aplat sombre |
| `--acier` | `#656D70` | **4,55:1** ✓ | 3,3:1 ✗ | texte secondaire sur craie |
| `--acier-clair` | `#8E9699` | 2,6:1 ✗ | **5,9:1** ✓ | texte secondaire sur encre / bleu |
| `--vert-signal` | `#3F6B52` | **5,3:1** ✓ | 2,9:1 ✗ | états positifs sur craie |
| `--vert-clair` | `#6E9F80` | 2,6:1 ✗ | **5,8:1** ✓ | états positifs sur encre / bleu |
| `--filet` | `#C9C7C1` | 1,7:1 | — | séparateurs 1 px uniquement, jamais de texte |

### 1.2 Deux écarts assumés au brief, à valider

**a) L'acier passe de `#6E7679` à `#656D70`.** La valeur d'origine donne 3,99:1 sur
craie : elle échoue au AA pour du texte courant, et le critère d'acceptation exige
des contrastes vérifiés « y compris le texte discret ». Le décalage est invisible à
l'œil, la teinte est identique.

**b) L'acier et le vert existent en deux valeurs, une par fond.** Sur les blocs
encre et bleu, les valeurs d'origine tombent à 2,9–3,3:1. Ce sont deux déclinaisons
de la même teinte, pas deux couleurs de plus — la page reste à cinq couleurs
perçues. Alternative si tu veux la contrainte au sens strict : on s'interdit tout
texte secondaire et tout état vert sur les blocs sombres. C'est tenable mais ça
appauvrit le bandeau d'état, qui est justement l'endroit où le vert sert.

### 1.3 Règle des boutons

Le bouton d'action prend toujours la couleur qui contraste avec **son** fond :

- sur craie → fond `--bleu-travail`, texte `--craie` (9,2:1)
- sur encre ou sur bleu → fond `--craie`, texte `--encre` (15,2:1)

Le bleu sur encre donne 1,7:1 : un bouton bleu dans le bandeau serait un rectangle
invisible. Cette règle est aussi ce qui évite le liseré décoratif.

Aucun doré, aucun terracotta, aucun ocre, aucun dégradé, aucune ombre.

---

## 2. Typographie

### 2.1 Familles et fichiers

Auto-hébergées, woff2, sous-ensemble latin + accents français, `font-display: swap`,
`size-adjust` sur les substituts pour tuer le décalage de mise en page.

| Rôle | Famille | Graisses | Fichiers |
|---|---|---|---|
| Titres | Archivo | 700 | 1 |
| Texte | IBM Plex Sans | 400, 500 | 2 |
| Données | IBM Plex Mono | 400 | 1 |

Quatre fichiers, ~100 Ko au total, deux préchargés (Archivo 700, Plex Sans 400).
IBM Plex Mono 500 est écarté : l'emphase en chasse fixe se fait par la couleur et le
corps, pas par la graisse. C'est 28 Ko et une requête en moins sur le chemin du LCP.

### 2.2 Échelle

Fluide entre 390 px et 1440 px. Interlignes serrés en haut de l'échelle, larges en
bas — c'est ce qui fait respirer une page sans ornement.

| Jeton | Famille / graisse | Corps (mob → desk) | Interligne | Interlettrage | Emploi |
|---|---|---|---|---|---|
| `--t-display` | Archivo 700, capitales | 32 → 56 px | 1,00 | −0,02 em | titre d'accueil, une fois par page |
| `--t-section` | Archivo 700, capitales | 24 → 36 px | 1,08 | −0,01 em | titres de section |
| `--t-sous` | Archivo 700, capitales | 18 px fixe | 1,25 | 0 | intitulés de bloc, nom d'un barbier |
| `--t-intro` | Plex Sans 400 | 18 → 20 px | 1,50 | 0 | phrase d'ouverture |
| `--t-texte` | Plex Sans 400 | 16 → 17 px | 1,60 | 0 | courant, mesure max 66 caractères |
| `--t-appui` | Plex Sans 500 | 16 → 17 px | 1,60 | 0 | citations d'avis, valeurs en formulaire |
| `--t-petit` | Plex Sans 400 | 14 px fixe | 1,50 | 0 | mentions, aides de champ |
| `--t-donnee` | Plex Mono 400, chiffres tabulaires | 16 → 17 px | 1,40 | 0 | tarifs, durées, heures, dates, téléphone |
| `--t-etiquette` | Plex Mono 400, capitales | 13 px fixe | 1,20 | +0,06 em | rail, bandeau d'état, en-têtes de colonne |

Archivo n'apparaît **jamais** en italique et jamais sous 18 px. Tout ce qui est une
donnée passe en mono, sans exception : c'est la règle qui donne son caractère à la
page, elle ne souffre pas de cas particulier.

---

## 3. Échelle d'espacement

Six valeurs, aucune autre. `--e1 8` `--e2 16` `--e3 24` `--e4 40` `--e5 64` `--e6 96`.

- Padding vertical de section : `--e5` en mobile, `--e6` à partir de 768 px.
- Entre blocs d'une même section : `--e3` mobile, `--e4` desktop.
- Entre lignes d'une liste tarifaire : `--e2` de padding + 1 px de filet.
- Gouttière du rail : `--e4`.
- Marges latérales : `--e3` mobile, `--e4` à 768, `--e5` à 1120.

Rien sous 8 px n'est un espacement : les écarts plus fins sont produits par les
interlignes et par la hauteur fixe des contrôles (48 px mobile, 44 px desktop, pour
la cible tactile).

Ruptures : 390 (base), 768 (le rail devient colonne, contenu sur 2 colonnes),
1120 (rail à sa largeur pleine), conteneur plafonné à 1320 px.

Rayons : 0 partout. 2 px sur les champs de saisie uniquement.
Mouvement : `transition: 150ms` sur `background-color`, `border-color`, `color`.
Rien d'autre bouge nulle part. `prefers-reduced-motion` coupe même ces 150 ms.

---

## 4. Mise en page — accueil (desktop ≥ 1120 px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ OUVERT · FERME À 19H00 · PROCHAIN CRÉNEAU AUJOURD'HUI 16H45 [RÉSERVER] │ encre, mono 13, 44px, collé en haut
├──────────┬─────────────────────────────────────────────────────────────┤
│          │ L'ÉTABLI              prestations   équipe   galerie  contact│ craie
│          ├─────────────────────────────────────────────────────────────┤
│ 01       │                                                             │
│ ACCUEIL  │ BARBIER À BAVAY,                                            │ Archivo 56, aligné gauche
│          │ RUE DE LA GARE                                              │
│          │                                                             │
│          │ Coupe, barbe, rasage. Trois barbiers, du mardi au samedi.   │ intro 20
│          │                                                             │
│          │ ┌──────────────────────┐  03 27 00 00 00                    │
│          │ │ RÉSERVER UN CRÉNEAU  │  12 rue de la Gare, 59570 Bavay    │ mono
│          │ └──────────────────────┘                                    │
├──────────┴─────────────────────────────────────────────────────────────┤
│                                                                        │
│              photo noir et blanc, pleine largeur, 21:9                 │ aucun texte par-dessus
│                                                                        │
├──────────┬─────────────────────────────────────────────────────────────┤
│ 02       │ PRESTATIONS                                                 │ craie
│ PRESTA-  │                                                             │
│ TIONS    │ COUPE ───────────────────────────────────────────────────── │ mono 13, filet
│          │ Coupe homme                                  25 min   18 €  │ ← ligne cliquable, 56px
│          │ ─────────────────────────────────────────────────────────── │
│          │ Coupe + shampooing                           35 min   22 €  │
│          │ ─────────────────────────────────────────────────────────── │
│          │ Coupe enfant (–12 ans)                       20 min   14 €  │
│          │ ─────────────────────────────────────────────────────────── │
│          │ BARBE ───────────────────────────────────────────────────── │
│          │ Taille de barbe                              20 min   12 €  │
│          │ ...                                                         │
├──────────┼─────────────────────────────────────────────────────────────┤
│ 03       │ ÉQUIPE                                                      │ ENCRE, pleine largeur
│ ÉQUIPE   │ ┌────────┐ RÉMI                                             │ texte craie
│          │ │ photo  │ Coupe, barbe, rasage au coupe-chou               │
│          │ │  1:1   │ mardi → samedi                                   │ mono, acier-clair
│          │ └────────┘                                                  │
│          │ ─────────────────────────────────────────────────────────── │
│          │ ┌────────┐ KARIM ...                                        │
├──────────┼─────────────────────────────────────────────────────────────┤
│ 04       │ GALERIE      4 photos 3:4, gouttière 8px, bord à bord       │ craie
├──────────┼─────────────────────────────────────────────────────────────┤
│ 05       │ AVIS         3 citations, appui 17 · prénom + mois en mono  │ encre
├──────────┼─────────────────────────────────────────────────────────────┤
│ 06       │ HORAIRES ET ADRESSE                                         │ BLEU, texte craie
│ CONTACT  │ mardi      09:00 – 12:00   14:00 – 19:00 │ ┌──────────────┐ │
│          │ mercredi   09:00 – 12:00   14:00 – 19:00 │ │ plan dessiné │ │ SVG, aucun service tiers
│          │ jeudi      09:00 – 12:00   14:00 – 19:00 │ │  en interne  │ │
│          │ vendredi   09:00 – 12:00   14:00 – 21:00 │ └──────────────┘ │
│          │ samedi     08:30 – 17:00                 │ Ouvrir dans Maps │
│          │ dim. lun.  fermé                         │                  │
├──────────┴─────────────────────────────────────────────────────────────┤
│ mentions légales · confidentialité · 03 27 00 00 00                    │ encre, petit
└────────────────────────────────────────────────────────────────────────┘
```

Sous 768 px : le rail disparaît en colonne et devient une ligne d'en-tête
`02 · PRESTATIONS` en mono 13 au-dessus du titre de section. Le bandeau d'état passe
sur deux lignes si nécessaire, le bouton reste à droite, toujours atteignable au
pouce. Rien d'autre ne change : la page est déjà en une colonne alignée à gauche.

---

## 5. Mise en page — tunnel de réservation (mobile 390 px)

Quatre étapes, une seule page, l'état dans l'URL pour que le retour arrière marche.

```
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│ OUVERT · PROCHAIN CRÉNEAU 16H45  │   │ 02 / 04 · DATE ET HEURE          │
├──────────────────────────────────┤   ├──────────────────────────────────┤
│ 01 / 04 · PRESTATION             │   │ Coupe + barbe   45 min    28 €   │ ← fiche repliée, mono
├──────────────────────────────────┤   │ ──────────────────────────────── │
│ COUPE                            │   │ AVEC QUI                         │
│ Coupe homme      25 min   18 €  ›│   │ (•) peu importe                  │ présélectionné
│ ──────────────────────────────── │   │ ( ) Rémi   ( ) Karim   ( ) Yanis │
│ Coupe + shamp.   35 min   22 €  ›│   │ ──────────────────────────────── │
│ ──────────────────────────────── │   │ ‹  SEPTEMBRE 2026  ›             │
│ Coupe enfant     20 min   14 €  ›│   │ L  M  M  J  V  S  D              │ mono
│ ──────────────────────────────── │   │       1  2  3  4  5              │
│ BARBE                            │   │  7  8  9 10 11 12 13             │ fermés = acier, non cliquables
│ Taille de barbe  20 min   12 €  ›│   │ ──────────────────────────────── │
│ ...                              │   │ JEUDI 10 SEPTEMBRE               │
│                                  │   │ ┌──────┐┌──────┐┌──────┐         │
│                                  │   │ │ 9:00 ││ 9:45 ││10:30 │         │ 48px, mono
│                                  │   │ └──────┘└──────┘└──────┘         │ choisi = aplat bleu
│                                  │   │ ┌──────┐┌──────┐                 │
│                                  │   │ │14:00 ││16:45 │                 │
└──────────────────────────────────┘   └──────────────────────────────────┘

┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│ 03 / 04 · VOS COORDONNÉES        │   │ 04 / 04 · C'EST RÉSERVÉ          │ pastille verte
├──────────────────────────────────┤   ├──────────────────────────────────┤
│ Prénom et nom                    │   │ FICHE DE TRAVAIL                 │
│ ┌──────────────────────────────┐ │   │ Prestation      Coupe + barbe    │
│ └──────────────────────────────┘ │   │ ──────────────────────────────── │
│ Téléphone                        │   │ Durée                   45 min   │
│ ┌──────────────────────────────┐ │   │ ──────────────────────────────── │
│ └──────────────────────────────┘ │   │ Avec                      Rémi   │
│ E-mail (facultatif)              │   │ ──────────────────────────────── │
│ ┌──────────────────────────────┐ │   │ Quand      jeu. 10 sept. 16:45   │
│ └──────────────────────────────┘ │   │ ──────────────────────────────── │
│                                  │   │ À régler sur place         28 €  │
│ FICHE DE TRAVAIL                 │   │ ──────────────────────────────── │
│ Coupe + barbe                    │   │ Référence               8FK2QD   │
│ jeu. 10 sept. 16:45 · Rémi · 28 €│   │                                  │
│ ┌──────────────────────────────┐ │   │ ┌──────────────────────────────┐ │
│ │ RÉSERVER CE CRÉNEAU          │ │   │ │ ANNULER CE RENDEZ-VOUS       │ │ bordure, pas d'aplat
│ └──────────────────────────────┘ │   │ └──────────────────────────────┘ │
└──────────────────────────────────┘   └──────────────────────────────────┘
```

Le compteur `02 / 04` est en mono dans le rail (desktop) ou en ligne d'en-tête
(mobile). Pas de barre de progression, pas de ronds numérotés reliés par un trait.

Collision de créneau : le serveur refuse, on revient à l'étape 2 avec la date déjà
chargée et un message en ligne sur aplat encre — « Ce créneau vient d'être pris.
Voici ce qui reste jeudi 10. » Jamais de fenêtre modale, jamais d'erreur brute.

Bandeau d'état dégradé : si l'appel échoue, il affiche les horaires du jour issus du
rendu serveur et rien de plus. Aucun état d'erreur visible, aucun squelette animé.

---

## 6. Relecture contre la section 4 — ce que j'ai retiré

Chaque ligne est un réflexe que j'aurais eu sur n'importe quel site de commerçant.

| Réflexe écarté | Remplacé par | Pourquoi |
|---|---|---|
| Grille de cartes de prestations | Liste tarifaire en lignes, filets 1 px, prix en mono à droite | C'est la signature de Studio Cassandre, et une carte a besoin d'une ombre ou d'un rayon pour exister — les deux sont interdits |
| Bandeau d'accueil avec texte sur photo | Titre sur craie, photo en bloc séparé | Le texte sur image ne tient jamais le AA, et c'est le geste le plus vu du web local |
| Trois colonnes de « réassurance » à pictos | Le tableau des horaires réels | Un pack d'icônes date une page et ne dit rien ; les horaires sont ce qu'on cherche |
| Carte Google intégrée | Plan dessiné en SVG + lien « ouvrir dans Maps » | Un iframe Maps est un traceur tiers, interdit par la section 3 |
| Stepper à ronds numérotés et barre de progression | Compteur `02 / 04` en mono dans le rail | Le compteur dit la même chose sans un seul pixel de décoration |
| Visionneuse d'images au clic | Rien : les photos sont déjà à leur taille utile | Du JavaScript et un fond noir en plus pour un gain nul |
| Notifications flottantes | Messages dans le flux, sur aplat pleine largeur | Une bulle qui flotte a besoin d'une ombre, et disparaît avant d'être lue |
| Étoiles ★★★★★ sur les avis | Citation + prénom + mois, en mono | Une note inventée sur une démo est un mensonge, et les étoiles sont un pack d'icônes |
| Bouton « Continuer » | « Réserver ce créneau », « Voir les horaires du jeudi » | Le brief l'impose, et un libellé explicite supprime l'hésitation sur mobile |
| Compteur animé « + de 2000 clients » | Rien | Invérifiable, et c'est un tic qui vieillit en 18 mois |

Ce qui reste d'audacieux tient en un seul endroit : le bandeau d'état. Tout le reste
est de la mise en page nue. C'est délibéré — c'est la condition pour que le site
tienne cinq ans.

---

## 7. Ordre de construction

1. Jetons CSS, polices, grille, contrôles de base (bouton, champ, filet, lien).
2. Bandeau d'état branché sur le calcul de disponibilité réel, avant toute vitrine —
   c'est l'élément signature, il ne doit pas être ajouté à la fin.
3. Vitrine, section par section, rendue en 390 / 768 / 1440 avant de passer à la
   suivante.
4. Tunnel, jusqu'à la fiche de confirmation.
5. Espace commerçant (agenda, réglages).
6. Contrôles : contrastes, navigation clavier, JSON-LD, sitemap, Lighthouse mobile.
```
