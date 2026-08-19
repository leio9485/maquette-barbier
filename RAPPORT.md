# RAPPORT — L'Établi, de « très bonne démo » à produit vendable

Ce document rend compte du travail demandé. Il est écrit pour être relu lot par
lot, et il dit aussi ce qui n'a **pas** été fait.

**Référence de départ : 401 tests, 0 échec. Aujourd'hui : 634 tests, 0 échec.**

Ordre d'exécution, tel que vous l'avez demandé : audit (phase 0), lot 1, puis
l'infrastructure de notifications avec le SMS écrit mais éteint, puis les lots
3, 4, 5 et 6. **Le lot 2 (envoi d'email réel, rappel J-1) n'a pas été fait** —
c'est votre décision, rappelée au point 5.

---

## 1. Les réponses de la phase 0

L'audit complet est dans [AUDIT.md](AUDIT.md). Résumé, avec les corrections que
la suite a apportées.

**1. La référence `MQJYBK`** était une dérivation du `cancelToken` calculée dans
le navigateur : six premiers caractères alphanumériques, **mis en capitales**.
Cette capitalisation la rendait **non inversible** — « FVLJ8U » pouvait venir de
trente-deux jetons différents. Entropie 30,7 bits, non uniformes. Ni stockée, ni
indexée. → *Corrigée au lot 1 : colonne dédiée, indexée, tirée par le serveur.*

**2. Le `cancelToken` de 32 octets** était bien engendré, bien stocké, bien
`@unique`, transmis une seule fois. Il était correct ; il ne survivait qu'en
mémoire vive.

**3. `DELETE /api/bookings/:id?token=`** existait et fonctionnait (testé de bout
en bout). **Une seule route du serveur était limitée en débit : `POST
/api/login`.** → *Le lot 1 a ajouté un compteur strict sur les routes
d'annulation ; `POST /api/bookings` a reçu les siens après le lot 6 — voir
ci-dessous.*

**4. Aucun email.** Zéro occurrence de `nodemailer`/`smtp`/`sendMail` dans le
dépôt. `customerEmail` était écrit en base et plus jamais relu.

**5. Rendu serveur vs JavaScript.** L'audit externe avait raison sur Équipe, le
tunnel et le choix du barbier. S'y ajoutaient, non relevés : les horaires, les
liens sociaux, le plan, et **toutes les images** (aucun `src` avant exécution du
JS). → *Le lot 5 a mis la galerie dans le HTML servi. L'équipe et le tunnel y
restent absents — voir le point 5.*

**6. L'espace commerçant** était servi à tous. Mesuré : **58 154 octets sur
164 244, soit 35,4 % du DOM**. → *Corrigé au lot 4.*

**7. Les captures blanches : `overflow-x: clip` sur `<html>`.** Le suspect
nommé par la mission — une animation d'apparition au défilement — **n'existe pas
dans ce projet** : zéro `content-visibility`, zéro `contain`, zéro
`IntersectionObserver`, zéro `@keyframes`. → *Corrigé au lot 5 par
`overflow-clip-margin: 100vh`.*

### Deux points où l'audit externe se trompait

- **`sitemap.xml` : la route existait déjà.** Le 404 venait de
  `Boolean(PUBLIC_URL) && !DEMO_MODE`, pas d'une absence de code.
- **Le point 5.7 décrivait un repli d'animation au défilement.** Ce site n'en a
  aucune. La correction était ailleurs.

---

## 2. Lot par lot

### Notifications — l'infrastructure, et le SMS écrit mais éteint

`src/lib/notifications.js`. Tout ce que le site enverra passe par `notifier()`.
Deux canaux, aucun actif.

| Canal | État |
|---|---|
| `email` | point d'insertion. Le message est journalisé `[EMAIL NON IMPLÉMENTÉ]`. |
| `sms` | **écrit et testé, éteint.** Appelle vraiment l'API de Twilio. |

**Le SMS fonctionne réellement** : lancé avec de faux identifiants, Twilio a
répondu `401 — Authentication Error`. Le chemin va donc jusqu'au bout. Il ne
s'allume que si `SMS_ACTIF=true` **et** que les trois identifiants sont posés —
quatre variables, ce qui ne se pose pas par accident.

**Aucune dépendance ajoutée.** Le paquet `twilio` tire une cinquantaine de
modules pour ce qui tient en une requête HTTP avec authentification Basic. Le
projet en compte toujours quatre.

**Le plafond mensuel est dur.** Le compteur (`NotificationCounter`) est
incrémenté **avant** l'envoi, dans une transaction : compter après coup
laisserait deux envois simultanés voir tous deux « il reste une unité ». Un
envoi qui échoue rend son unité. Les refus sont comptés à part — c'est cette
colonne qui dira au commerçant qu'il manque des rappels.

**Bogue attrapé en le testant :** `Number(x) || 200` ignorait
`SMS_PLAFOND_MOIS=0` — la façon la plus évidente de dire « aucun envoi »
laissait passer deux cents SMS.

*Fichiers : `src/lib/notifications.js`, `src/config.js`, `.env.example`,
migration `20260810000000_notifications`.*

### Lot 3 — L'espace commerçant devient un tableau de bord

**Onglet « Chiffres », en premier** — mais l'agenda reste le volet par défaut.
Les chiffres sont en tête parce que c'est ce qu'un prospect cherche ; l'agenda
s'ouvre parce que c'est ce qu'on regarde vingt fois par jour une fois client.

Trois décisions de calcul changent ce que les chiffres veulent dire :

- **Le remplissage se compte en minutes, pas en créneaux.** Les compter tous
  pour « un créneau » donnerait un taux qui *monte* quand le barbier fait des
  prestations courtes. Le dénominateur est le temps réellement ouvert, personne
  par personne, congés et journées bloquées déduits — sans quoi le taux
  s'effondrerait chaque mois d'août.
- **Le taux d'absence porte sur ce qui a été pointé**, pas sur ce qui est passé.
  Un commerçant qui ne coche rien doit lire qu'il n'a rien pointé, pas « 0 % ».
- **L'écart avec le mois précédent vaut « — » quand ce mois était vide.**
  « +100 % » depuis zéro ne veut rien dire ; « 0 % » serait un mensonge.

**Suivi des no-shows** : deux boutons sur les rendez-vous passés, marqueur
discret à partir de deux absences, côté commerçant seulement. **Aucune
conséquence automatique** — rien n'est bloqué, aucun acompte, rien de visible
depuis la vitrine. Retour en arrière d'un clic : le cas le plus fréquent d'un
pointage est le clic à côté.

**Export CSV**, deux fichiers. **UTF-8 avec BOM et séparateur point-virgule** :
sans les deux, Excel français affiche « RÃ©mi » et met tout dans une colonne. Le
test vérifie le BOM **sur les octets** — `Response.text()` le retire en
décodant, un test écrit sur la chaîne passerait au vert sans lui.

**Le lien Google devient deux réglages**, et l'aide explique la différence : la
fiche, qu'on *lit*, et l'adresse qui *ouvre* la fenêtre d'avis.

*Fichiers : `src/lib/statistiques.js`, `src/routes/tableaudebord.js`,
`src/page/js/10-chiffres.js`, `src/page/styles/17-chiffres.css`,
`tests/chiffres.mjs`, migration `20260810120000_chiffres_et_presence`.*

### Lot 4 — L'espace commerçant sort de la vitrine

| | avant | après |
|---|---:|---:|
| DOM de la vitrine | 164 244 | **120 156** octets (−26,8 %) |
| page servie | 156 493 | **112 500** octets (−28,1 %) |
| `/espace-salon` | — | 94 498 |
| `/annuler` | — | 30 441 |

Trois blocs de style servaient aux deux vues et vivaient dans une feuille propre
à l'une d'elles ; ils sont remontés dans `05-controles.css`. `afficherMessage()`
quitte le tunnel pour les utilitaires. Chaque état reste chez lui : `RESERVATION`
dans le tunnel, `ESPACE` dans `js/espace/etat.js`, **l'API d'administration dans
`js/espace/donnees.js`** — la vitrine publiait la liste complète des adresses
`/api/admin/…`.

**L'entrée publique disparaît hors démonstration, et elle est retirée du
document, pas masquée** : un lien caché reste dans la source.

`robots.txt` écarte `/espace-salon` et `/annuler` ; les deux portent en plus
`X-Robots-Tag: noindex`, **sans dépendre de `DEMO_MODE`**. `Disallow` interdit de
lire, ce qui n'empêche pas l'adresse de figurer dans les résultats sans
description : les deux sont complémentaires. Et `noindex` n'est pas un contrôle
d'accès — ce qui protège l'agenda reste `requireAdmin`.

*Fichiers : `src/page/espace.html`, `src/page/js/espace/*`,
`src/lib/assemblage.js`, `src/lib/page.js`, `src/server.js`, `tests/espace.mjs`.*

### Lot 5 — SEO, accessibilité, données structurées

**Un seul `<h1>`** — le second était l'écran de connexion, parti au lot 4. Un
test l'interdit désormais pour les trois documents.

**Les images.** Cinq sur six portaient `alt=""`. Chacune a sa description, et la
galerie passe en `<figure>` + `<figcaption>`. **La description décrit l'image,
elle ne répète pas la légende** — un test compare les deux et refuse qu'elles
coïncident. Le commerçant écrit les siennes depuis les réglages ; une
description vidée **retombe** sur celle livrée, contrairement à une légende
(`alt=""` a un sens précis en HTML).

**Le type de commerce devient un réglage** — liste fermée de six valeurs.
C'est ce qui rend la base réutilisable pour une onglerie ou un institut sans
qu'une ligne de code change.

**Le JSON-LD** gagne `estimatedDuration` (prise de la prestation, jamais écrite
en dur), `provider`, `availability`, `geo`, `ReserveAction`. Toujours **ni
`aggregateRating` ni `review`**.

**Le plan du site n'annonce que la vitrine** : inscrire des pages en `noindex`
remonte en avertissement dans la Search Console.

**Trois bogues du lot 4, trouvés ici.** `peindreVitrine()`, `peindrePhotos()` et
`initiales()` étaient appelés depuis l'espace, qui ne les embarque plus. Le
troisième cassait **la moitié du formulaire des réglages** — prestations, équipe,
avis et photos ne se dessinaient plus. D'où `tests/portees.mjs`.

⚠️ **Ce test n'a pas fonctionné du premier coup, ni du second.** Sa première
version effaçait les gabarits en entier — or presque tout le HTML de ce projet y
est construit. La seconde avait un motif qui **consommait** le caractère
précédent, si bien qu'un appel imbriqué comme `esc(initiales(p.name))` restait
invisible. Vérifié en réintroduisant le bogue : il échoue maintenant, sur les
deux documents.

*Fichiers : `src/lib/photos.js`, `src/lib/page.js`, `src/lib/settings.js`,
`src/page/parties/galerie.html`, `src/page/styles/03-fondations.css`,
`tests/seo.mjs`, `tests/portees.mjs`, migration `20260810180000_seo`.*

### Lot 6 — Finition

**La galerie accepte douze photos**, en grille `auto-fill` : trois photos font
trois colonnes, douze en font quatre sur trois rangées. Seules les cases qui
portent vraiment une photo sont écrites. Les réglages proposent les cases
remplies **plus une**.

~~**Mode avant/après** : deux photos dans la même case, sous une seule
légende.~~ **Retiré depuis.** Aucune photo « après » n'étant livrée, la fonction
ne se montrait jamais sur la vitrine, pendant qu'elle ajoutait un emplacement
facultatif par case remplie dans les réglages du barbier. Voir
`src/lib/galerie.js`.

**La galerie est écrite par le serveur.** Ses images n'avaient aucun `src` dans
le HTML servi.

⚠️ **Un bogue trouvé à l'écran, pas par un test.** La `<section>` et le `<ul>`
portaient **tous deux `id="galerie"`**. Le jour où `peindreGalerie()` a fait
`$('#galerie')`, il a récupéré la section et remplacé son contenu : le titre
« L'atelier » a disparu de la page.

**Les avis portent leur date, côté réglages seulement.** Sur la vitrine, « avis
de 2021 » dit « plus personne n'écrit de bien d'ici » ; dans les réglages, la
même date dit « il serait temps d'en recopier ».

**Le tunnel mis à l'épreuve** (`tests/tunnel.mjs`) sur les quatre cas. ⚠️ **Le
test de collision était faux avant d'être juste** : il criait au double
rendez-vous sur deux 201 légitimes — le commerce a trois barbiers, deux
réservations à la même heure y sont normales. Il vise maintenant la **même
personne**.

*Fichiers : `src/lib/galerie.js`, `src/page/styles/11-galerie.css`,
`src/page/js/04-contenu-statique.js`, `tests/tunnel.mjs`, `CLAUDE.md`,
`src/page/LISEZ-MOI.md`.*

### Après le lot 6 — les plafonds de réservation

Relevé à l'audit, hors des six lots, et signalé comme le point le plus urgent :
**n'importe qui pouvait remplir l'agenda d'un client avec une boucle de dix
lignes.** Aucun acompte, aucun compte à créer — c'est l'argument de vente
central du produit, et c'était aussi la porte grande ouverte.

Trois plafonds par adresse, tous configurables :

| Plafond | Valeur | Ce qu'il attrape |
|---|---|---|
| Rafale | 5 réservations abouties / 3 min | le script. **C'est celui qui protège.** |
| Heure | 20 réservations abouties / heure | l'acharnement lent, qui espace ses envois |
| Tentatives | 60 requêtes / heure | les requêtes malformées en boucle |

**Calés pour ne jamais gêner un client réel, y compris derrière une adresse
partagée** — réseau mobile d'un opérateur, wifi d'entreprise. Quelqu'un qui
n'arrive pas à réserver ne se plaint pas : il appelle un autre barbier.

Le refus dit **combien de temps attendre** et **donne une sortie** (« appelez le
salon »), mais **ne nomme jamais le plafond qui a mordu** : l'apprendre
apprendrait aussi comment passer entre.

La fenêtre **ne se repousse pas** à chaque passage, contrairement au compteur
d'échecs de la page de connexion. La différence n'est pas théorique : derrière
une adresse partagée, une fenêtre qui se repousse enfermerait dehors des
dizaines de clients innocents, indéfiniment.

#### L'exemption, et pourquoi elle ne peut pas affaiblir la production

Les plafonds ne s'appliquent pas à la machine elle-même **hors production**. Ce
n'est pas un contournement pour faire passer les tests, c'est une mesure :
`npm test` envoie **quarante-trois demandes de réservation en quinze secondes**
depuis la même adresse — j'ai instrumenté la route pour le compter. C'est
exactement le profil qu'un plafond existe pour arrêter. Aucune valeur ne laisse
passer la suite tout en protégeant quelque chose : il faudrait un plafond
supérieur à quarante-trois par quart d'heure, autant dire aucun plafond.

En production, `IS_PRODUCTION` est vrai et la condition est fausse quoi qu'il
arrive. Le site y tourne derrière le relais de l'hébergeur avec `trust proxy` :
`req.ip` porte l'adresse réelle du visiteur, jamais une adresse locale.

#### Ce qui est testé

`tests/debit.mjs`, 45 tests, à trois niveaux :

1. **La règle d'exemption** — les quatre combinaisons, dont celle qui compte :
   en production, rien n'est exempté, pas même une requête venue de la machine.
2. **Le compteur** — plafond, fenêtre fixe, expiration, indépendance des clés.
3. **La route elle-même, en HTTP.** La suite monte son propre serveur sur un
   autre port avec `trust proxy`, se présente avec une adresse publique via
   `X-Forwarded-For`, sort de l'exemption et voit le plafond mordre. **Aucune
   porte dérobée** : c'est le réglage de production qui rend l'en-tête digne de
   foi, et c'est ce réglage-là qu'on reproduit.

Vérifié en retirant la protection : cinq assertions passent au rouge.

⚠️ **Ce que ces plafonds ne font pas** : arrêter un adversaire disposant de
plusieurs adresses. La vraie parade contre celui-là — vérification par SMS,
acompte, CAPTCHA — est refusée par le produit, délibérément. C'est un
ralentisseur, pas un mur, et c'est assumé.

*Fichiers : `src/lib/rateLimit.js`, `src/config.js`, `src/routes/bookings.js`,
`tests/debit.mjs`, `.env.example`.*

---

## 3. Les critères d'acceptation

### Lot 1 — l'annulation

- [x] Je réserve, je ferme l'onglet, je reviens : j'annule avec référence + téléphone
- [x] Une référence valide avec un mauvais téléphone ne révèle rien
- [x] 6 tentatives d'affilée depuis la même IP sont bloquées
- [x] Le créneau libéré réapparaît immédiatement dans le calendrier public
- [x] Le déplacement ne perd jamais le créneau si la seconde étape échoue
- [x] Tests : annulation nominale, mauvais couple, référence inexistante, rendez-vous passé, double annulation, rate limit

### Lot 2 — la trace écrite

- [ ] **Non fait — votre décision.** Seule l'infrastructure a été livrée.
- [x] *(2.4)* Interface unique `src/lib/notifications.js`, deux implémentations
- [x] *(2.4)* SMS en stub Twilio, désactivé par défaut
- [x] *(2.4)* Compteur d'usage en base, plafond dur, jamais de dépassement silencieux

### Lot 3 — le tableau de bord

- [x] Les chiffres correspondent exactement aux données en base (jeu connu)
- [x] Une semaine sans rendez-vous affiche des zéros, pas `NaN` ni `undefined`
- [x] L'export CSV s'ouvre correctement dans Excel français, accents inclus
- [x] Le marqueur no-show n'est jamais visible côté vitrine

### Lot 4 — séparer l'admin de la vitrine

- [x] Un `curl` sur `/` ne contient aucune chaîne de l'interface d'administration
- [x] `/espace-salon` répond 200 et affiche la connexion
- [x] La session existante n'est pas cassée par le changement de route
- [ ] **Moins de 100 Ko de DOM : non atteint.** 117,3 Kio. Voir le point 5.

### Lot 5 — SEO, accessibilité, données structurées

- [x] Un seul `<h1>` dans le document
- [x] Chaque image porte un `alt` non vide et pertinent
- [x] `sitemap.xml` répond 200 en mode production
- [ ] **JSON-LD validé par schema.org : non vérifié.** Voir le point 5.
- [ ] **Capture pleine page : non vérifiée visuellement.** Voir le point 5.

### Lot 6 — finition

- [x] La grille accepte jusqu'à 12 photos et se dégrade proprement à 3 ou 4
- [x] ~~Mode avant/après~~ — livré, puis retiré (voir plus haut)
- [x] Avis gérables depuis les réglages + date de dernière mise à jour
- [x] Les quatre cas de robustesse du tunnel
- [x] Lighthouse mobile 95+ (99 / 100 / 100 / 100)
- [ ] **Cold start Render : non mesuré.** Voir le point 5.
- [x] `LISEZ-MOI.md` et `CLAUDE.md` à jour

---

## 4. Avant / après

| | avant | après |
|---|---:|---:|
| **Tests** | 401 | **634** (+233) |
| Suites | 5 | 12 |
| **DOM de la vitrine** | 164 244 o (160,4 Kio) | **120 156 o (117,3 Kio)** |
| Page servie | 156 493 o | 112 500 o |
| Nœuds du DOM | 828 | 660 |
| Dépendances | 4 | **4** |

### Lighthouse mobile

Mesuré en local, `--form-factor=mobile`, Lighthouse 13.4.1.

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | **99** | 100 | 100 |
| Accessibilité | **100** | 100 | 100 |
| Bonnes pratiques | **100** | 100 | 96 |
| SEO | **100** | 63 | 54 |
| LCP | 2,1 s | 1,4 s | 1,5 s |
| CLS | 0 | 0 | 0 |
| Poids transféré | 173 Kio | 95 Kio | 109 Kio |

**Les scores SEO de `/annuler` et `/espace-salon` sont bas exprès** : ces pages
portent `noindex`, et Lighthouse le compte comme un défaut. C'est le
comportement voulu.

**Bonnes pratiques 96 sur `/espace-salon`** : le contrôle de session journalise
un 401 dans la console quand personne n'est connecté. C'est la réponse correcte
du serveur ; Lighthouse compte toute erreur de console.

⚠️ **Une régression de performance introduite puis corrigée dans le même lot.**
En rendant la galerie côté serveur, j'avais chargé les quatre premières photos
sans attendre, par analogie avec la photo d'accueil. C'était faux : **la galerie
n'est jamais dans le premier écran**. Ces 354 Kio disputaient la bande passante
à la photo d'accueil.

| | avant correction | après |
|---|---:|---:|
| Performance | 88 | **99** |
| LCP | 3,9 s | **2,1 s** |
| Total Blocking Time | 30 ms | **0 ms** |
| Poids transféré | 528 Kio | **173 Kio** |

Sans Lighthouse, cette régression partait en production.

---

## 5. Ce que je n'ai pas pu faire

**Le lot 2 (email réel, contenu du mail, rappel J-1).** Votre décision, prise en
cours de route. L'infrastructure l'attend : le canal `email` a son point
d'insertion, son compteur, son journal et son contrat de retour. Il ne manque
que l'envoi et la rédaction. Conséquence à connaître : **le client repart
toujours sans trace écrite**, et la promesse « notez la référence » repose
entièrement sur ce qu'il note lui-même — ou sur le rappel gardé dans son
navigateur (lot 1.3), qui ne survit pas à un changement d'appareil.

**Moins de 100 Ko de DOM sur la vitrine : 117,3 Kio.** Je l'avais annoncé comme
incertain dès l'audit. Le reste se répartit ainsi : 29 Kio de style, 38 Kio de
JavaScript, 6 Kio de JSON-LD, 35 Kio de balisage. Descendre plus bas demanderait
de couper dans le tunnel de réservation ou dans la charte — c'est-à-dire dans le
produit. Trois pistes chiffrées sont au point 6.

**Le JSON-LD n'a pas été soumis au validateur de schema.org.** Il exige une URL
publique ou un copier-coller manuel dans une interface web. Ce que j'ai vérifié :
JSON syntaxiquement valide, types existants, `estimatedDuration` au format ISO
8601, aucune propriété inventée. **À passer au Rich Results Test avant la mise
en ligne** — c'est cinq minutes.

**La capture pleine page n'a pas été vérifiée visuellement.** L'environnement de
travail ne rend pas les captures d'écran. J'ai corrigé la cause (identifiée avec
certitude, `overflow-x: clip`), vérifié que `overflow-clip-margin: 100vh`
s'applique bien (`getComputedStyle` renvoie `720px` sur un écran de 720),
et ajouté un test qui interdit le retour en arrière. **Mais je n'ai pas vu
l'image.** À confirmer d'un `--screenshot` avant de montrer le site.

**Le cold start Render n'a pas été mesuré.** Il demande une instance déployée et
quinze minutes d'attente. Le travail fait ne l'améliore ni ne l'aggrave, à un
détail près : la vitrine étant 28 % plus légère, le premier rendu après réveil
devrait gagner un peu. Options si le délai dépasse 5 s, sans les implémenter :
un ping externe toutes les dix minutes (gratuit, contourne la mise en veille) ;
le plan payant Render à 7 $/mois (qui règle aussi la persistance) ; ou Koyeb,
déjà visé par `CLAUDE.md`.

**L'équipe et le tunnel restent absents du HTML servi.** Le lot 5 a traité les
images ; ces deux sections-là demanderaient de rendre côté serveur ce que
`peindreEquipe()` et `peindreQui()` produisent. Le mal est borné — les tarifs,
les avis, le bandeau et le JSON-LD y sont — mais un robot sans JavaScript ne
voit toujours ni l'équipe ni le formulaire de réservation.

**`tests/portees.mjs` est une analyse grossière, pas un interpréteur.** Il attrape
exactement la classe de bogue qui s'est produite trois fois. Il ne verra pas un
appel construit dynamiquement, ni une méthode d'objet manquante.

---

## 6. Ce qui mériterait un lot suivant, par valeur commerciale

**1. Le lot 2, terminé (email + rappel J-1).** *Valeur : la plus haute.* C'est la
première cause de no-show et la première question d'un patron en rendez-vous.
Tout est prêt ; il manque l'envoi et deux textes. Le rappel J-1 seul fait
typiquement baisser les absences d'un tiers.

**2. La liste d'attente.** *Valeur : haute, et personne ne la fait bien.* Vous
avez maintenant tout : les annulations laissent une trace, le canal de
notification existe, les créneaux morts sont mesurés. « Prévenez-moi si un
créneau se libère » transforme chaque annulation en rendez-vous, et c'est un
argument qu'aucun concurrent de quartier n'a.

**3. Le rendu serveur de l'équipe et du tunnel.** *Valeur : référencement.*
« Coupe homme à Bavay » se joue là.

**4. Descendre sous 100 Ko.** *Valeur : modérée.* Trois pistes chiffrées :
compacter le JSON-LD (−2 Kio, au prix de sa lisibilité en source) ; retirer
`peindrePrestations`/`peindreAvis` de la vitrine, désormais inutiles puisque les
réglages sont dans un autre document (−4 à 6 Kio) ; découper le tunnel pour ne
charger le calendrier qu'au premier clic (−8 Kio, mais c'est un vrai chantier).

**5. Les statistiques par période choisie.** *Valeur : modérée.* Le tableau de
bord montre la semaine et le mois en cours. « Comparer à l'an dernier » est la
demande suivante, et les données sont déjà là.

**6. Un vrai audit de contraste automatisé.** *Valeur : faible mais durable.*
`CLAUDE.md` dit que les couleurs ont été mesurées à la main. Sur un projet
destiné à être décliné pour plusieurs clients, ce contrôle mérite d'être un test.

---

## 7. Mesures du 12 août 2026 — après la reprise de la mise en page

`CLAUDE.md` avertissait que les chiffres du § 4 dataient d'avant la reprise et
n'avaient pas été refaits. Ils l'ont été. Lighthouse 13.4.1, profil mobile par
défaut, `--only-categories=performance,accessibility,best-practices,seo`.

### En local, comparable au § 4

C'est la colonne à comparer : le § 4 avait été mesuré en local lui aussi.

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | **99** (=) | **100** (=) | **100** (=) |
| Accessibilité | **100** (=) | **100** (=) | **100** (=) |
| Bonnes pratiques | **100** (=) | **100** (=) | **96** (=) |
| SEO | **100** (=) | 63 (=) | 54 (=) |
| LCP | 2,1 s (=) | 1,4 s (=) | 1,7 s (+0,2) |
| CLS | **0** (=) | **0** (=) | **0** (=) |
| Poids transféré | 176 Kio (+3) | 95 Kio (=) | 110 Kio (+1) |

**Rien n'a bougé.** La crainte écrite dans `CLAUDE.md` — « la photo d'accueil
est passée sous le premier écran, ce qui peut en faire le nouvel élément de
LCP » — ne s'est pas réalisée : le LCP reste à 2,1 s et le CLS à zéro.

Les +3 Kio de la vitrine sont les commentaires ajoutés aux feuilles de style
pendant cette session. Ils ne partent qu'en local : la production minifie.

### Sur l'instance déployée, et ce que ça change

Même commande, contre `letabli-barbier.onrender.com` — donc à travers le réseau,
l'offre gratuite de Render et Cloudflare.

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | 98 | 91 | 87 |
| Accessibilité | 100 | 100 | 100 |
| Bonnes pratiques | 100 | 100 | 96 |
| SEO | 69 | 63 | 54 |
| LCP | 1,9 s | 1,1 s | 1,6 s |
| CLS | **0** | **0** | **0,219** |
| Poids transféré | 174 Kio | 94 Kio | 108 Kio |

⚠️ **SEO 69 sur la vitrine déployée, contre 100 en local, et c'est voulu.** La
démonstration porte `DEMO_MODE=true`, donc `X-Robots-Tag: noindex, nofollow` :
Lighthouse compte `is-crawlable` comme un défaut, et il a raison de le faire —
sur un site de client, cet en-tête serait la catastrophe décrite dans
`src/page/LISEZ-MOI.md`. **Ne pas « corriger » ce 69.** Il revient à 100 dès que
`DEMO_MODE` n'est pas posée, ce que la colonne locale confirme.

⚠️ **CLS 0,219 sur `/espace-salon` déployé, contre 0 en local.** C'était le seul
écart réel entre les deux colonnes, et le seul chiffre de ce rapport à sortir du
vert (le seuil « bon » est 0,1). **Corrigé depuis — voir le § 8.**

Lighthouse désignait « Web font », `plexcond-600.woff2`. **C'était une fausse
piste**, et elle a coûté du temps : forcer la police de repli sur toute la page
ne déplace rien du tout, mesuré. La police finissait simplement d'arriver au
même instant que la vraie cause.

### En-têtes HTTP de l'instance déployée

Relevés au `curl -I`, ce que l'audit en direct n'avait pas pu lire.

| En-tête | Valeur | Verdict |
|---|---|---|
| `Cache-Control` (page) | `no-cache` | juste — le bandeau d'état est daté |
| `Cache-Control` (polices) | `public, max-age=31536000, immutable` | juste |
| `Cache-Control` (photos) | `public, max-age=0, must-revalidate` | voulu (le commerçant remplace ses photos), mais `hero.webp` est l'élément de LCP et repaie un aller-retour à chaque visite |
| `Content-Security-Policy` | `default-src 'self'`, nonce par envoi, `require-trusted-types-for 'script'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | complet |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | présent |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` | posés | présents |
| `X-Robots-Tag` | `noindex, nofollow` | correct **sur la démonstration**, fatal chez un client |

`'unsafe-inline'` figure dans `script-src` à côté du nonce : c'est le repli
prévu pour les navigateurs qui ne connaissent pas CSP niveau 3, et le nonce le
neutralise partout ailleurs. Ce n'est pas un trou.

`GET /sitemap.xml` répond 404 sur la démonstration, et c'est **également voulu** :
`SITEMAP_SERVI = Boolean(PUBLIC_URL) && !DEMO_MODE` (`src/server.js`). `robots.txt`
ne l'annonce donc pas non plus, ce qui est cohérent. `PUBLIC_URL` est bien posée
— l'adresse canonique, `og:image` et `potentialAction` sont tous dans la page.

### JSON-LD au Rich Results Test de Google

Fait le 12 août 2026, sur `https://letabli-barbier.onrender.com/`. **C'était la
seule vérification que le § 4 annonçait comme jamais faite.**

**Aucune erreur.** Deux types détectés, 14 éléments valides chacun :
« Commerces et services à proximité » (LocalBusiness) et « Organisation ».

Deux remarques, aucune bloquante :

1. **« Échec de l'exploration ».** Google n'a pas pu explorer l'adresse — c'est
   le `noindex` de la démonstration, encore lui. L'outil a tout de même lu et
   validé les données structurées. Chez un client, l'exploration aboutira.

2. **52 avertissements non critiques, tous le même.** Treize des quatorze
   éléments portent « champ `priceRange` / `address` / `telephone` / `image`
   manquant (facultatif) ». Ce sont les treize `provider` imbriqués dans les
   offres du catalogue : chacun est un `{ "@type": "HairSalon", "name":
   "L'Établi" }` nu, que Google compte comme un commerce de plus, sans adresse
   ni téléphone. Le site n'a qu'un commerce et il est complet au premier niveau.

   **Corrigé depuis — voir le § 8.**

### L'agenda de la démonstration — et ce que l'inventaire a appris

**Premier relevé, 12 août 2026, 16 h : 28 rendez-vous, dont 14 de test.** Tous
reconnaissables au même téléphone `06 12 34 56 78`, qu'aucun rendez-vous
d'exemple n'utilise :

- `Léo Test` (12/08, annulé) ;
- **`<img src=x onerror=alert(1)>`** (14/08 11h00, réf. `PG7B9S`) — une sonde
  XSS restée dans l'agenda. Elle était correctement échappée à l'affichage, donc
  le test qu'elle documentait était **réussi** ; mais un prospect qui ouvrait
  l'agenda lisait cette ligne comme un nom de client ;
- `Rafale0`, `Rafale1`, `Rafale11` (14/08) ;
- `R0` à `R9` (20/08, de 9 h à 11 h 15 par quarts d'heure) et `R25` — la rafale
  des tests de plafond.

`EQMHLB`, citée par l'audit, n'y était déjà plus.

**Second relevé, une heure plus tard : 10 rendez-vous, aucun de test.** Les
quatorze ont disparu sans que personne ne les supprime. L'instance s'était
rendormie puis relancée entre les deux relevés — l'onglet a affiché
« Application loading » — et **c'est exactement le comportement décrit dans
`CLAUDE.md`** : l'offre gratuite de Render n'a pas de disque persistant, la base
vit dans le conteneur, et un redémarrage la reconstruit depuis `defaults.js`.

L'agenda est donc propre, et il l'est parce que rien n'y survit.

⚠️ **Ce n'est pas une garantie, c'est la limite d'hébergement retournée.** Elle
nettoie les rendez-vous de test toute seule, mais elle effacera de la même façon
ce qu'un prospect aura saisi pendant un essai. Les deux faces sont le même fait,
et c'est celui que le bandeau de démonstration annonce.

**La conclusion pratique n'est donc pas « c'est réglé » mais : ne pas lancer de
suite de tests contre l'instance déployée.** Les quatorze lignes venaient de là
— `tests/debit.mjs` envoie quarante-trois réservations depuis la même adresse,
et `R0`…`R9` en sont la trace. Un prospect qui ouvre l'agenda juste après verrait
une sonde XSS en guise de nom de client. Les tests tournent en local, contre
`npm start`, comme le dit `CLAUDE.md`.

⚠️ **Avant un rendez-vous commercial, ouvrir l'agenda et regarder.** Si des lignes
de test s'y trouvent, le bouton « Remettre à zéro maintenant » de l'espace
(`POST /api/admin/demo/reset`) rend une vitrine propre sans attendre le
redémarrage — c'est précisément ce pour quoi il existe.

---

## 8. Les deux corrections issues des mesures du § 7

### Le CLS de l'espace : ce n'était pas la police

Lighthouse accusait `plexcond-600.woff2`. La mesure a dit non : forcer la police
de repli sur toute la page ne déplace **rien**, ni le titre, ni la boîte, ni le
formulaire — zéro pixel, à toutes les largeurs essayées.

La vraie cause était à trois lignes de `demarrage.js`. Le bloc des identifiants
de démonstration partait `hidden` dans le balisage, et le navigateur le révélait
**après la réponse de `/api/config`** :

```js
if (CONFIG?.demo) { …; montrer($('#connexionDemo'), true); }
```

259 px de contenu ajoutés après la première peinture, dans une boîte **centrée
verticalement** — ce qui ne pousse pas ce qui suit mais **recentre tout**. Le
formulaire de connexion sautait de **299 px**, mesuré sur l'instance déployée.

Deux choses expliquent qu'il ait vécu si longtemps sans être vu :

- **il n'existe pas en local.** Sans `DEMO_MODE`, `CONFIG.demo` est absent, le
  bloc ne paraît jamais, et le CLS est de zéro. Le seul environnement où le
  défaut se produit est celui qu'on montre aux prospects ;
- **Lighthouse désignait autre chose**, avec assurance et avec une URL.

**Le correctif est celui que l'architecture demandait déjà** : le serveur connaît
`DEMO_MODE` et les deux identifiants, donc il écrit le bloc dans la page, entre
les marqueurs `<!--@espace-demo-->`, exactement comme il écrit déjà le titre de
cette page et comme il vide `<!--@espace-lien-->` hors démonstration. Le bloc est
là dès le premier octet ; il n'y a plus rien à révéler, et le navigateur ne fait
plus que lire. Les quatre lignes de JavaScript ont disparu.

**Avant / après, même machine, même serveur, même commande** — le défaut se
reproduit en local dès qu'on pose `DEMO_MODE=true`, ce qui a permis de le
mesurer des deux côtés :

| | avant | après |
|---|---:|---:|
| CLS | 0,204 | **0** |
| Élément coupable | `form#formulaireConnexion` | **aucun** |

(0,204 en local contre 0,219 en production : le même défaut, à la latence près.)

### Le JSON-LD : un commerce, pas quatorze

Chaque prestation portait son `provider` recopié en entier :

```js
provider: { '@type': config.salon.type, name: config.salon.name }
```

Un objet sans `@id` est un **nœud neuf** pour un moteur. Treize prestations
fabriquaient donc treize commerces de plus, chacun réduit à son nom — d'où les
quatorze « Commerces et services à proximité » et les cinquante-deux
avertissements du Rich Results Test.

La fiche porte maintenant un `@id`, et chaque `provider` n'est plus qu'un renvoi
vers lui :

```js
provider: { '@id': idCommerce }
```

Absolu quand `PUBLIC_URL` est posée (`https://…/#commerce`), relatif sinon
(`#commerce`) — un `@id` sert à reconnaître la même entité d'un document à
l'autre, et un identifiant relatif perd ce pouvoir dès qu'on lit le bloc hors de
sa page ; mais sans `PUBLIC_URL` il n'y a de toute façon aucune base absolue.

Vérifié en parcourant le graphe produit : **1 nœud `HairSalon` complet, 13
renvois, une seule cible, et cette cible est bien la fiche.**

### Vérifié en ligne le 14 août 2026

Les deux corrections ont été déployées, et les deux vérifications qui
demandaient une adresse publique ont pu être faites.

**Rich Results Test, sur `https://letabli-barbier.onrender.com/` :**

| | avant | après |
|---|---:|---:|
| « Commerces et services à proximité » | 14 éléments valides | **1** |
| « Organisation » | 14 éléments valides | **1** |
| Avertissements non critiques | 52 (13 × 4) | **0** |

Un seul élément, « L'Établi », sans une remarque. L'« Échec de l'exploration »
demeure, et reste voulu : c'est le `noindex` de la démonstration.

**Lighthouse mobile, même commande qu'au § 7 :**

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | 98 → **98** | 91 → **100** | 87 → **100** |
| CLS | 0 → **0** | 0 → **0** | **0,219 → 0** |
| LCP | 1,9 s → 1,9 s | 1,1 s → 1,2 s | 1,6 s → **1,4 s** |

⚠️ **La première mesure de la vitrine après déploiement a donné 87, et ce
n'était pas une régression.** LCP, FCP, CLS et le poids étaient identiques au
bit près ; seuls le TBT (140 → 480 ms) et le temps de réponse serveur
(70 → 310 ms) avaient bougé. C'est le premier appel après une mise en ligne :
le cache d'assemblage est vide, la page doit être recollée et minifiée, et
l'instance gratuite se réchauffe encore. Trois mesures suivantes sur instance
chaude : 93, 98, 99, TBT 70 à 120 ms, serveur 70 ms.

**À retenir pour les prochaines mesures : ne jamais lighthouser dans la minute
qui suit un déploiement.** C'est aussi la raison pour laquelle `render.yaml`
recommande d'ouvrir le site cinq minutes avant de le montrer.

---

*Chaque chiffre de ce rapport a été mesuré sur le serveur qui tourne. Les
scores Lighthouse ont été relancés après la dernière modification.*

---

## 9. Audit du 17 août 2026 — lot 1 : déplacer un rendez-vous

Périmètre arbitré avec le propriétaire : **le lot 1 seul**. Les lots 2 à 4
(sauvegardes, comptes multiples, vue semaine en colonnes) ne sont pas engagés ;
l'arbitrage est en fin de section.

### Ce qui manquait, et ce que ça cassait

La fiche d'un rendez-vous ne proposait que « Supprimer » et « Fermer ». La route
`PATCH /api/admin/bookings/:id` existait mais ne réattribuait qu'une personne,
et **aucun écran ne l'appelait** — du code mort côté interface.

Le seul chemin pour décaler un rendez-vous était donc **supprimer puis
re-noter**, et il cassait quatre choses en silence :

| ce qui se perdait | conséquence pour le client |
|---|---|
| `reference` (retirée à la création) | sa référence notée ne marche plus sur `/annuler` |
| `cancelToken` | le lien d'annulation de son écran de confirmation meurt |
| `source: 'online'` → `'phone'` | la statistique de provenance du tableau de bord ment |
| `id` | le bandeau « Votre rendez-vous » de son téléphone pointe dans le vide |

Le client voyait son rendez-vous disparaître pendant que le commerçant croyait
l'avoir simplement décalé.

### Ce qui a été fait

**La route accepte maintenant `date`, `start` (ou `startMin`), `serviceId` et
`staffId`, tous facultatifs.** C'est la **clé** qui vaut ordre, pas sa valeur :
`{ staffId: null }` rend le rendez-vous à personne, `staffId` absent n'y touche
pas. C'est ce qui permet de décaler sans réattribuer, et l'inverse.

`id`, `reference`, `cancelToken`, `source` et `createdAt` ne figurent pas dans
les champs écrits : un `update` partiel les laisse tels quels. C'est tout
l'intérêt de l'opération, et c'est ce que vérifie la section 2 de
`tests/deplacement.mjs`.

**Deux contrôles de collision, pas un.** La distinction n'est pas cosmétique :

- **réattribution seule** (ni date, ni heure, ni prestation ne changent) : on ne
  regarde que ce qui est **déjà attribué à cette personne**. C'est la règle
  d'origine de la route, et elle doit être conservée — deux rendez-vous
  orphelins qui se chevauchent (l'héritage d'un commerce passé d'un agenda
  unique à une équipe) se bloqueraient sinon l'un l'autre, et **aucun** ne
  pourrait plus être attribué. Impasse, dans la situation même que la route
  existe pour réparer ;
- **déplacement réel** : tous les occupants du jour visé, **soi-même exclu**,
  orphelins compris — un rendez-vous sans personne occupe tout le monde.

L'exclusion de soi-même est ce qui fait réussir le repos sur son propre créneau,
et donc le changement de la seule prestation ou de la seule personne.

**`GET /api/admin/slots` accepte `exclude=<id>`.** Sans lui, l'écran « Déplacer »
affichait le créneau actuel comme « pris » et désactivé : on ne pouvait plus
changer la personne sans changer aussi l'heure. C'est le pendant, côté liste, de
l'auto-collision que la transaction écarte déjà.

**Un seul formulaire pour noter et pour déplacer.** Les deux posent les mêmes
quatre questions ; en tenir deux d'accord aurait été deux dessins à maintenir.
Trois choses changent : le titre, le libellé du bouton, et les champs nom et
téléphone, qui disparaissent — on ne change pas de client en décalant son
rendez-vous.

⚠️ **Une valeur absente de la liste déroulante y est réinjectée.** Une prestation
retirée du site ou une personne en pause ne figure pas dans ce que la vitrine
propose ; le rendez-vous qu'on déplace, lui, peut parfaitement être l'un ou
l'autre. Sans ce rattrapage, `select.value = …` ne trouve rien, retombe en
silence sur la première ligne, et **le déplacement aurait changé la prestation
ou rendu le rendez-vous à quelqu'un d'autre sans que personne ne l'ait demandé.**

### Trois écarts assumés avec le texte de l'audit

**1. Le tarif par personne n'existe pas.** L'audit demande de recalculer
`priceCents` « à partir de la prestation et de la personne (tarif par personne,
voir la migration `20260804010708_tarif_par_personne`) ». Cette migration a été
**annulée le jour même** par la suivante,
`20260804014224_photo_equipe_et_tarif_unique`, qui supprime la colonne
`priceCents` de `ServiceStaff`. Il n'y a rien à lire du côté de `staffId` : une
coupe vaut le même prix pour tout le monde, et `attribuer()` en dit autant à la
création. Le tarif est donc recalculé **depuis la prestation seule**.

**2. La tolérance horaire est plus large que celle de la création.** L'audit
demande de « prévenir, ne pas interdire » sur les plages fermées, en la
présentant comme « la ligne de conduite déjà tenue par le `PATCH` existant ».
Le `PATCH` existant ne vérifiait en réalité **aucun horaire**, et
`POST /api/admin/bookings`, lui, **refuse** ces cas via `isBookableStart`.
Arbitrage retenu : le déplacement **accepte** hors horaires, hors grille et
pendant la pause, et renvoie alors un champ `warning`. À la création, un créneau
hors horaires est presque toujours une faute de frappe ; ici, il y a déjà un
rendez-vous et un client au téléphone, et un refus ferait revenir au
supprimer-puis-recréer — c'est-à-dire exactement ce que la route existe pour
éviter. **Seule la date passée reste refusée** : elle fausserait le taux de
remplissage comme le pointage.

**3. Deux refus ajoutés, que l'audit ne demandait pas.** Une **période bloquée**
ne se déplace pas (elle se lève et se repose : c'est une ligne par jour), et un
rendez-vous **déjà annulé par le client** non plus — son créneau est rendu au
public, le décaler reviendrait à le ressusciter dans le dos de celui qui s'est
décommandé. Le bouton « Déplacer » est masqué dans les deux cas, **et** le
serveur refuse : un bouton qu'on ne peut pas presser vaut mieux qu'un refus
après coup.

### Ce qui n'est pas implémenté, délibérément

**Le client n'est prévenu de rien.** Le point d'appel de `notifierEnFond()` est
marqué dans la route, en commentaire, et rien de plus — allumer un canal est un
arbitrage commercial (coût Twilio, ou choix d'un expéditeur de courriel), pas
une tâche de développement. En attendant, l'écran affiche après chaque
déplacement :

> Rendez-vous déplacé au mar. 25 août à 14:30. Pensez à prévenir Damien
> Carpentier — 06 39 98 14 07.

C'est la seule chose honnête à faire tant que les canaux sont éteints. Quand un
numéro manque, la phrase le dit aussi.

### Vérifications

**16 suites, 828 assertions, aucun échec** (`npm test`, serveur ouvert dans un
autre terminal, `DEMO_MODE` absent du `.env`). `tests/deplacement.mjs` en apporte
51, dont : déplacement simple, conservation de la référence / du jeton / de la
provenance / de la date de création, **la référence d'origine retrouvée sur
`/annuler` affichant la nouvelle date**, collision 409 sans écriture partielle,
auto-collision, `exclude`, changement de prestation (durée et tarif recalculés,
durée soufflée par la requête ignorée), changement de personne, clé absente qui
ne touche à rien, et les deux refus ci-dessus.

⚠️ **Un 500 a été trouvé et corrigé par cette suite, pas par la lecture du
code.** `{ serviceId: null }` **détache** la prestation : c'est un changement —
la clé est là — mais il n'y a plus rien à lire. Le recalcul ne testait que le
drapeau « ça change », déréférençait `null`, et rendait 500 là où le rendez-vous
doit simplement garder la durée et le tarif figés sur sa ligne. Les deux
conditions ne disent pas la même chose ; il faut les deux.

⚠️ **La suite met l'équipe de côté pour son propre compte**, comme
`tests/staff.mjs`. Sans cela, elle passe au rouge sur une base de développement
où une équipe est enregistrée : déplacer sur un créneau « occupé » y **réussit**,
parce qu'une seconde personne y est libre. Le comportement était juste, c'est le
test qui supposait un agenda unique. Constaté à l'essai, pas déduit.

**Rendu vérifié à 390, 768 et 1440 px**, parcours complet depuis l'agenda :
aucun débordement horizontal, aucune cible tactile sous 24 px (48 px à 390,
44 px au-dessus), rayon 0, aucune ombre portée, transitions à 150 ms. Les trois
boutons de la fiche s'empilent en colonne à 390 px et se répartissent en deux
rangs au-dessus.

### L'arbitrage sur les lots 2 à 4

Non engagés. Ce que je retiens de leur lecture, pour la décision :

- **Lot 2 (sauvegardes)** — c'est le seul des trois qui protège contre une perte
  **irréversible**. Chez un client payant, toute sa clientèle tient dans un
  fichier SQLite sur un volume d'hébergeur, et `scripts/` n'a rien pour le
  copier. À faire avant le premier client réel, pas avant la prochaine
  démonstration : sur la démo, la base est jetable par construction.
- **Lot 3 (comptes multiples)** — utile dès le premier salon à plusieurs. La
  recommandation de l'audit (commencer sans rôles, mais poser la colonne dans la
  migration) est la bonne : une seconde migration sur une base de production
  coûte plus cher que la colonne inutilisée.
- **Lot 4 (vue semaine en colonnes)** — confort, pas manque. À garder pour après.

### Deux limites connues, à ne pas « corriger »

- **`'unsafe-inline'` dans la CSP**, à côté du nonce. Un navigateur qui comprend
  les nonces l'ignore depuis CSP niveau 2 ; il ne protège que les très vieux
  navigateurs de la perte totale de la réservation en ligne. Le commentaire de
  `securityHeaders.js:37` l'explique. **Un outil d'audit automatique le
  remontera sans le lire** — c'est écrit ici pour qu'on n'ait pas à le
  redécouvrir.
- **`better-sqlite3` impose une instance unique.** La transaction de réservation
  n'est correcte que parce qu'un seul processus écrit. C'est parfaitement
  dimensionné pour un commerce de quartier, et ça interdit de dupliquer
  l'instance sans passer à Postgres.

---

## 10. Lot 3, et deux défauts d'ergonomie trouvés à l'écran

### Le chevron était dessiné à côté du champ, pas dedans

Signalé sur une capture de l'écran « Déplacer le rendez-vous » : chaque `<select>`
affichait un rectangle bordé, puis sa flèche posée dans le blanc **à droite du
cadre**. Le champ « Date » d'à côté, lui, gardait son icône à l'intérieur — les
deux n'avaient donc même plus la même largeur.

La cause n'est pas dans le dessin du chevron, qui était juste, mais dans le
**placement automatique de la grille**. `.champ:has(select)` fixe une ligne
(`grid-row`) sur chacun de ses enfants sans jamais fixer de colonne ; le
`::after` demandait la ligne 2, où le `<select>` occupait déjà la colonne 1, et
la grille lui en fabriquait donc une **seconde**. Mesuré dans le navigateur :

| | avant | après |
|---|---|---|
| `grid-template-columns` calculé | `568px 24px` | **`592px`** |
| largeur du `<select>` | 568 px | **592 px** |
| chevron | hors du cadre | **dedans, à 16 px du bord** |

Le champ rétrécissait d'exactement la largeur du chevron. `grid-column: 1` sur
les quatre enfants remet tout le monde dans la même cellule.

⚠️ **Le défaut portait sur TOUS les `<select>` des trois documents**, pas sur le
seul formulaire de déplacement : le tunnel client, les réglages, le formulaire
de blocage. Il se voit surtout là où un champ `date` se trouve juste en dessous,
parce que la différence de largeur devient alors visible sans mesurer.

### Le formulaire de déplacement, sur ses trois chemins d'échec

La même capture montrait « Connexion requise. » sous une liste d'heures vide, le
bouton toujours actif. Trois corrections, toutes du même ordre — l'écran savait,
et ne disait pas :

- **session expirée** : `chargerHeuresRdv()` affichait le message et s'arrêtait
  là. Le seul geste utile — se reconnecter — n'était proposé nulle part, et
  chaque clic reposait la même question. Un 401 renvoie maintenant à l'écran de
  connexion, comme partout ailleurs dans le fichier ;
- **journée sans créneau** : la liste se vidait sans un mot, et un jour de
  fermeture donnait le même écran vide qu'un jour complet. Les deux cas sont
  maintenant nommés, et le bouton d'envoi s'éteint ;
- **le champ s'ouvrait sur un créneau pris** : le navigateur sélectionne la
  première option de la liste, désactivée ou non. Une journée qui commence par
  un rendez-vous ouvrait donc le formulaire sur « 09:00 — pris », et l'envoi
  partait vers un 409 certain **pour un choix que personne n'avait fait**. À
  défaut de l'heure voulue, c'est la première heure libre qui est retenue.

Deux ajouts de confort, dans la même passe : les heures sont rangées par
**demi-journée** (`Matin` / `Après-midi`), comme le tunnel client le fait déjà
pour ses créneaux — trente-trois heures d'affilée dans une liste déroulante sont
un mur ; et le sélecteur de date porte un `min` à aujourd'hui, ce qui grise le
passé au lieu de laisser le serveur refuser **après** la confirmation.

### Lot 3 — les personnes autorisées

La base acceptait plusieurs comptes depuis le premier jour ; la seule façon d'en
créer un était `npm run admin:create`, en ligne de commande, sur le serveur —
que le commerçant n'a pas. D'où un mot de passe partagé écrit près de la caisse,
et les trois conséquences que l'audit décrit : aucune traçabilité, un départ qui
oblige à déconnecter tout le monde, un ancien employé qui garde l'entrée du
fichier client.

Trois routes sous `requireAdmin`, et sous **le plafond de la page de
connexion** : ces routes créent et détruisent des accès, elles valent la porte
d'entrée et se protègent comme elle.

**Les deux garde-fous ne se recouvrent pas.** On ne révoque ni le dernier compte
— il ne resterait plus aucune façon d'entrer, et l'espace ne se rouvrirait qu'en
ligne de commande — ni le sien : se révoquer soi-même est toujours un accident,
et il faut alors quelqu'un d'autre pour rouvrir. La règle vit **des deux côtés** :
l'écran retire le bouton, le serveur refuse quand même.

⚠️ **La révocation ne ferme que les sessions du compte visé.** C'est toute la
différence avec le changement de mot de passe, qui les ferme toutes,
délibérément. Un test vérifie donc qu'un **tiers reste connecté** pendant qu'un
autre est coupé — sans quoi « révoquer Karim » déconnecterait le salon entier,
c'est-à-dire exactement ce que la fonction existe pour éviter.

⚠️ **La gestion des comptes est éteinte sur la démonstration**, comme le
changement de mot de passe et pour la même raison : le premier visiteur qui
révoquerait le compte de démonstration fermerait la porte à tous les suivants,
et jusqu'à la remise à zéro de 4 h. La section reste visible — elle fait partie
de ce qu'on montre — mais elle n'agit pas.

**Il n'y a pas de rôles, et la colonne est quand même posée.** C'est la
recommandation de l'audit, et elle est juste : tous les accès peuvent tout
faire, y compris changer les tarifs, parce qu'un écran de permissions n'a été
demandé par personne ; mais une **seconde migration sur la base d'un client qui
tourne** coûte bien plus cher qu'une colonne vide. `AdminUser.role` existe,
vaut `""`, et **aucun code ne la lit** — un test le constate, pour que personne
ne croie à une règle d'autorisation qui n'existe pas.

### Un défaut de mise en page trouvé en mesurant, pas en regardant

À 390 px, la ligne d'un accès **sortait de l'écran** et emportait la page dans un
défilement horizontal. `.reglages-ligne-appui` était en `flex: none` : la règle
convenait tant que l'appui tenait en deux mots — « Barbier », « 4 prestations » —
et la liste des accès en écrit de bien plus longs, parce que c'est ce qu'on vient
y lire : « vous, en ce moment · dernière entrée le 19 août · 1 appareil ouvert ».

`flex: 0 1 auto` avec `min-width: 0` le laisse rétrécir sans jamais grandir. Le
correctif protège aussi les quatre listes qui employaient déjà cette classe, et
qui auraient débordé le jour où l'une d'elles aurait affiché un appui long.

⚠️ **Il n'était visible ni à l'œil ni sur une capture** : `window.innerWidth`
rapporte une valeur mise à l'échelle dans le volet d'aperçu, alors que
`getBoundingClientRect()` et `document.documentElement.clientWidth` sont dans le
repère CSS. Comparer les deux ne prouve rien. C'est `matchMedia('(max-width:
400px)')` qui a confirmé que la page était bien rendue à 390 px, et
`scrollWidth > clientWidth` qui a montré le débordement.

### Vérifications

**17 suites, 861 assertions, aucun échec.** `tests/comptes.mjs` en apporte 33 :
la liste sans aucune empreinte de mot de passe, la création puis la connexion
sous le nouveau compte, le doublon en 409, quatre identifiants refusés, les deux
garde-fous, la révocation ciblée avec un tiers qui reste connecté, et la colonne
`role` constatée inerte.

Rendu vérifié à 390, 768 et 1440 px : aucun débordement horizontal dans la
nouvelle section ni dans les quatre listes existantes, aucune cible tactile sous
24 px (bouton « Révoquer » à 44 px), rayon 0, aucune ombre. Le cycle complet —
créer un accès, le voir apparaître « jamais entré », le révoquer avec sa
confirmation nommée — a été parcouru à l'écran.

⚠️ **`npx prisma generate` est indispensable après cette migration**, et
`npm start` doit être relancé ensuite. Le client Prisma est généré dans
`src/generated/prisma` : tant qu'il n'a pas été régénéré, `role` est un « champ
inconnu » et la moitié de la suite tombe sur une erreur de validation qui ne
désigne pas sa cause.

---

## 11. Les défauts restants, cherchés au lieu d'être attendus

### La session expirée : le même défaut à cinq endroits

Le formulaire de déplacement n'était pas un cas isolé. Un relevé de tous les
blocs `catch` de l'espace qui parlent à l'écran en a trouvé **cinq autres**
qui affichaient « Connexion requise. » sans rien faire : noter un
rendez-vous, bloquer une période, remettre les réglages à zéro, déposer une
photo, en retirer une. Le commerçant voyait un message, cliquait à nouveau,
et obtenait le même message.

Deux cas signalés par le relevé n'en sont pas, et l'un comme l'autre méritent
d'être écrits :

- **le formulaire de connexion** : un 401 y signifie « mot de passe faux »,
  c'est la réponse attendue, et y renvoyer vers la connexion serait renvoyer
  vers l'écran où l'on est déjà ;
- **la réduction d'une image** : elle se fait dans le navigateur
  (`FileReader`, `<canvas>`), aucun serveur n'est appelé.

Un défaut présent à cinq endroits à la fois dit qu'aucune pression ne le tient
droit. Le contrôle est donc devenu un test, dans `portees.mjs` — le fichier
existe pour cette classe de bogue exactement : invisible au chargement,
invisible à la lecture, visible seulement en cliquant, et ici seulement après
avoir attendu qu'une session expire, ce que personne ne fait en développant.

**Le garde-fou a été vérifié en le faisant échouer** : un traitement du 401
retiré volontairement, le test le nomme (`js/09-agenda.js:572 —
envoyerRdv()`) ; remis, il repasse au vert.

### Un champ mort qui mentait sur la provenance

Le formulaire envoyait `source: 'phone'` au serveur, **qui ne l'a jamais lu**
: la route écrit la provenance elle-même. Le champ était donc sans effet, et
trompeur — il laissait croire que le client choisit la provenance, alors que
c'est précisément le chiffre que le lot 1 s'attache à garder vrai. Retiré, et
la raison écrite à sa place.

### Le plafond des comptes se refermait sur le commerçant

>>> **Défaut introduit au lot 3, et trouvé en lançant `npm test` deux fois.**

`plafondDesComptes()` consommait un jeton à **chaque** appel, réussi comme
raté. Deux conséquences :

- un commerçant qui enregistre son équipe se serait vu refuser l'accès à sa
  propre section, sans avoir rien fait de mal ;
- la suite passait au vert la première fois et **au rouge à la seconde**
  lancée dans le quart d'heure, les vingt opérations de la première restant
  au compteur.

C'est le piège que le dépôt connaissait déjà pour les références
d'annulation, sous une autre forme. `POST /api/admin/login` fait pourtant ce
qu'il faut depuis toujours — `recordFailure` dans la seule branche de refus,
`resetFailures` au succès — et c'est ce que l'audit demandait en écrivant
« sous la même limitation de débit que `POST /api/login` ». Les routes de
gestion des accès s'alignent maintenant sur elle.

⚠️ **La section 5 bis de `tests/comptes.mjs` ne déclenche pas le plafond, et
c'est délibéré.** Une fois la limite atteinte, plus aucun appel ne passe — le
contrôle précède l'action — et il n'existe aucune façon de la lever depuis
l'API, contrairement à `/api/rendez-vous` où un jeton juste rouvre la porte.
La déclencher bloquerait l'adresse un quart d'heure et casserait le
`npm test` suivant : le défaut même que la section protège.

### Ce qui a été regardé et laissé tel quel

- **Les trois boutons de la fiche** se répartissent en 2 + 1 à partir de
  768 px (« Déplacer » et « Supprimer » sur un rang, « Fermer » en dessous).
  C'est le repli normal de `.actions-paire`, et les deux actions voisines se
  distinguent par leur traitement — aplat plein contre filet. Toucher à cette
  classe changerait aussi `/annuler` et la fenêtre des conflits, qui n'ont
  que deux boutons. Jugement, pas défaut.
- **Le lot 2 (sauvegardes) et le lot 4 (vue semaine en colonnes)** restent
  non engagés : ce sont des fonctions à écrire, pas des défauts à corriger.
  L'arbitrage est au § 9.

### Vérifications

**17 suites, 864 assertions, aucun échec — et le contrôle qui compte ici :
`npm test` lancé DEUX FOIS de suite passe au vert les deux fois.** C'est ce
second passage qui avait révélé le défaut du plafond, et c'est lui qui
l'aurait laissé passer s'il n'avait été lancé qu'une fois.

---

## 12. Lot 4 — la semaine en colonnes

### La question à laquelle la liste ne répondait pas

« Qui est libre jeudi après-midi ? » En sept listes chronologiques, il faut
lire la journée entière et tenir de tête qui apparaît et qui manque — le
raisonnement se fait dans la tête du commerçant, pas à l'écran. En colonnes,
la réponse **est** la colonne la plus courte.

À partir de 900 px et **seulement si une équipe est enregistrée**, chaque
journée prend toute la largeur et se partage en une colonne par personne.

### Ce que ce n'est pas

⚠️ **Ce n'est pas le retour de la grille**, et c'était le risque de ce lot.
L'agenda a cessé d'être une grille parce qu'un samedi de 8h30 à 17h dessinait
cinquante et une cases vides pour trois rendez-vous : on ouvrait son agenda et
on voyait du vide quadrillé. Trois garde-fous tiennent la nouvelle vue du bon
côté :

- une colonne ne contient **que des rendez-vous réels** — aucune case à
  l'heure, aucun quadrillage ;
- une colonne sans rien tient en **une ligne** : « Libre » ou « Ne travaille
  pas » ;
- une journée **entièrement vide ne dessine aucune colonne**. Sa tête dit déjà
  « Rien de prévu ». Trois colonnes de « Libre » auraient été du vide
  quadrillé en plus petit.

### Trois décisions qui ne se voient pas

**« Libre » et « Ne travaille pas » sont deux réponses différentes.** Les
confondre ferait proposer quelqu'un qui ne vient pas ce jour-là — la faute
exacte que cette vue existe pour éviter. Les trois cas se lisent dans le
schéma : commerce fermé, `hours` nul (elle suit le commerce), `hours[jour]`
nul (son jour de repos). La donnée arrivait déjà au navigateur ; personne ne
s'en servait.

**Ce qui n'appartient à personne passe au-dessus, pleine largeur** : blocage
du commerce entier, rendez-vous non attribué. Ils occupent *tout le monde*
(prisma/schema.prisma) ; les ranger dans une colonne les ferait passer pour
l'affaire d'une seule personne et **laisserait croire les autres
disponibles** — l'inverse de ce qu'on vient chercher.

**Le choix du dessin est en JavaScript, et il ne pouvait pas être en CSS.**
Les deux formes ne rangent pas les mêmes lignes dans le même ordre —
chronologique d'un côté, par personne de l'autre — et aucune règle de style ne
réordonne un contenu. Un `matchMedia` est donc écouté dans `09-agenda.js`, et
`peindreAgenda()` pose `data-colonnes="personnes"` que la feuille se contente
d'appliquer. Franchir 900 px redessine, ce qui couvre aussi la tablette qu'on
tourne.

### Un détail d'accessibilité qui a failli passer

Dans une colonne, répéter le prénom sur chaque ligne vole la place du nom du
client. Première version : `display: none`. Elle **retirait aussi le prénom
aux lecteurs d'écran** — et la personne n'était plus portée que par la
*position de la colonne*. C'est la même faute que de porter une information
par la seule couleur, sous une autre forme : quelqu'un qui parcourt les
rendez-vous bouton par bouton entendait « 09:30, Damien Carpentier, coupe
homme » sans jamais savoir de quelle colonne il s'agissait.

Le prénom passe donc en `.hors-ecran` — invisible, audible. Vérifié en
relevant ce qu'un lecteur d'écran annonce vraiment :

```
09:25 | Damien Carpentier | Coupe homme · 25 min | Rémi
```

Le téléphone, lui, est bien retiré pour tout le monde : c'est un détail qu'on
va chercher dans la fiche, en lien `tel:`, et pas en survolant sa semaine. Il
coûtait une troisième ligne à chaque rendez-vous, soit un tiers de hauteur sur
une semaine entière.

### Vérifications

Les quatre critères, vérifiés à l'écran sur une semaine peuplée à dessein
(deux rendez-vous pour Rémi, un pour Karim, un jour de repos pour Yanis, un
blocage sur une seule personne, un rendez-vous non attribué) :

| Critère | Constat |
|---|---|
| Colonnes par personne à partir de 900 px | `data-colonnes="personnes"`, trois colonnes de 381 px |
| En dessous de 900 px, la liste est conservée | à 768 et 390 px : aucune colonne, liste chronologique |
| Les blocages y apparaissent, distincts | filet gris contre filet à la teinte de la personne, « Période bloquée » |
| Un rendez-vous s'y ouvre en fiche | fiche ouverte, « Déplacer » présent ; sur un blocage, « Lever ce blocage » |

**Sans équipe, rien ne change** : la semaine reste sept journées en deux
colonnes de 564 px, les six rendez-vous toujours affichés. C'est le cas de
l'agenda unique — et celui de toute la suite de tests. Vérifié en mettant
réellement l'équipe de côté, puis en la reposant.

Aucun débordement horizontal ni cible sous 24 px à 390, 768 et 1440 px.
**17 suites, 864 assertions, aucun échec.**

⚠️ **Aucun test automatique n'a été ajouté pour ce lot, et c'est délibéré.**
Il n'y a pas de comportement serveur à vérifier : la vue est entièrement
front-end, et `portees.mjs` couvre déjà la seule classe de bogue qui s'y
produirait sans se voir — une fonction appelée mais absente du document. Le
reste se regarde, et a été regardé.
