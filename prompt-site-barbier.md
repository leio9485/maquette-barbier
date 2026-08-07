# Prompt — Site de démonstration « barbier »

> À coller dans Claude Code, à la racine d'un **nouveau dépôt**.
> Les blocs `[À DÉCIDER]` sont les seuls endroits à ajuster avant de lancer.

---

## 1. Contexte

Je crée des sites internet pour des commerçants locaux (Hauts-de-France, secteur
Bavay / Maubeuge). J'ai déjà une démonstration en ligne : **Studio Cassandre** https://studio-cassandre.onrender.com 
, un salon de coiffure féminin avec tunnel de réservation, espace commerçant et backend
réel (Node/Express + Prisma/SQLite).

Je veux une **seconde démonstration**, destinée aux **barbiers et coiffeurs homme**.
Même niveau de finition, mêmes fonctionnalités, **forme entièrement différente**.

La raison est commerciale, et elle est non négociable : je démarche des commerces
d'une même zone. Si deux boutiques de la même rue reconnaissent le même site sous
deux habillages, je perds les deux. **Un visiteur qui voit les deux démos ne doit
pas pouvoir deviner qu'elles sortent de la même main — sauf au niveau de soin.**

Second objectif : le site doit **tenir 5 ans sans retouche esthétique**. Un barbier
ne refait pas son site tous les deux ans. Tout ce qui date une page (effets de
mode, tendances visuelles du moment) est à écarter, même si c'est joli aujourd'hui.

---

## 2. Le commerce (fictif)

`[À DÉCIDER — à changer si tu as mieux]`

- **Nom** : L'Établi — Barbier
- **Ville** : Bavay (59570)
  *Volontairement différente de Maubeuge, pour que les deux démos ne se croisent
  jamais dans les résultats Google ni chez le même prospect.*
- **Positionnement** : barbier de quartier, travail soigné, sans pose. Pas de
  « barbershop » américain, pas de storytelling inventé, pas de fausse date de
  fondation. Un artisan qui coupe bien et qui ouvre à l'heure.
- **Clientèle** : hommes 20–60 ans, habitués, rendez-vous pris depuis le téléphone,
  souvent le soir ou le week-end.
- **Une équipe de 3 personnes** (pour que la démo montre la gestion multi-agenda).

---

## 3. Périmètre fonctionnel

**Parité complète avec Studio Cassandre.** Rien en moins. C'est le même argument de
vente, il doit tenir de la même façon.

### Vitrine publique
- Accueil / présentation du commerce
- Catalogue de prestations avec durée et tarif, rangeable par catégories
- Équipe (photo, rôle, prestations assurées) — masquée si une seule personne
- Galerie de réalisations
- Avis / témoignages, réglables depuis l'espace commerçant
- Contact : coordonnées, horaires, plan, liens fiche Google et réseaux
- Mentions légales, politique de confidentialité (RGPD)

### Tunnel de réservation
- Choix prestation → date → créneau → coordonnées → confirmation
- Créneaux **calculés par le serveur** (jamais par le navigateur)
- Choix « avec qui ? » intégré à l'étape date/heure, jamais en étape séparée,
  avec « peu importe » présélectionné
- Pas de compte à créer, pas de paiement en ligne (règlement sur place)
- Confirmation avec récapitulatif et jeton d'annulation
- Gestion propre des collisions : créneau pris entre-temps → message clair et retour
  au choix, jamais une erreur brute

### Espace commerçant (derrière identifiant + mot de passe vérifiés côté serveur)
- **Agenda** : vue jour/semaine, colonnes par personne dès 2 actifs, ajout manuel
  d'un rendez-vous téléphonique, annulation, blocage d'une journée, congés sur une
  période, absence d'une personne
- **Réglages** : coordonnées, horaires par jour avec pause, prestations (ajout,
  ordre, mise en pause, catégories), équipe (photo, horaires particuliers,
  prestations assurées), avis, liens externes
- Brouillon non enregistré signalé, annulation possible, réinitialisation
- Déconnexion réelle côté serveur

### Non-fonctionnel
- Responsive du téléphone au grand écran, **conçu mobile d'abord** (un barbier
  reçoit l'essentiel de son trafic depuis un téléphone)
- Accessibilité WCAG AA : contrastes vérifiés, navigation clavier, focus visible
- SEO local : title/description par page, JSON-LD `HairSalon`, `sitemap.xml`,
  `robots.txt`, Open Graph
- RGPD : pas de traceur tiers, données minimales, mentions et durées de conservation
- Performance : LCP < 2 s en 4G, pas de framework, pas de police lourde
- Tests automatisés sur la logique de disponibilité et l'API (le calcul de créneaux
  est l'endroit où un bug coûte un client réel)

---

## 4. Direction artistique

C'est le cœur du travail. **Le reste est de la plomberie, ceci est le produit.**

### 4.1 Ce qu'il faut fuir

Deux listes, aussi importantes l'une que l'autre.

**Les clichés du barbier** — c'est ce que font tous les concurrents, donc c'est
exactement ce qui ne différencie pas :
- noir + or, noir + rouge, enseigne tricolore tournante
- textures « vieilli », papier craft, effet cuir, planches de bois
- typographies western / tatouage / craie / script « Barber Shop »
- photos de banque d'images : barbe hipster, rasoir en gros plan sur fond noir
- fausse ancienneté (« Est. 1923 »), lettrage doré, blasons, ciseaux croisés
- vocabulaire « gentleman », « grooming », « bespoke »

**Les tics visuels qui datent une page** (ils vieillissent en 18 mois) :
- dégradés de fond, texte en dégradé, halos néon
- verre dépoli / glassmorphism, neumorphisme, ombres portées diffuses
- grands rayons d'arrondi, cartes flottantes empilées
- parallaxe, animations d'apparition sur chaque bloc, compteurs animés
- emoji dans l'interface, packs d'icônes génériques
- mode sombre « cyber » avec accent vert acide

**Et la contrainte de différenciation** : rien de ce qui fait la signature de Studio
Cassandre. Pas d'ivoire, pas de prune, pas de doré, pas de titre en serif italique,
pas de sections centrées avec sur-titre en petites capitales, pas de grille de
cartes de prestations.

### 4.2 La direction retenue : **atelier**

Le monde de référence n'est pas le « barbershop », c'est **l'atelier d'artisan** :
l'établi, l'outil rangé, le bleu de travail, la fiche de travail, l'heure affichée
à la porte. Sobre, utile, propre. Ça vieillit bien parce que ça n'a jamais été à la
mode.

**Palette — 5 valeurs, pas une de plus**

| Variable | Hex | Usage |
|---|---|---|
| `--encre` | `#16191B` | texte principal, aplats sombres |
| `--bleu-travail` | `#24405C` | couleur d'action : boutons, liens, états actifs |
| `--craie` | `#EFEEEA` | fond principal |
| `--acier` | `#6E7679` | texte secondaire, filets, séparateurs |
| `--vert-signal` | `#3F6B52` | uniquement les états positifs (confirmé, disponible) |

Aucun doré, aucun terracotta, aucun ocre. Le bleu de travail est la seule couleur
saturée de la page — c'est ce qui la rend reconnaissable.

**Typographie — 3 rôles**

- **Titres** : `Archivo`, graisse 600–700, en capitales, interlettrage resserré.
  Utilisée avec parcimonie, en gros corps, jamais en italique.
- **Texte** : `IBM Plex Sans`, 400/500. Neutre, très lisible en petit.
- **Chiffres** : `IBM Plex Mono` pour **tout ce qui est une donnée** — tarifs,
  durées, horaires, créneaux, dates, numéro de téléphone.

Ce dernier point n'est pas décoratif : dans un site de réservation, les chiffres
*sont* le contenu. Les mettre en chasse fixe les aligne en colonnes, les rend
lisibles d'un coup d'œil, et donne à la page son caractère sans ajouter un seul
ornement.

**Mise en page**

- Grille asymétrique, contenu **aligné à gauche**, jamais centré.
- Une colonne latérale étroite (le « rail ») porte les repères de section ; le
  contenu occupe le reste. Sur mobile, le rail devient une ligne d'en-tête.
- **Angles droits.** Rayon 0 partout, 2 px maximum sur les champs de saisie.
- Pas d'ombre portée. La hiérarchie se fait par **aplats de couleur pleins** et par
  les blancs, pas par des cartes qui flottent.
- Blocs de section pleine largeur qui alternent craie / encre / bleu, bords francs.
- Beaucoup d'air. Une direction épurée se juge sur les espacements : établis une
  échelle stricte (par ex. 8 / 16 / 24 / 40 / 64 / 96) et n'en sors jamais.

**Photographie**

Noir et blanc contrasté. Matières et gestes : mains au travail, outils posés,
lumière de fenêtre. Pas de portrait souriant face caméra, pas de pose. Une seule
photo forte vaut mieux que six moyennes. Prévois les emplacements et un cadrage
imposé (ratio fixe, `object-fit: cover`) pour que les photos du vrai client, plus
tard, ne cassent pas la page.

**Mouvement**

Presque rien. Transitions de 150 ms sur les états interactifs, c'est tout. Aucune
apparition au défilement, aucune parallaxe. `prefers-reduced-motion` respecté.
L'immobilité fait partie du sérieux.

### 4.3 L'élément signature

**Le bandeau d'état, en haut de chaque page.**

Une bande étroite, en chasse fixe, qui affiche la vérité du moment, tirée du même
calcul de disponibilité que le tunnel :

```
OUVERT · FERME À 19H00 · PROCHAIN CRÉNEAU AUJOURD'HUI 16H45      [ RÉSERVER ]
```

et le soir :

```
FERMÉ · OUVRE DEMAIN 9H00 · PROCHAIN CRÉNEAU DEMAIN 9H30         [ RÉSERVER ]
```

C'est là que passe toute l'audace du site, et nulle part ailleurs. C'est justifiable
sur trois plans :
- **usage** : la question qu'un client se pose en arrivant sur la page d'un barbier,
  c'est « je peux venir quand ? ». Il a la réponse avant d'avoir défilé.
- **vente** : ça démontre en trois secondes qu'il y a un vrai serveur derrière, pas
  une page figée. C'est mon meilleur argument face à Planity.
- **durée** : une information utile ne se démode pas.

Il doit se dégrader proprement : si le serveur ne répond pas, le bandeau affiche les
horaires d'ouverture du jour et rien de plus, sans erreur visible.

**Second détail, plus discret** : le récapitulatif du tunnel et la confirmation
prennent la forme d'une **fiche de travail** — intitulés à gauche, valeurs en mono à
droite, filet horizontal entre chaque ligne. Le vocabulaire de l'atelier, appliqué
là où il sert vraiment.

### 4.4 Ton des textes

Phrases courtes, voix active, minuscules après la première lettre (pas de titres en
Capitales À Chaque Mot). On dit ce que le bouton fait : « Réserver ce créneau », pas
« Continuer ». Les messages d'erreur disent ce qui s'est passé et quoi faire, sans
s'excuser. Pas d'adjectifs de vente (« expérience unique », « sur-mesure »). Écris
tous les textes toi-même, ne laisse aucun lorem ipsum ni aucun texte marqué « à
compléter » visible.

---

## 5. Technique

`[À DÉCIDER — c'est ma recommandation, pas une obligation]`

**Repartir du serveur de Studio Cassandre, réécrire toute la façade.**

- **Repris tel quel** : Express, Prisma/SQLite, authentification serveur (scrypt),
  sessions, `requireAdmin`, calcul de disponibilité, en-têtes de sécurité et nonces
  CSP, limitation de débit, suite de tests.
  C'est du travail déjà payé, invisible du visiteur, et c'est la partie où un bug
  coûte cher. La recopier serait de la coquetterie.
- **Réécrit intégralement, sans rien reprendre** : `src/page/` en entier — toutes les
  feuilles de style, tous les blocs de vitrine, tout le rendu JavaScript. Pas de
  reprise de classes CSS, pas de reprise de structure de section, pas de reprise de
  formulations. On repart de la page blanche.
- **À adapter côté serveur** : `defaults.js` (catalogue barbier), `llms.txt`, le
  JSON-LD, les noms visibles, les textes d'e-mail éventuels.

Contraintes conservées : **pas de framework, pas d'étape de build**, HTML/CSS/JS
vanilla, une seule page pour le visiteur. C'est ce qui rend le site maintenable
seul, rapide, et transférable à un client sans dépendance qui pourrit.

`DEMO_MODE=true` avec un compte de démonstration affiché sur l'écran de connexion,
comme sur Studio Cassandre. Déploiement visé : Koyeb, région Francfort.

---

## 6. Catalogue de démonstration

À écrire dans `defaults.js`. Tarifs cohérents avec le secteur (Avesnois / Sambre).

**Coupe**
- Coupe homme — 25 min — 18 €
- Coupe + shampooing — 35 min — 22 €
- Coupe enfant (–12 ans) — 20 min — 14 €
- Coupe à la tondeuse — 15 min — 13 €

**Barbe**
- Taille de barbe — 20 min — 12 €
- Barbe à la serviette chaude — 30 min — 18 €
- Rasage traditionnel au coupe-chou — 40 min — 25 €
- Contours (nuque et tempes) — 10 min — 8 €

**Forfaits**
- Coupe + barbe — 45 min — 28 €
- Coupe + rasage traditionnel — 60 min — 40 €
- Père et fils — 45 min — 30 €

**Soins**
- Coloration barbe — 30 min — 20 €
- Soin du visage express — 25 min — 22 €

Trois barbiers, horaires réalistes : fermé dimanche et lundi, nocturne le vendredi,
samedi en journée continue. Donne à l'un des trois un horaire différent du commerce
(pour que la fonctionnalité « horaires particuliers » se voie dans la démo).

---

## 7. Méthode de travail

1. **Avant d'écrire une ligne de code**, produis un plan de conception court :
   palette retenue, échelle typographique complète (corps, graisses, interlignes),
   échelle d'espacement, croquis ASCII de la mise en page de l'accueil et du tunnel.
   Relis-le contre la section 4 : si un élément est ce que tu aurais produit pour
   n'importe quel site de commerçant, remplace-le et dis pourquoi. **Attends ma
   validation sur ce plan avant de construire.**
2. Ensuite : structure et style de la vitrine, puis le tunnel, puis l'espace
   commerçant, puis les contrôles qualité.
3. Vérifie à l'écran, pas seulement dans le code : rends la page en 390 px, 768 px
   et 1440 px avant de considérer une section terminée.

---

## 8. Critères d'acceptation

- [ ] Les deux démos posées côte à côte : **aucun élément visuel commun**. Ni
      palette, ni police, ni structure de section, ni forme de bouton, ni tournure
      de phrase.
- [ ] Le bandeau d'état affiche une disponibilité réelle, issue du serveur.
- [ ] Une réservation complète aboutit depuis un téléphone, en moins de 45 secondes,
      sans zoom ni défilement horizontal.
- [ ] L'espace commerçant permet d'ajouter un rendez-vous, de bloquer un jour et de
      modifier une prestation, sans jamais quitter la page.
- [ ] Contrastes AA vérifiés sur chaque couple de couleurs employé, y compris le
      texte discret et les états désactivés.
- [ ] Aucun dégradé, aucune ombre portée, aucun rayon supérieur à 2 px, aucune
      animation au défilement dans le rendu final.
- [ ] Aucun texte de remplissage, aucune image de banque d'images reconnaissable.
- [ ] Lighthouse : performance et accessibilité au-dessus de 95 sur mobile.

---

## 9. Ce que j'attends de toi maintenant

Commence par l'étape 1 de la section 7 : le plan de conception. Pose-moi les
questions qui bloquent réellement, pas plus de trois, et propose un défaut pour
chacune.
