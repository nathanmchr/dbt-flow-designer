# Leçons

## Fidélité de l'aperçu dbt

- Erreur : exécuter le modèle sur DuckDB alors que l'aperçu doit reproduire le résultat du moteur de la base connectée.
- Règle : compiler le même projet dbt avec l'adaptateur source et exécuter sa requête en lecture seule ; intégrer les dépendances dans des CTE au lieu de créer des relations source.
- Explication : utiliser les mêmes données avec un autre moteur peut changer les calculs, les conversions et la prise en charge du SQL ; l'export et l'aperçu doivent partager la génération du modèle.

## Pagination des requêtes

- Erreur : laisser des valeurs par défaut différentes entre le panneau, le client API et le modèle de requête backend.
- Règle : le nombre de lignes par défaut doit être défini de manière cohérente sur toute la chaîne ; pour les résultats de requête, il vaut 25.
- Explication : même si le sélecteur affiche la bonne option, un autre défaut côté client ou serveur peut produire un premier chargement incohérent.

## Mouvement du panneau Query Results

- Erreur : coupler une transition d'opacité au glissement vertical du panneau inférieur.
- Règle : le panneau Query Results doit rester pleinement opaque pendant son entrée et sa sortie ; seul son déplacement vertical est animé.
- Explication : le fondu rend le contenu visuellement instable alors que la translation suffit à communiquer l'ouverture et la réduction.

## Libellés du nœud Database

- Erreur : exposer le terme technique interne `adapter` dans le résumé du nœud.
- Règle : afficher `type` dans l'interface tout en conservant `adapter` comme clé interne pour la compatibilité des modèles.
- Explication : le vocabulaire visible doit décrire le choix utilisateur sans imposer la structure technique du fichier.

## Coffre des secrets du projet

- Erreur : proposer un coffre lié au système d'exploitation alors que l'application doit rester portable entre plateformes.
- Règle : pour cette application, conserver la racine du coffre dans les données propres au logiciel et utiliser une clé chiffrée distincte par projet, sans dépendance à un trousseau natif.
- Explication : cette structure fonctionne de façon identique sur macOS, Windows et Linux et permet d'ajouter ultérieurement un mot de passe maître sans modifier les fichiers de projet.

- Erreur : considérer le coffre terminé après les tests unitaires et un appel HTTP isolé, sans vérifier le parcours réel depuis le formulaire jusqu'au fichier téléchargé et au rechargement.
- Règle : une persistance de secret n'est validée qu'après un test navigateur complet qui saisit le secret, sauvegarde, inspecte le fichier, actualise puis réimporte.
- Explication : les tests de chaque couche peuvent réussir alors qu'un état React, un backend non redémarré ou une forme de données réelle empêche l'enveloppe d'entrer dans le modèle.

- Erreur : considérer `localhost` et `127.0.0.1` comme interchangeables dans une politique CORS.
- Règle : une application locale doit appeler son API avec le même nom d'hôte que la page et tester explicitement toutes les origines locales supportées.
- Explication : ces deux adresses atteignent la même machine, mais restent des origines web différentes ; le navigateur peut donc bloquer le chiffrement avant même que la requête atteigne le coffre.

- Erreur : valider uniquement qu'un port répond sans confirmer l'identité de l'application qui répond.
- Règle : avant tout test d'intégration local, vérifier un marqueur propre au service et la présence des routes attendues, surtout lorsque plusieurs projets utilisent les ports de développement usuels.
- Explication : macOS peut laisser coexister une écoute générique et une écoute spécifique sur le même port ; une requête vers `127.0.0.1` peut alors atteindre un autre projet malgré un processus dbt Flow Designer encore actif.

- Erreur : considérer `setState` suivi d'un effet de persistance comme une écriture atomique avant actualisation.
- Règle : lorsqu'une réponse réseau produit la seule copie persistable d'un secret chiffré, écrire cette enveloppe immédiatement avant de mettre à jour l'état visuel.
- Explication : React planifie le rendu et les effets ; une actualisation entre la réponse du coffre et l'effet suivant peut sinon conserver le modèle nettoyé sans son enveloppe.

## Masque des titres sticky

- Erreur : interpréter « masquage en transparence » comme un fond translucide avec flou.
- Règle : lorsqu'un effet est comparé aux masques de bord existants, agir sur l'opacité du contenu avec `mask-image`, sans ajouter de surface colorée devant lui.
- Explication : un voile masque par recouvrement, tandis qu'un masque CSS fait réellement disparaître progressivement les éléments qui passent sous la zone sticky.

- Erreur : conserver un masque supérieur sur le conteneur qui contient aussi les titres sticky.
- Règle : isoler le masque sur la couche de contenu défilante et ne jamais masquer le contrôle sticky lui-même.
- Explication : même avec une hauteur CSS stable, le masque global coupe différemment les pixels du titre pendant son passage en position sticky et crée un faux saut visuel.

- Erreur : remplacer le déplacement demandé des cartes par une simple révélation verticale du conteneur.
- Règle : distinguer l'animation du contenant de celle de son contenu ; si les cartes doivent « descendre depuis le titre », leur position doit réellement être interpolée depuis ce point d'origine.
- Explication : l'ouverture du conteneur contrôle le clipping, mais seule une transformation propre à chaque carte matérialise son trajet depuis ou vers le titre.

- Erreur : faire converger toutes les cartes vers le titre sans rendre la pile lisible dans le temps.
- Règle : un « effet pile » doit combiner une origine commune et une cascade ordonnée, puis inverser cet ordre à la fermeture.
- Explication : sans décalage temporel, les cartes se recouvrent et leur trajet individuel devient visuellement indistinct, même si leurs coordonnées sont correctes.

- Erreur : supprimer le `padding-top` structurel parce qu'il coïncidait avec l'espace signalé.
- Règle : avant de retirer un espacement existant, distinguer la valeur intentionnelle du décalage conditionnel perçu pendant l'animation ou l'apparition du scroll.
- Explication : la mesure de 16 px identifiait le rythme normal de la sidebar, pas nécessairement l'anomalie visuelle décrite.

- Erreur : interpréter l'effet demandé comme des cartes superposées qui se distribuent en cascade.
- Règle : lorsqu'une animation est décrite comme un « fil tiré », conserver les distances relatives entre tous les éléments et transformer leur liste comme un seul bloc.
- Explication : une transformation par carte produit un éventail ; une transformation commune produit une chaîne continue qui sort du titre et y retourne.

- Erreur : complexifier successivement l'animation alors que le résultat recherché pouvait rester un accordéon discret.
- Règle : lorsqu'un utilisateur demande un effet plus simple, réduire le nombre de couches animées et privilégier une seule transition groupée, courte et mesurable.
- Explication : un glissement commun de faible amplitude avec un fondu conserve le sens du mouvement sans introduire de mécanique visuelle difficile à régler.

- Erreur : conclure que le décalage était corrigé à partir d'une seule mesure géométrique qui ne reproduisait pas le ressenti signalé.
- Règle : pour un décalage lié au scroll, tester tous les passages sans débordement → débordement → sans débordement, avec les mêmes catégories et dimensions que l'utilisateur.
- Explication : une mesure stable dans un état isolé ne couvre ni les effets transitoires de l'accordéon, ni l'ancrage du navigateur, ni les changements de zone utile au moment précis où le scroll bascule.

- Erreur : attribuer le décalage au retrait sticky de 16 px alors que cet alignement était intentionnel.
- Règle : conserver l'inset validé des titres et isoler uniquement la différence de comportement provoquée par l'apparition conditionnelle de la scrollbar.
- Explication : déplacer un espacement structurel change le design sans garantir la disparition du petit saut signalé ; rendre le mode de scroll constant supprime cette variable tout en préservant le placement voulu.

- Erreur : se fier uniquement aux rectangles CSS, alors que la vidéo montrait un saut de rastérisation sans changement de géométrie DOM.
- Règle : lorsqu'un déplacement reste invisible dans les mesures de layout, comparer les images avant et après et stabiliser la couche de rendu concernée.
- Explication : ici, le contenu se décalait de deux pixels physiques exactement lorsque le débordement devenait actif ; maintenir la couche de scroll préparée évite sa recréation et son nouvel arrondi au pixel Retina.

- Erreur : ajouter des indices de composition GPU au scroller et aux titres sans supprimer le cumul de responsabilités qui provoquait le changement de rendu.
- Règle : quand un correctif de composition ne résout pas un saut lié au débordement, revenir à la structure et séparer le cadre, le masque et la surface de défilement avant toute autre optimisation.
- Explication : `transform` et `will-change` ne garantissent pas une rasterisation identique quand le contenu devient réellement scrollable ; ils peuvent au contraire multiplier les couches entourant les éléments sticky.

- Erreur : compenser la largeur de la scrollbar par une marge négative sans réserver sa gouttière lorsque le contenu est trop court pour défiler.
- Règle : si le scroller est élargi pour placer sa scrollbar hors de la largeur utile, réserver cette gouttière dans tous ses états avec `scrollbar-gutter: stable`.
- Explication : sans débordement, les 12 px réservés à la scrollbar disparaissaient et le contenu avançait vers la droite, alors que les panneaux longs restaient correctement alignés.

- Erreur : supposer que `scrollbar-gutter: stable` réserve toujours une largeur visible, alors qu’une scrollbar macOS superposée peut conserver une gouttière mesurée à 0 px.
- Règle : compenser uniquement la largeur réellement occupée par la scrollbar du conteneur, au lieu d’utiliser une marge négative fixe ou de déduire son comportement du seul navigateur de test.
- Explication : la capture Retina montrait 34 px physiques à gauche contre 10 px à droite, soit 17 px contre 5 px CSS ; la différence correspond exactement aux 12 px de la compensation fixe restée active.

- Erreur : différer la mesure des masques avec `requestAnimationFrame` alors que l’événement de scroll arrive déjà au rythme de rendu du navigateur.
- Règle : pour un masque directement indexé sur `scrollTop`, calculer et appliquer sa position dans le même événement de scroll, puis réserver la mise en file à des événements secondaires comme le redimensionnement.
- Explication : ajouter une frame d’attente fait suivre le masque derrière les cartes pendant les gestes rapides, même si ses valeurs finales sont correctes.

## Contrôles du sélecteur Table

- Erreur : laisser les styles génériques des champs texte s'appliquer aux cases à cocher, ce qui leur donne toute la largeur du conteneur et repousse leur libellé hors de la zone visible.
- Règle : définir explicitement les dimensions intrinsèques des contrôles `checkbox` et `radio`, puis vérifier que chaque ligne conserve une colonne flexible pour son libellé.
- Explication : les contrôles natifs ne partagent pas la même géométrie que les champs texte ; une largeur globale doit donc être neutralisée pour préserver l'alignement et la lisibilité.

- Erreur : limiter la largeur du type de colonne sans ancrer explicitement sa cellule au bord droit.
- Règle : combiner la troncature avec `justify-self: end` et un alignement de texte à droite pour que les types courts et longs partagent toujours la même terminaison visuelle.
- Explication : dans une colonne de grille automatique, une largeur maximale réduit l'élément mais ne garantit pas sa position dans la piste restante.

## Persistance de l’historique du flow

- Erreur : restaurer uniquement le modèle courant tout en réinitialisant la pile et l’index Undo / Redo au chargement.
- Règle : considérer le modèle courant et la position dans son historique comme un état cohérent à restaurer ensemble, en rejetant un historique qui ne correspond plus au modèle chargé.
- Explication : les boutons Undo et Redo sont dérivés de la pile et de son index ; restaurer seulement les nœuds et les arêtes ne peut donc pas préserver leur disponibilité après actualisation.

- Erreur : supprimer systématiquement le mot de passe lors de la persistance sans prévoir un canal séparé pour la continuité de la connexion après actualisation.
- Règle : conserver les exports et l’historique sans secret, mais utiliser un stockage de session dédié et minimal lorsque l’utilisateur demande explicitement que la connexion survive au refresh.
- Explication : un hash salé ne permet pas de reconstruire le mot de passe exigé par PostgreSQL ; le secret doit rester récupérable et être isolé des données de modèle partageables.

## Sémantique des contrôles de panneau

- Erreur : représenter une réduction de panneau avec un contrôle visuel assimilable à une fermeture, ou proposer les deux actions quand le panneau doit rester disponible.
- Règle : un panneau persistant possède uniquement un contrôle de réduction/restauration, avec la même icône et le même style partout dans l’éditeur.
- Explication : la cohérence entre l’action réelle et son apparence évite de faire croire que le panneau va disparaître définitivement.

- Erreur : conserver une sortie de languette aussi lente que les autres transitions alors qu’elle ne sert qu’à libérer rapidement le bord de l’écran.
- Règle : donner aux languettes une sortie légèrement plus courte, tout en partageant la même durée entre l’animation CSS et leur délai de démontage.
- Explication : une durée désynchronisée laisse soit une languette invisible montée trop longtemps, soit coupe son animation avant la fin.

## Portée des variantes de thème

- Erreur : étendre automatiquement un ajustement de couleur au thème clair alors que l’anomalie concerne uniquement le dark mode.
- Règle : lorsqu’un thème est explicitement ciblé, conserver les styles des autres thèmes et limiter les nouveaux sélecteurs à cette variante.
- Explication : une correction locale au dark mode évite de modifier un rendu clair déjà validé tout en gardant des états de survol et de sélection cohérents.
- Erreur : conserver une source manuelle alors que le flux repose désormais sur une connexion de base de données et un choix de table réel.
- Règle : lorsqu’un nouveau parcours remplace complètement un ancien nœud source, retirer aussi sa définition, sa configuration et ses tests dédiés afin d’éviter deux concepts concurrents.
- Explication : une option devenue sans objet encombre la palette et augmente inutilement les chemins fonctionnels à maintenir.
- Erreur : afficher « Checking » pendant l’établissement initial de la connexion Database.
- Règle : employer « Connecting... » pour cet état transitoire afin de décrire l’action perçue par l’utilisateur.
- Explication : « Checking » évoque une simple vérification, alors que l’interface attend réellement une réponse de connexion.
- Erreur : laisser les métadonnées transitoires de React Flow participer à la détection des changements Undo/Redo.
- Règle : comparer et persister une projection canonique limitée aux positions, paramètres et connexions réellement éditables.
- Explication : les dimensions mesurées, états de sélection et drapeaux internes peuvent changer sans action métier et polluent sinon la pile avec des « Unknown changes ».
- Erreur : multiplier les encadrements de sections à l’intérieur des panneaux de paramétrage, jusqu’à produire un effet « cartes dans des cartes ».
- Règle : réserver les surfaces bordées aux contrôles interactifs et construire la hiérarchie des panneaux avec le rythme, les titres et des séparateurs discrets.
- Explication : une structure plus plate réduit le bruit visuel et rend les formulaires longs plus faciles à parcourir.
- Erreur : aplatir également les conditions et groupes de filtres alors que leurs cartes matérialisent une structure logique.
- Règle : conserver les cartes lorsqu’elles expriment un regroupement métier ou une relation AND/OR, et aplatir seulement les conteneurs décoratifs.
- Explication : la réduction des surfaces doit préserver les frontières qui aident réellement à comprendre la configuration.
- Erreur : maintenir le type de colonne sur une ligne séparée à droite dans une liste trop étroite, ce qui tronque presque toutes les valeurs.
- Règle : dans le sélecteur compact du nœud Table, afficher le type sous le nom de colonne et conserver les deux dans la même zone de texte.
- Explication : la disposition verticale donne la priorité au nom tout en laissant au type toute la largeur disponible.
- Erreur : laisser les cartes de condition sans libellé alors que les cartes de groupe possèdent déjà un en-tête explicite.
- Règle : présenter les cartes Filter et Group avec la même structure d’en-tête — poignée, libellé, suppression.
- Explication : cette symétrie rend la hiérarchie du filtre lisible avant même de parcourir ses champs.
- Erreur : répéter les mêmes gros boutons d’ajout sous chaque groupe et juste au-dessous au niveau racine.
- Règle : garder les actions principales visibles au niveau racine et regrouper les ajouts d’un groupe dans une action compacte attachée à son en-tête.
- Explication : la position et le poids visuel des actions indiquent alors clairement à quel niveau sera ajouté le prochain élément.
- Erreur : appliquer les séparateurs horizontaux du bloc de colonnes à Model Output alors que son rail vert délimite déjà suffisamment la section.
- Règle : dans Model Output, conserver uniquement le rail vertical du bloc « Available Columns » et supprimer ses bordures haute et basse.
- Explication : le panneau de sortie est informatif et court ; une délimitation supplémentaire alourdit inutilement sa lecture.
- Erreur : modifier la géométrie d’un conteneur directement depuis le callback du ResizeObserver qui observe ce même conteneur.
- Règle : un ResizeObserver ne doit jamais écrire synchroniquement sur la géométrie de ses cibles ; supprimer l’observation inutile ou différer les écritures avec requestAnimationFrame.
- Explication : cette boucle lecture-écriture provoque les notifications non livrées et des oscillations subpixel particulièrement visibles dans Safari.
- Erreur : envisager de réduire la Toolbox par défaut alors que le besoin réel concerne seulement la zone utilisée par Fit View.
- Règle : conserver l’état d’ouverture choisi pour les panneaux et rendre les commandes de cadrage conscientes de l’espace réellement occulté.
- Explication : le viewport doit s’adapter à l’interface, sans modifier les préférences d’affichage de l’utilisateur.
- Erreur : animer l’opacité du conteneur transformé qui contient un `backdrop-filter`, ce qui peut désactiver visuellement le flou pendant la composition de l’animation.
- Règle : pour les panneaux vitrés coulissants, animer le déplacement de la couche et garder son opacité stable afin que le flou reste actif à chaque frame.
- Explication : le fondu du parent force certains navigateurs à aplatir temporairement la surface ; une animation de translation seule conserve l’effet de verre et suffit à masquer le panneau hors écran.
- Erreur : interpréter « cet effet » comme le dernier symptôme visuel évoqué, alors que le contexte fonctionnel portait sur le cadrage React Flow.
- Règle : lorsqu’une précision suit plusieurs sujets rapprochés, rattacher d’abord la demande au comportement principal en cours et vérifier que ses variantes implicites, comme le chargement initial, sont couvertes.
- Explication : ici, « lors de l’actualisation » étendait le calcul de l’espace disponible au `fitView` initial, pas seulement au bouton manuel.
- Erreur : comprendre « placer le nœud à gauche » comme un déplacement systématique à chaque ouverture des paramètres.
- Règle : ne déplacer automatiquement le canvas que lorsque le panneau nouvellement ouvert recouvre effectivement le nœud sélectionné.
- Explication : un nœud déjà visible doit rester stable ; le repositionnement automatique sert uniquement à restaurer sa visibilité.
- Erreur : interpréter « placer à gauche » comme « placer au bord gauche de la zone disponible » au lieu de « placer juste à gauche du panneau d’édition ».
- Règle : lorsqu’un panneau recouvre un élément, appliquer le déplacement minimal nécessaire pour positionner cet élément immédiatement à côté du panneau.
- Explication : le contexte spatial de « à gauche » désignait le côté gauche du panneau droit ; déplacer jusqu’à l’autre extrémité du canvas casse la continuité visuelle.
- Erreur : déclencher systématiquement Fit View à chaque fermeture du panneau d’édition.
- Règle : ne restaurer le cadrage à la fermeture que si l’ouverture a déclenché notre déplacement automatique du viewport.
- Explication : une vue qui n’a pas été modifiée automatiquement à l’ouverture doit rester intacte lorsque le panneau se ferme.
- Erreur : limiter la protection du nœud sélectionné au seul panneau d’édition droit.
- Règle : appliquer le même déplacement minimal aux panneaux superposés des deux côtés, en plaçant le nœud juste après leur bord intérieur.
- Explication : l’ouverture de la Toolbox peut masquer un nœud sélectionné exactement comme l’éditeur ; la direction change, mais la règle de stabilité reste identique.
- Erreur : vérifier le chevauchement de la Toolbox uniquement lors de son ouverture.
- Règle : contrôler aussi les deux limites visibles à chaque nouvelle sélection, car un nœud peut déjà se trouver partiellement sous un panneau ouvert.
- Explication : la protection doit suivre l’événement qui rend le nœud actif autant que l’événement qui rend le panneau visible.

## Jointures et ports dynamiques — audit dbt

- Erreur : interdire deux clés de jointure portant le même nom sans tenir compte de leur table d’origine.
- Règle : les clés gauche et droite appartiennent à des relations distinctes ; leur homonymie est valide et doit être acceptée par le formulaire.
- Explication : `orders.customer_id = customers.customer_id` est une jointure courante ; les alias de relation générés suffisent à lever l’ambiguïté SQL.
- Erreur : ajouter un port dans le DOM sans synchroniser les mesures internes de React Flow.
- Règle : appeler `useUpdateNodeInternals` après modification du nombre de ports, avec des dépendances primitives stables plutôt qu’à chaque rendu.
- Explication : un port visible doit être connectable immédiatement, sans refresh ; une synchronisation ciblée évite aussi les boucles de mesure.
- Erreur : superposer les boutons de retrait et les zones de connexion, ou placer les ports derrière le nœud.
- Règle : séparer géométriquement boutons et ports, garder les ports au premier plan et marquer les boutons `nodrag nopan`.
- Explication : les glisser-déposer et les suppressions doivent avoir des cibles distinctes ; vérifier leur centre par une interaction réelle et leur absence de recouvrement.

## Paramètres non représentés par un formulaire

- Erreur : remplacer tous les paramètres d’un nœud par les seuls champs visibles du formulaire lors de Save.
- Règle : fusionner les champs édités avec les paramètres actuels, tout en remplaçant intégralement la configuration de l’adaptateur choisi.
- Explication : le nombre de ports dynamiques n’est pas un champ du formulaire Database ; il doit survivre au changement de moteur, sans conserver les anciens identifiants de connexion.

## Nommage des modèles intermédiaires

- Erreur : dériver plusieurs noms intermédiaires du même nom de table et d’un suffixe générique, puis rejeter une chaîne valide à cause d’une collision.
- Règle : allouer un nom unique et stable à chaque modèle intermédiaire avant de produire ses chemins et de résoudre ses références.
- Explication : Filter/Sort et Custom SQL peuvent tous deux être classés comme « transformed » ; un suffixe numérique distingue leurs modèles sans renommer les exports qui n’ont pas de collision.

## Publication des lots Git

- Erreur : ajouter aux messages de commit ou à la documentation publique une note de procédure non demandée.
- Règle : garder les messages de commit centrés sur les changements livrés et conserver les détails opérationnels de sauvegarde et de validation dans le suivi local de la tâche.
- Explication : l’historique doit décrire clairement les fonctionnalités, correctifs et jalons du projet.
