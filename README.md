# Banc de touche

Jeu de gestion d'équipe de football (inspiré de Football Manager), jouable entièrement dans le navigateur.
Angular 22 : composants autonomes, signaux (`signal`, `computed`, `linkedSignal`, `effect`, `input()`), nouveau control flow (`@if`, `@for`, `@switch`), application *zoneless*, routes chargées à la demande.

## Démarrer

Prérequis : **Node.js 22.22.3+ ou 24.15+** (exigence d'Angular CLI 22).

```bash
npm install
npm start            # http://localhost:4200
npm test             # tests unitaires du moteur (Vitest)
npm run build        # build de production dans dist/foot-manager/browser
```

Le routage utilise le hash (`#/jeu/...`) : le dossier `dist/foot-manager/browser` peut être servi tel quel par n'importe quel serveur statique.

## Le monde du jeu

Six championnats fictifs de 16 clubs (96 clubs au total), joués en même temps, semaine après semaine :

| Championnat | Pays | Niveau | Particularités |
| --- | --- | --- | --- |
| Division Élite | 🇫🇷 France | 1re division | Les 3 derniers descendent |
| Division Excellence | 🇫🇷 France | 2e division | Les 3 premiers montent ; budgets modestes, effectifs plus faibles |
| Premier Division d’Albion | Albion (Angleterre) | 1re division | Le championnat le plus riche |
| Liga Ibérica | Ibérie (Espagne) | 1re division | |
| Lega Aurea | Italia | 1re division | |
| Meisterliga | Teutonie (Allemagne) | 1re division | |

- **Choix du club** dans n'importe quel championnat. Les objectifs de la direction s'adaptent : jouer le titre, se maintenir, ou viser la montée en deuxième division.
- **Montées et descentes** entre l'Élite et l'Excellence à chaque intersaison (réputation ajustée, annonce dans la messagerie, objectifs de la saison suivante recalculés).
- **Coupes nationales** : la Coupe Nationale réunit les 32 clubs français et commence en seizièmes de finale ; chaque pays étranger a sa coupe à 16 clubs (Albion Cup, Copa del Rey Ibérica, Coppa Aurea, Teutonen-Pokal), qui commence en huitièmes. Primes et recettes suivent la richesse du championnat.
- **Base de joueurs** : plus de 2 600 joueurs au départ. Chaque club compte 26 joueurs (24 selon un modèle de postes et 2 espoirs de 17 à 20 ans), et 160 joueurs libres sont maintenus sur le marché. 37 nationalités ; chaque championnat recrute surtout dans son pays et ses filières habituelles (Albion : Britanniques et Irlandais ; Ibérica : Amérique du Sud ; Meisterliga : Autriche, Suisse, Pologne, Turquie…). Les noms sont des noms de famille courants, sans footballeurs réels.
- **Écrans** : sélecteur de championnat sur la page Compétitions (classement, calendrier, coupe du pays, statistiques), filtre « Championnat » sur le marché des transferts, championnat du club sur la fiche joueur.
- **Effectifs IA** : au-delà de 28 joueurs, les moins utiles sont libérés ; le marché des joueurs libres est complété ou élagué à chaque intersaison.
- **Performances** : une semaine complète (48 matchs simulés) prend environ 70 ms. La sauvegarde est compressée (lz-string, environ 13 fois plus petite) dans un Web Worker et écrite en différé, donc l'interface ne se bloque pas. Les matchs des autres clubs ne gardent que les buts et expulsions, sans texte ni notes. Les anciennes sauvegardes (v6) sont migrées : la saison en cours continue, et les nouveaux championnats démarrent à la saison suivante.

## Fonctionnalités (MVP)

| Module | Écran | Contenu |
| --- | --- | --- |
| Accueil & choix du club | `/`, `/nouvelle-partie` | Reprise de la sauvegarde, import JSON, 96 clubs fictifs dans 6 championnats (niveau, réputation, budget, note du onze, joueurs clés, attente de la direction) |
| Tableau de bord | `/jeu` | Prochain match, mini-classement, moral, trésorerie, masse salariale, alertes (blessés, fatigue, offres), messagerie, bilan de fin de saison |
| Effectif | `/jeu/effectif` | Tableau triable/filtrable (poste, âge, note, potentiel, valeur, salaire, forme, fatigue, stats), fiche joueur : liste des transferts (seule façon de vendre : les clubs font leurs offres chaque semaine), prolongation, résiliation |
| Tactique | `/jeu/tactique` | 5 formations (4-3-3, 4-4-2, 3-5-2, 4-2-3-1, 5-3-2), mentalité, terrain interactif, adaptation au poste, équilibre attaque/milieu/défense |
| Transferts | `/jeu/transferts` | Marché filtrable, offres avec contre-propositions, joueurs libres, offres reçues des clubs IA, liste des joueurs à vendre |
| Compétitions | `/jeu/competitions` | Classement (V/N/D, BP/BC, diff., points, forme), calendrier semaine par semaine avec faits de match, tableau de coupe, buteurs/passeurs/notes |
| Match | `/jeu/match` | Avant-match (compositions, forces), direct minute par minute (vitesse, pause, changement de mentalité), résultat immédiat, notes des joueurs, autres résultats |
| Club | `/jeu/club` | Infrastructures, entraînement, centre de formation, direction, carrière |
| Finances | `/jeu/finances` | Trésorerie, budgets, recettes/dépenses par catégorie, solde hebdomadaire, plus gros salaires, grand livre |

### Systèmes avancés

| Système | Où | Fonctionnement |
| --- | --- | --- |
| Condition physique, fatigue, blessures | Effectif (filtre « Infirmerie »), Club › Entraînement | Fatigue +20 à 30 par match, récupération hebdomadaire selon l'intensité d'entraînement et le centre d'entraînement. Risque de blessure lié à la fatigue ; 7 types de blessures (contracture → ligaments croisés) |
| Centre de formation | Club › Centre de formation | Promotion annuelle (semaine 17) de 2 à 5 « regens » de 15-17 ans selon le niveau du centre, progression mensuelle, promotion ou libération, passage pro automatique à 19 ans |
| Négociation de contrats | Fiche joueur › « Négocier une prolongation », Transferts | Salaire, durée, prime à la signature, clause libératoire, statut promis. L'agent contre-propose ; 3 tentatives puis rupture des discussions pendant 4 semaines. Les recrutements se font en deux temps : indemnité avec le club, puis contrat avec le joueur |
| Moral individuel | Effectif, fiche joueur | Résultats, note de match et temps de jeu comparé au statut promis (« Joueur clé » attend 85 % des matchs). Le moral pèse sur le rendement ; un joueur mécontent attire les offres |
| Direction | Club › Direction, tableau de bord | 4 à 5 objectifs pondérés (championnat, coupe, trésorerie, masse salariale, jeunes), confiance mise à jour après chaque match et toutes les 6 semaines, limogeage sous 12 |
| Scouting et brouillard de guerre | Transferts › Scouting | Les notes des joueurs extérieurs sont des intervalles (pointillés). Observer un joueur resserre l'intervalle chaque semaine ; à 100 %, note et potentiel exacts. Affronter une équipe renseigne aussi |
| Infrastructures | Club › Infrastructures | Stade (+15 % de places/niveau), centre d'entraînement, centre de formation, cellule de recrutement ; niveaux 1 à 5, coût, durée de chantier, entretien hebdomadaire |
| Réputation et carrière | Club › Carrière | Réputation de l'entraîneur selon les attentes et les trophées. Offres d'emploi en fin de saison (et parfois en cours) ; après un limogeage, choix d'un nouveau club |
| Règles de composition | Effectif (bandeau), Tactique, avant-match | Max. 25 joueurs de plus de 21 ans, min. 4 formés au club, max. 3 extracommunautaires dans le onze. Une feuille de match non conforme bloque le coup d'envoi |
| Match en 2D | Écran de match | `<canvas>` animé (composant `MatchPitchComponent`) : 22 joueurs selon les formations, bloc qui coulisse, pressing, simulation physique continue dirigée par les actions du moteur (voir plus bas) |
| Match en direct persistant | Écran de match | Le direct vit dans un service racine : changer de page le met en pause sans le perdre. La graine, les équipes figées au coup d'envoi et les décisions horodatées sont sauvegardées : après un rechargement, le match est reconstruit à l'identique par rejeu (`engine/live-match.ts`) |
| Changements tactiques en match | Panneau « Banc de touche » | Résumé de la situation (score, minute, infériorité numérique, fatigue), plans de jeu conseillés selon le scénario (Fermer le match, Tout pour l'attaque, Bloc bas et contres, Rester compact à dix, Faire le siège…), 5 mentalités, système, consignes détaillées, endurance des deux équipes, 5 remplacements. L'IA change elle aussi de plan selon le score |
| Consignes d'équipe | Tactique, panneau de match | Pressing, ligne défensive, passes, largeur, engagement, jeu de contre, gagner du temps : chaque consigne modifie le moteur (`engine/game-plans.ts`) et l'endurance |
| Glisser-déposer | Tactique | Échanger deux joueurs, titulariser un joueur de la liste, ou déplacer un joueur sur une zone libre : son poste est recalculé selon la zone (positions personnalisées sauvegardées avec la tactique) |
| Potentiel des recruteurs | Effectif, transferts, formation, boosters | Le potentiel réel n'est jamais affiché : les recruteurs donnent des étoiles (½ à 5) et une fourchette, d'autant plus fiables que la cellule de recrutement est développée et le joueur observé |
| Touche Espace | Partout | « Suivant » : semaine suivante, puis sur l'écran de match lancer le direct, aller au coup de sifflet final, valider le résultat |
| Boosters des recruteurs | Boosters | Plus de boutique : on envoie un recruteur du staff en mission (consigne : jeunes, confirmés, bonnes affaires, poste… ; durée 2, 4 ou 8 semaines ; coût selon sa compétence). À son retour il rapporte un booster Bronze, Argent, Or ou Élite selon sa compétence, la durée, la cellule de recrutement, ses traits et vos avantages. Le booster révèle 3 joueurs inédits « repérés par » ce recruteur, avec un potentiel d'autant plus fiable qu'il est compétent ; on en signe un |
| Niveau d'entraîneur | Boosters, Staff | XP gagnée par les victoires, buts, clean sheets, tours de coupe, objectifs et titres. Chaque niveau rapporte un point d'avantage |

### Personnages (inspiré de Crusader Kings III)

| Système | Où | Fonctionnement |
| --- | --- | --- |
| Conseil (staff) | `/jeu/staff` | 6 postes : entraîneur adjoint (force en match, endurance des entrants), préparateur physique (récupération, blessures), médecin (durée des blessures), responsable de la formation (progression et potentiel des jeunes), directeur sportif (salaires, prix de vente, indemnités) et recruteurs (vitesse et fiabilité du scouting, missions ; autant que le niveau de la cellule de recrutement). Chaque personnage a une compétence /20, un âge, un salaire, un contrat et une opinion de l'entraîneur |
| Traits | Fiches du staff | 13 traits (Charismatique, Perfectionniste, Paresseux, Ambitieux, Loyal, Avide, Diplomate, Visionnaire, Globe-trotteur, Méticuleux, Colérique, Vétéran, Innovateur) qui multiplient l'effet du poste, ajoutent des effets propres, changent le salaire ou le comportement (un Loyal ne descend jamais sous 40 d'opinion, un Ambitieux supporte mal les mauvais résultats) |
| Opinion | Fiches du staff | Monte avec les victoires, baisse avec les défaites et les licenciements de collègues. Elle module le rendement ; sous 15, le personnage démissionne. Les clubs rivaux tentent de débaucher les meilleurs en fin de saison |
| Recrutement du staff | Staff › Candidats | Marché de 10 candidats renouvelé toutes les 8 semaines, réputation minimale selon la compétence, prime à la signature (4 semaines de salaire), indemnité de licenciement (8 semaines) |
| Modes de vie | Staff | 5 voies (Tacticien, Mentor, Négociateur, Meneur d'hommes, Intendant), chacune avec 4 avantages à débloquer dans l'ordre avec les points gagnés en montant de niveau. Les avantages acquis restent si l'on change de voie |
| Événements à choix | Fenêtre modale | Environ une semaine sur cinq, un personnage ou un joueur provoque un événement (nouvelle méthode, séminaire, tension dans le vestiaire, tentative de débauchage, conférence de presse…). Chaque option annonce ses conséquences : argent, opinion, compétence, modificateurs temporaires. Le temps ne s'écoule pas tant qu'on n'a pas tranché |
| Effets | Staff › Effets en vigueur | 19 caractéristiques (`EffectKey`) agrégées depuis le staff, les avantages et les modificateurs (`engine/characters.ts`), lues par le moteur via `fx(state, clé)` : match, condition physique, blessures, scouting, boosters, formation, contrats, transferts, moral, direction, recettes, entretien |

### Ergonomie et tactique avancée

| Système | Où | Fonctionnement |
| --- | --- | --- |
| Fiche joueur universelle | Partout | Un clic sur le nom d'un joueur (messagerie, classements, transferts, match, formation, boosters, événements…) ouvre sa fiche : note ou fourchette selon le scouting, potentiel des recruteurs, condition, moral, forme, valeur, contrat, clause, statistiques et présence sur les derniers matchs. Depuis la fiche : faire une offre, proposer un contrat, faire observer, ouvrir dans l'effectif (`PlayerCardService`, `PlayerLinkComponent`) |
| Animation du match | Écran de match | Pas de temps réel (vitesse identique à 60 ou 144 Hz), ballon sur des trajectoires avec courbe d'accélération et hauteur (lobs, frappes avec traînée), porteur du ballon, circulation entre deux actions, joueurs mus par un ressort amorti (accélérations et freinages naturels), pressing qui suit le ballon, pelouse pré-rendue, célébration animée. Aucune téléportation : chaque trajectoire part de la position réelle du ballon |
| Événements contextuels | Fenêtre modale | En plus des événements aléatoires, des « crises » naissent de la situation et passent en priorité : série de défaites ou de victoires, cadre mécontent, star blessée, fin de contrat, prodige au centre de formation, choc contre un gros, sponsor quand on est en tête, trésorerie dans le rouge, ultimatum de la direction, querelle entre deux membres du staff, rumeur de transfert, sélection nationale, vétéran mentor, démission d'un membre du staff. La fenêtre présente les personnages, joueurs et clubs concernés |
| Identité du club | Club › Identité | Nom, sigle, stade et couleurs modifiables, avec aperçu de l'écusson et du maillot |
| Page Tactique | `/jeu/tactique` | Trois onglets : Composition (terrain, légende des postes, fiche de chaque joueur), Consignes (regroupées par phase de jeu, avec l'explication de l'option choisie, profil tactique calculé par le moteur et 13 plans prêts à l'emploi), Scénarios |
| Nouvelles consignes | Tactique, banc de touche | Rythme, couloir d'attaque, marquage, choix de tir, coups de pied arrêtés, relance du gardien, piège du hors-jeu. Plusieurs dépendent de l'adversaire : les ailes contre un bloc étroit, l'axe contre une équipe étirée, la relance courte punie par un pressing haut, le hors-jeu puni par le jeu direct |
| Consignes de scénario | Tactique › Scénarios | Plan de jeu appliqué automatiquement en match quand une situation se présente (réduits à dix, adversaire réduit, menés, devant, parité, équipe fatiguée), à partir d'une minute choisie et par ordre de priorité. Modèles « Prudent » et « Ambitieux ». Le direct reste rejouable à l'identique |
| Joueurs de booster non signés | Boosters, Transferts | « Ne signer personne », ou les cartes non choisies : les joueurs deviennent libres avec le rapport du recruteur et restent visibles sur le marché (filtre « Repérés par mes recruteurs ») |

### Chaînes d'événements

115 événements au total. Certains choix programment une suite quelques semaines plus tard, avec les mêmes protagonistes (`eventQueue`) :

| Départ | Suite |
| --- | --- |
| Rendez-vous discret (une star dîne avec un rival) → faire comme si de rien n'était | Demande de transfert |
| Un investisseur étranger → accepter | L'investisseur hausse le ton (recruter une vedette ou lui tenir tête) |
| Le laboratoire tactique (l'adjoint propose un nouveau système) → tenter l'expérience | Le système porte ses fruits ? |
| Une plateforme veut filmer le club → accepter | L'épisode qui fait jaser |
| Nuit agitée → fermer les yeux | Récidive |
| Réclamation salariale → refuser | Grève de l'entraînement |
| Fuite dans la presse → mener l'enquête | La taupe démasquée (le membre du staff le plus rancunier) |

Autres nouveaux dilemmes : bagarre à l'entraînement entre deux joueurs, un géant convoite votre pépite, le super-agent, épidémie de grippe, tempête sur le stade, retour de la légende, polémique arbitrale après une défaite, mal du pays d'un joueur étranger, enveloppe de la direction satisfaite, gala de charité.

Troisième vague : brassard de capitaine (vétéran ou jeune), pique de l'entraîneur adverse, prix des places, droits du nom du stade, nouveau maillot, erreur de diagnostic, heureux événement, clause libératoire réclamée par un agent, plateforme de données, canicule en début de saison, rotation avant un match de coupe, recruteur courtisé par un rival.

Page Tactique : chaque joueur aligné porte une pastille avec son poste de prédilection (encadrée en rouge s'il joue hors poste), et un clic sur son nom (terrain ou liste) ouvre sa fiche sans gêner le glisser-déposer.

### Match 2D : un vrai match continu

Le terrain en direct est une simulation physique continue (`MatchPitchComponent`), en mètres sur un terrain de 105 × 68 :
- **Rien ne se téléporte.** Le ballon a une vitesse, roule et ralentit, peut être levé (gravité, rebonds). Les joueurs accélèrent et freinent avec une vitesse maximale, et gardent leur distance entre eux.
- **Le moteur dirige, le terrain joue.** Les actions de chaque minute (attaque dans un couloir, tir et son issue, faute) deviennent des consignes données à un « réalisateur ». Les joueurs y parviennent par du jeu réel : passes vers des lignes libres, conduites de balle, centres, ballons longs, relances du gardien. Le résultat (but, arrêt, tir à côté) est donc toujours celui du moteur, seul le chemin est visuel.
- **La possession ne change que par contact** : tacle, interception d'une passe, ballon perdu récupéré par le joueur le plus proche (le gardien sort s'il est à moins de 12 m).
- **Ballons arrêtés** : touche, six mètres, corner et coup franc remettent le jeu en route avec les adversaires à distance ; engagement après chaque but et à la reprise ; célébration du buteur.
- Le placement suit les consignes en cours des deux équipes : mentalité, ligne défensive et piège du hors-jeu, largeur, pressing, couloir d'attaque, jeu direct ou court. Chaque pastille est un vrai joueur (remplacements, expulsions, cartons), et les noms du porteur, du receveur et du buteur s'affichent.
- **Tableau d'affichage synchronisé** : le score change au moment où le ballon franchit la ligne (avec « BUT ! »), pas quand le moteur calcule la minute. Les faits de jeu de la minute s'affichent une fois joués à l'écran ; la mi-temps et le coup de sifflet final attendent la fin de l'action en cours.
- **Condition physique** : chaque joueur commence le match avec une condition qui dépend de sa fatigue (100 = frais, 70 pour une fatigue de 50). Elle baisse à chaque minute, plus vite avec le pressing haut, une mentalité offensive et l'âge (un gardien s'use trois fois moins). Des jambes lourdes pèsent sur la force de l'équipe, donc un changement frais a un vrai effet. L'IA sort désormais ses joueurs les plus fatigués. La condition est visible avant le match (titulaires et remplaçants) et pendant (les trois plus fatigués dans le panneau, tout le monde dans la fenêtre des changements).
- **Pause pour les changements** : le bouton « Changements (pause) » arrête le match et ouvre une fenêtre avec le onze sur le terrain et le banc, avec la condition et la note de chacun. On peut enchaîner plusieurs remplacements, puis « Reprendre le match ».
- **Cadence** : le direct n'avance d'une minute que quand le terrain a joué ses actions. Un match complet dure environ 1 min 40 en ×4, plus longtemps en ×1 et ×2. « Aller au coup de sifflet final » reste disponible.

Quatrième vague :
- **Options réservées, comme dans Crusader Kings.** Certains choix n'apparaissent débloqués que si votre mode de vie ou votre staff le permet ; sinon ils restent visibles mais grisés :
  - Meneur d'hommes : discours de l'homme fort pendant une crise ;
  - Négociateur : commission du super-agent divisée par deux, compromis avec les ultras ;
  - Tacticien : démonstration au tableau lors d'un désaccord tactique ;
  - Mentor : convaincre la famille d'un jeune prodige, prendre un jeune sous son aile ;
  - staff Méticuleux : protocole d'hygiène pendant une épidémie ;
  - staff Diplomate : activer son réseau face aux achats d'un rival.
- **Chaîne en trois actes, « Le gamin du club de quartier » :** essai du jeune, puis intégration d'un prodige au centre de formation, puis tentative de débauchage d'un grand club six semaines plus tard.
- **Nouveaux événements :** ultras qui menacent de boycotter, subvention du maire, retour d'un enfant du club en fin de carrière, désaccord tactique avec l'adjoint, message de trop sur les réseaux sociaux, hécatombe à l'infirmerie, tournée à l'étranger, départ de l'intendant, rival qui casse sa tirelire, tournoi international de jeunes, fin de contrat dans le staff, dernière ligne droite de la saison.

### Scénarios de joueurs

- **Personnalités.** Chaque joueur peut avoir 0 à 2 traits parmi Meneur, Professionnel, Fêtard, Sanguin, Ambitieux, Fidèle, Décisif, Boute-en-train et Discret. Le trait est stable, déduit de l'identifiant du joueur, et peut évoluer au fil des scénarios. Il s'affiche dans la fiche joueur : toujours pour vos joueurs, pour les autres seulement s'ils sont bien observés (connaissance de 60 % ou plus).
- **La personnalité choisit les protagonistes et débloque des options** : un Fidèle refuse le pont d'or ou accepte son rôle de remplaçant, un Meneur tranche la dispute des penaltys ou prend la parole après deux défaites, le Fêtard sort la nuit, le Sanguin explose, le Boute-en-train fait une blague au staff, le Discret manque de confiance.
- **Trajectoires en plusieurs actes** :
  - Duel pour une place : le remplaçant ronge son frein quatre semaines plus tard.
  - Panne sèche d'un attaquant : délivrance (il peut devenir Décisif) ou rechute, avec plus de chances pour un Décisif, moins pour un Discret.
  - L'homme en forme : un géant fait une offre quelques semaines plus tard.
  - Le maître et l'élève : huit semaines de tutorat, l'élève gagne +2 en note et en potentiel et devient Professionnel, le maître peut devenir Meneur.
- **Autres scénarios** : les inséparables, qui tire les penaltys, l'ailier qui se voit avant-centre (son poste change), le pont d'or d'un championnat exotique, le petit frère à recruter, le coup de sang (une préparation mentale transforme le Sanguin en Professionnel), la blague de trop, le talent discret, le chouchou des tribunes, le nouvel agent.

### Cinquième vague

- **Trajectoires de joueurs** :
  - Deux clans dans le vestiaire, puis la guerre des clans si rien n'est réglé (option Meneur d'hommes pour réconcilier).
  - Longue rééducation, puis retour du guerrier, programmé à la fin réelle de la blessure ; le joueur peut devenir Décisif.
  - Il joue son contrat, puis l'heure de la négociation six semaines plus tard (un Fidèle accepte plus facilement).
  - Douleur cachée, puis blessure aggravée si l'on a laissé jouer le joueur (moins probable pour un Professionnel).
  - La dernière saison d'un vétéran : il peut devenir **entraîneur adjoint ou responsable de la formation**. Ses traits de joueur deviennent des traits de personnage : Meneur → Charismatique, Professionnel → Méticuleux, Fidèle → Loyal, Sanguin → Colérique, Ambitieux → Ambitieux, Boute-en-train → Diplomate, plus Vétéran.
  - Insultes en tribune, fondation caritative d'un joueur, clause libératoire payée par un rival (il part si son moral est sous 70 ; un Fidèle peut refuser).
- **Vie du club** : section féminine, anniversaire du club, concert au stade, partenariat avec une académie étrangère, journaliste hostile, élection à la présidence, dernier jour du mercato.

### Entre les matchs : la semaine de travail

Page `/jeu/semaine` (onglet « Semaine », avec un badge des tâches restantes, rappelées sur le tableau de bord et au premier appui sur « Suivant ») :

- **Programme d'entraînement** : une séance par jour, du lundi au vendredi, parmi Tactique, Physique, Technique, Coups de pied arrêtés, Récupération et Repos. Les effets sont réels :
  - force pour le match du week-end ;
  - risque de blessure ;
  - fatigue appliquée en fin de semaine ;
  - progression des jeunes ;
  - moral.

  Quatre programmes types : Équilibré, Spécial match, Fraîcheur, Développement.
- **Préparation du match** : fiche du prochain adversaire (forme, lignes comparées aux vôtres, joueur clé) et un plan à choisir parmi cinq : neutraliser son meilleur joueur, attaquer sa défense, gagner le milieu, tester son gardien, bloc bas et contres. Le gain va de +0,5 % à +3 % selon que le plan répond à ses forces et faiblesses réelles. L'adjoint note chaque plan de 1 à 5 étoiles, de façon d'autant plus fiable qu'il est compétent.
- **Entretiens individuels** : deux par semaine (trois pour les modes de vie Mentor et Meneur d'hommes) avec quatre approches : féliciter, exiger davantage, promettre du temps de jeu, soutenir. Les réactions dépendent de la personnalité et du moral : un Sanguin explose si on l'exige, un Professionnel progresse, un Discret adore les félicitations, et une promesse relève le statut du joueur.
- **Conférence de presse** : deux questions tirées selon le contexte (série en cours, prochain adversaire, meilleur buteur, objectif de la direction), avec trois réponses chacune. Les effets portent sur le moral, la confiance de la direction et la force en match.

### Match en direct

- **Continuité** : voir « Match 2D : un vrai match continu » ci-dessus.
- **Causerie de la mi-temps** : le match s'arrête à la 45e minute. Quatre tons au choix : rester calme, encourager, coup de gueule, revenir au plan de jeu. L'effet sur la seconde période dépend du score : un coup de gueule réveille une équipe menée mais crispe une équipe qui gagne. La causerie est enregistrée comme une décision, donc rejouée à l'identique.

### Sixième vague d'événements

Plus de 75 nouveaux événements :
- **Joueurs** : mariage, retour à l'école, période de jeûne, rumeur de paris, guerre des farces (3 actes), brassard contesté, cours de français, frère agent, pari du tatouage, numéro 10, match du quartier, poussée de croissance, influenceur, nuits sur la console, rituel porte-bonheur, jubilé, documentaire, rêve de Ballon d'or…
- **Staff** : licence Pro, brassières GPS, cellule vidéo, stage en altitude, complément miracle.
- **Club** : toiture qui fuit, tramway, sponsor fluo, tifo géant, podcast, pelouse malade, mascotte disparue.
- **Contexte du classement** : relégation, course au titre, série d'invincibilité, série de nuls, calendrier infernal.
- **Liés aux championnats** : course à la montée, promu qui découvre l'élite, géant étranger qui veut votre meilleur joueur (vraie offre dans Transferts), mission de recrutement à l'étranger (connaissance des meilleurs espoirs d'un championnat), tournoi international, soldes d'un relégable, diffusion à l'étranger, mal du pays d'un joueur étranger.
