// ---------------------------------------------------------------------------
// LES VALEURS D'ORIGINE DU COMMERCE
//
// >>> C'EST LE FICHIER A ADAPTER POUR CHAQUE NOUVEAU CLIENT. <<<
//
// Il sert a deux choses :
//   - remplir la base la premiere fois (prisma/seed.js) ;
//   - alimenter le bouton "Reinitialiser aux valeurs d'origine" de l'espace
//     commercant, qui ramene tout ce qui est ci-dessous.
//
// Les valeurs sont ecrites sous leur forme lisible (heures en "HH:MM", prix en
// euros), et non sous la forme technique de la base (minutes, centimes) : c'est
// un humain qui edite ce fichier. La conversion se fait toute seule.
//
// La cle s'appelle encore `salon` : c'est le nom du champ dans la base et dans
// toute la couche serveur, invisible du visiteur. La renommer casserait les
// migrations et la suite de tests pour un mot que personne ne lit.
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  salon: {
    name: "L'Établi",
    street: '12 rue de Valenciennes',
    postalCode: '59570',
    city: 'Bavay',
    // Numero reserve a la fiction par l'ARCEP (03 27 39 98 00 a 03 27 39 99 99) :
    // il ne sonnera jamais chez personne. A remplacer par le vrai numero du
    // client, evidemment.
    phone: '03 27 39 98 40',
    email: 'contact@letabli-bavay.fr',

    // Les adresses du commerce ailleurs sur le web. VIDES = AUCUN LIEN NE
    // S'AFFICHE : un commerce sans Instagram ne montre jamais d'icone morte.
    //
    // >>> A REMPLIR POUR CHAQUE CLIENT, en commencant par `google`. <<<
    //
    // `google` est l'adresse de sa fiche Google Business Profile. C'est le lien
    // le plus rentable des trois : il envoie ses clients deposer un avis la ou
    // Google les compte, et il dit a Google que ce site et cette fiche sont le
    // meme commerce (il est publie en `sameAs` dans les donnees structurees).
    // >>> POUR UN VRAI CLIENT : l'adresse de sa fiche Google Business Profile,
    //     celle qui ouvre ses avis. Ici, faute de fiche, une recherche Google
    //     Maps sur l'adresse : elle fonctionne, elle montre le bon endroit, et
    //     elle n'usurpe la fiche de personne. C'est le compromis honnete pour
    //     une demonstration — voir `reviews` juste en dessous. <<<
    links: {
      google: 'https://www.google.com/maps/search/?api=1&query=12+rue+de+Valenciennes+59570+Bavay',
      instagram: '',
      facebook: '',
    },
  },

  // Note et nombre d'avis RECOPIES DEPUIS LA VRAIE FICHE GOOGLE du commerce.
  //
  // ⚠️ CES DEUX CHIFFRES SONT INVENTES, ET C'EST UN CHOIX ASSUME POUR LA
  //    DEMONSTRATION SEULE.
  //
  // Ce fichier disait le contraire : il les laissait a zero au motif que ce
  // commerce n'existe pas, et qu'un chiffre faux affiche en grand reste un
  // chiffre faux. L'argument tient. Mais le role de cette instance est de
  // montrer a un barbier ce que SON site afficherait, et une demonstration qui
  // masque son meilleur element ne demontre rien : le prospect ne voit ni la
  // case « 4,8/5 » de la bande de confiance, ni la note en tete des avis, ni le
  // lien vers la fiche. Les trois temoignages, eux, sont deja du contenu
  // d'exemple invente — la ligne etait donc deja franchie ailleurs.
  //
  // Deux garde-fous : l'instance porte `DEMO_MODE=true`, donc `X-Robots-Tag:
  // noindex` (aucun moteur ne relaie ce chiffre), et aucune donnee structuree
  // `aggregateRating` n'est publiee — un test le verifie.
  //
  // >>> A REMETTRE A ZERO, OU A REMPLACER PAR LES VRAIS CHIFFRES DE SA FICHE,
  //     DES LA PREMIERE INSTANCE CLIENT. <<<
  reviews: { rating: 4.8, count: 87 },

  // Les temoignages affiches sur la vitrine.
  //
  // >>> A REMPLACER POUR CHAQUE CLIENT. <<< Le plus simple, et le plus honnete :
  // recopier trois vrais avis de sa fiche Google, prenom et initiale compris.
  //
  // LISTE VIDE = LA SECTION « AVIS » DISPARAIT du site, comme l'equipe ou les
  // categories. C'est le bon reglage pour un commerce qui vient d'ouvrir : mieux
  // vaut pas de section du tout que trois cases vides.
  //
  // Ils ne sont pas publies en donnees structurees (Google ecarte les avis
  // auto-decernes) : leur seul role est de rassurer le visiteur.
  testimonials: [
    {
      id: 'tmo-attente',
      quote: "Je prends mon créneau le matin pour le soir même, et je passe sans attendre.",
      author: 'Damien L.',
      meta: 'Client depuis 2022',
      rating: 5,
    },
    {
      id: 'tmo-degrade',
      quote: "Le dégradé est net et il tient trois semaines. C'est tout ce que je demande.",
      author: 'Anthony V.',
      meta: 'Client depuis 2019',
      rating: 5,
    },
    {
      id: 'tmo-enfant',
      quote: "Mon fils avait peur de la tondeuse. Ils ont pris le temps, il y retourne seul maintenant.",
      author: 'Grégory M.',
      meta: 'Client depuis 2023',
      rating: 5,
    },
  ],

  // 0 = dimanche, 1 = lundi ... 6 = samedi. `null` = ferme ce jour-la.
  // `pause` est facultatif : l'omettre signifie journee continue.
  //
  // Ferme dimanche et lundi, nocturne le vendredi jusqu'a 21h, samedi en journee
  // continue : c'est le rythme d'un barbier de quartier, dont l'essentiel de la
  // clientele travaille en semaine.
  hours: {
    0: null,
    1: null,
    2: { open: '09:00', close: '19:00', pause: ['12:00', '14:00'] },
    3: { open: '09:00', close: '19:00', pause: ['12:00', '14:00'] },
    4: { open: '09:00', close: '19:00', pause: ['12:00', '14:00'] },
    5: { open: '09:00', close: '21:00', pause: ['12:00', '14:00'] },
    6: { open: '08:30', close: '17:00' },
  },

  // Toutes les combien de minutes un creneau est propose.
  //
  // 15 minutes ici, et non 30 : les prestations les plus courtes en durent 10 ou
  // 15. Au pas de 30, un rendez-vous « contours » de 10 minutes en immobiliserait
  // 30, et le barbier perdrait deux passages par heure creuse.
  slotStep: 15,
  // Delai minimum entre l'instant present et un rendez-vous pris en ligne.
  leadTimeMinutes: 60,

  // L'equipe. Vide = le commerce travaille seul, et le site n'en montre rien :
  // ni choix "avec qui" a la reservation, ni colonnes dans l'agenda.
  //
  // ⚠️ LA REGLE SE LIT DEPUIS LA PRESTATION : une prestation que personne ne
  // coche revient a TOUTE l'equipe ; des qu'une seule personne la coche, elle
  // n'est plus qu'a elle. Une liste vide ne veut donc pas dire "assure tout".
  //
  // La repartition ci-dessous fait voir la regle en fonctionnement : le rasage
  // au coupe-chou n'est qu'a Remi, les soins qu'a Karim, et TOUT LE RESTE n'est
  // coche par personne — donc assure par les trois, Yanis compris.
  //
  // Les couleurs sont celles de la charte : elles distinguent les colonnes de
  // l'agenda sans y introduire une teinte qui n'existe nulle part ailleurs.
  // Toutes portent du texte craie a 5:1 au moins.
  //
  // Les photos ne se mettent pas ici : elles se deposent depuis les reglages,
  // ou le navigateur les reduit avant de les enregistrer.
  staff: [
    {
      id: 'stf-remi',
      name: 'Rémi',
      role: 'Coupe et rasage',
      color: '#24405C',
      active: true,
      services: ['rasage-coupe-chou', 'coupe-rasage'],
    },
    {
      id: 'stf-karim',
      name: 'Karim',
      role: 'Coupe et barbe',
      color: '#3F6B52',
      active: true,
      services: ['coloration-barbe', 'soin-visage'],
    },
    {
      // Horaires propres : Yanis ne travaille pas le mardi et part a 18h les
      // autres soirs. C'est ce qui met la fonction « horaires particuliers » sous
      // les yeux d'un prospect sans qu'il ait a la chercher — un mardi, le
      // tunnel ne le propose pas, et l'agenda montre sa colonne vide.
      //
      // Les sept jours sont decrits : ces horaires REMPLACENT ceux du commerce,
      // ils ne s'y ajoutent pas.
      id: 'stf-yanis',
      name: 'Yanis',
      role: 'Coupe',
      color: '#4A5154',
      active: true,
      services: [],
      hours: {
        0: null,
        1: null,
        2: null,
        3: { open: '09:00', close: '18:00', pause: ['12:00', '14:00'] },
        4: { open: '09:00', close: '18:00', pause: ['12:00', '14:00'] },
        5: { open: '09:00', close: '18:00', pause: ['12:00', '14:00'] },
        6: { open: '08:30', close: '17:00' },
      },
    },
  ],

  // Les rayons du catalogue. L'ordre ci-dessous est celui affiche sur le site.
  //
  // Les descriptions disent ce que le rayon contient, pas ce qu'il vaut. Un
  // barbier n'a pas besoin qu'on vende sa coupe a sa place.
  categories: [
    { id: 'cat-coupe', name: 'Coupe',
      desc: "Aux ciseaux ou à la tondeuse. Shampooing en option, contours compris." },
    { id: 'cat-barbe', name: 'Barbe',
      desc: "De la mise en forme rapide au rasage complet à l'ancienne." },
    { id: 'cat-forfaits', name: 'Forfaits',
      desc: "Deux prestations dans le même rendez-vous, à un tarif plus bas que séparées." },
    { id: 'cat-soins', name: 'Soins', desc: '' },
  ],

  // `active: false` retire une prestation du site et de la reservation en ligne
  // sans la supprimer : le commercant peut toujours la caler lui-meme.
  //
  // ATTENTION : la duree d'une prestation ne peut pas depasser la plus longue
  // plage d'ouverture continue (ici samedi 08h30-17h00, soit 510 min, et 300 min
  // les jours a pause), sans quoi aucun creneau ne pourrait lui etre propose —
  // validateConfig le refuse.
  services: [
    // --- Coupe ---
    {
      id: 'coupe-homme',
      name: 'Coupe homme',
      desc: 'Aux ciseaux ou à la tondeuse, contours à la finition.',
      duration: 25,
      price: 18,
      active: true,
      category: 'cat-coupe',
    },
    {
      id: 'coupe-shampooing',
      name: 'Coupe + shampooing',
      desc: 'La même coupe, shampooing au bac avant de commencer.',
      duration: 35,
      price: 22,
      active: true,
      category: 'cat-coupe',
    },
    {
      id: 'coupe-enfant',
      name: 'Coupe enfant (–12 ans)',
      desc: "On prend le temps qu'il faut pour les premières fois.",
      duration: 20,
      price: 14,
      active: true,
      category: 'cat-coupe',
    },
    {
      id: 'coupe-tondeuse',
      name: 'Coupe à la tondeuse',
      desc: 'Une seule longueur sur toute la tête, contours nets.',
      duration: 15,
      price: 13,
      active: true,
      category: 'cat-coupe',
    },

    // --- Barbe ---
    {
      id: 'barbe-taille',
      name: 'Taille de barbe',
      desc: 'Mise en forme, contours et huile de finition.',
      duration: 20,
      price: 12,
      active: true,
      category: 'cat-barbe',
    },
    {
      id: 'barbe-serviette',
      name: 'Barbe à la serviette chaude',
      desc: 'Serviette chaude avant la taille : la peau tire moins après.',
      duration: 30,
      price: 18,
      active: true,
      category: 'cat-barbe',
    },
    {
      id: 'rasage-coupe-chou',
      name: 'Rasage traditionnel au coupe-chou',
      desc: 'Rasage complet à la lame, en deux passes, avec serviettes chaudes.',
      duration: 40,
      price: 25,
      active: true,
      category: 'cat-barbe',
    },
    {
      id: 'contours',
      name: 'Contours (nuque et tempes)',
      desc: 'Entre deux coupes, pour tenir la ligne une semaine de plus.',
      duration: 10,
      price: 8,
      active: true,
      category: 'cat-barbe',
    },

    // --- Forfaits ---
    {
      id: 'coupe-barbe',
      name: 'Coupe + barbe',
      desc: 'Les deux dans le même rendez-vous.',
      duration: 45,
      price: 28,
      active: true,
      category: 'cat-forfaits',
    },
    {
      id: 'coupe-rasage',
      name: 'Coupe + rasage traditionnel',
      desc: "Une heure, la coupe et le rasage à la lame.",
      duration: 60,
      price: 40,
      active: true,
      category: 'cat-forfaits',
    },
    {
      id: 'pere-fils',
      name: 'Père et fils',
      desc: 'Deux coupes à la suite, une adulte et une enfant.',
      duration: 45,
      price: 30,
      active: true,
      category: 'cat-forfaits',
    },

    // --- Soins ---
    {
      id: 'coloration-barbe',
      name: 'Coloration barbe',
      desc: "Pour couvrir le blanc, un ton en dessous des cheveux.",
      duration: 30,
      price: 20,
      active: true,
      category: 'cat-soins',
    },
    {
      id: 'soin-visage',
      name: 'Soin du visage express',
      desc: 'Gommage, vapeur et hydratation. Se cale après un rasage.',
      duration: 25,
      price: 22,
      active: true,
      category: 'cat-soins',
    },
  ],
};
