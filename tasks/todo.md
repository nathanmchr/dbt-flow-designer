# Audit des modèles dbt générés

## Validation SQL Server et publication sur dev — 13 octobre 2026

- [x] Vérifier l’instance dédiée, les ressources, les branches et préparer une fixture plus riche sans remplacer les données existantes.
  - Fixture `qa` ajoutée : 100 clients, 30 produits, 1 000 commandes, 3 000 lignes ; données `dbo` préservées. Premier test enrichi : `test_connection()` ferme la connexion du connecteur ; supprimer cet appel redondant dans le contexte déjà connecté avant de reprendre.
- [x] Tester des modèles de complexité croissante (projection, filtres, jointures, agrégations et SQL personnalisé) sur la base réelle ; construire les exports inchangés et comparer tous les résultats à des requêtes indépendantes.
  - Huit modèles enrichis validés : projection (1 000 lignes), filtres imbriqués Unicode/BIT (6), LEFT JOIN (1 000 dont 20 sans correspondance), agrégations NULL/AVG/COUNT DISTINCT (99), deux jointures + calcul + agrégation + filtre + tri (3), ROW_NUMBER (198), UNION ALL/doublons (200), résultat vide (0). Comparaisons exhaustives sans écart.
- [x] Vérifier pagination/recherche/statistiques, refus d’écriture et intégrité des sources ; exécuter les non-régressions PostgreSQL/DuckDB et les contrôles frontend.
  - 61 tests backend sans skip avec les trois moteurs réels, 38 tests frontend ; lint/build et dépendances réussis. ZIP complexe téléchargé en UI construit sans réécriture : 16 fichiers, 3 lignes, aucun écart. Sources identiques. Navigateur T3 : état de dialogue périmé (`No dialog is showing` / `Cannot dismiss dialog which is already handled!`) ; terminer le contrôle de rechargement dans une session Playwright dédiée.
  - Contrôle UI après refresh : attendre le libellé localisé `1 000 rows`, et non `1000 rows`, avant de conclure ; aucune erreur produit, le tableau affiche déjà les 25 premières lignes et 40 pages.
- [x] Conserver les preuves, nettoyer seulement les ressources de cette validation et examiner les changements avant commit.
  - Rapport versionné `docs/sqlserver-validation.md`. Refresh UI réussi dans Playwright : Live, 1 000 lignes/deux colonnes et 40 pages, zéro erreur/avertissement console. Base `qa` inchangée, zéro schéma SQL temporaire et zéro workspace `dbt-flow-sqlserver-model-*`/`dbt-flow-sqlserver-zip-*` restant ; espace libre final : 21 Gio. Base/volume et services 8765/5174 conservés pour les essais utilisateur.
- [x] Commiter et pousser le lot validé sur dev, puis vérifier le SHA distant.
  - Commit fonctionnel `9d9b4ec` (`feat(sqlserver): validate native previews and dbt exports on real fixtures`) poussé sur `origin/dev`. Aucun changement publié sur `main`. Le suivi et les preuves de cette validation sont consignés dans un commit documentaire séparé.

Validation : réutiliser le conteneur `dbt-flow-sqlserver-test` et son volume après contrôle du label propriétaire. Aucun nouveau workspace de copie ; les projets dbt temporaires appartiennent aux tests et sont supprimés à leur sortie. Preuves durables sous `output/playwright/sqlserver-dev-2026-10-13/`, rapport versionné sous `docs/`.

## Connecteur SQL Server — 13 octobre 2026

- [x] Vérifier les contrats existants, le dialecte T-SQL, les versions dbt/ODBC et les moyens de validation disponibles.
- [x] Ajouter le connecteur natif : connexion TLS, catalogue, aperçu limité, pagination/recherche/tri/statistiques et protection des sources.
- [x] Intégrer le profil de compilation dbt SQL Server et adapter le SQL généré sans changer PostgreSQL/DuckDB.
  - Vérification ciblée : port zéro corrigé ; fixtures alignées sur les nœuds réellement exposés (`group-by`, `join`). L’adaptateur compile bien avec des guillemets ANSI, pas des crochets : corriger l’assertion. Rejouer hors confinement les compilations ralenties/expirées avant de conclure.
- [x] Activer le formulaire Database et le parcours Table/live/test/export avec les paramètres SQL Server.
- [x] Ajouter et exécuter les tests ciblés, les non-régressions, le lint et le build ; tester un serveur réel si disponible.
  - Contrôle global final : les tests de compilation hors connexion héritent de `DBT_FLOW_SQLSERVER_DATABASE` de la fixture réelle et produisent `dbt_flow_test` au lieu de leur base synthétique `warehouse`. Isoler explicitement l’environnement du générateur dans ces tests, puis rejouer toute la suite avec les trois moteurs activés.
  - Nouvelle autorisation utilisateur : provisionner une instance SQL Server Developer dédiée dans Docker, tester l’émulation x86-64 du Mac ARM, créer des comptes reader/writer séparés, puis valider aperçus et export réel sans toucher aux conteneurs des autres projets.
  - Cas syntaxique supplémentaire : SQLGlot rattache le ORDER BY global d’une UNION à son SELECT droit ; le remonter au niveau de l’ensemble avant de valider/wrapper l’aperçu.
  - Installation ODBC native réussie. Provisionnement réel bloqué par le disque Docker : extraction de l’image officielle refusée avec `no space left on device` ; la seconde tentative rencontre aussi un timeout proxy DNS. Aucun conteneur SQL Server lancé, aucun nettoyage des autres projets. Volume dédié vide et configuration privée conservés pour reprendre ; demander une augmentation du disque Docker ou des cibles de nettoyage explicitement autorisées.
  - Autorisation obtenue pour le seul cache de build inutilisé : 1,758 Go supprimés (régénérables), images/conteneurs/volumes préservés et vérifiés. Nouvelle extraction SQL Server réussie, digest `sha256:45a1a9d13ca5574cf8e0fe4ae73ab77248b66d9c3132ac9658fb6c16dd72a8af` ; reprendre les tests réels.
  - Premier démarrage : erreur de droits `/.system` avant création de données. Vérifier les propriétaires du volume dédié avant de modifier ses seuls droits ; conserver l’exécution non-root du serveur.
  - Diagnostic : volume déjà inscriptible par `mssql`, mais `/home/mssql` déclaré dans l’image n’existe pas. Fixer HOME et le répertoire de travail à `/var/opt/mssql`, puis recréer le seul conteneur de test arrêté en conservant son volume vide ; ne pas modifier les permissions ni exécuter le serveur en root sans nécessité.
  - Cette hypothèse ne résout pas l’erreur. Appliquer le propriétaire `mssql:mssql` au seul dossier racine de notre volume vide (déjà validé), conformément au guide Microsoft, puis retenter le serveur non-root ; ne pas élargir les permissions du système hôte.
  - Refus identique après correction. Diagnostic temporaire `dbt-flow-sqlserver-probe` exécuté en root à l’intérieur du seul conteneur (sans privileged ni montage hôte) pour isoler cette limitation ; le serveur normal reste arrêté et le volume dédié est partagé uniquement avec ce diagnostic actif. Ne pas revendiquer de serveur fonctionnel avant un SELECT réel.
  - SELECT @@VERSION réel réussi dans le diagnostic : SQL Server 2022 CU16 16.0.4165.4 Developer. Garder une exception root uniquement pour la fixture Docker macOS ARM, sans privileged/montages hôte ; ne pas appliquer cette exception aux déploiements de production. Renommer le diagnostic fonctionnel en conteneur de test officiel, garder son volume et initialiser reader/builder/fixtures.
  - Premier test client natif : le pilote ODBC réclame OpenSSL 1/1.1/3, alors que la formule Homebrew a lié OpenSSL 4. Vérifier un chargement ciblé d’OpenSSL 3 déjà installé (ou un chemin limité au processus), sans modifier les bibliothèques des autres projets, avant de reprendre les tests.
  - Connexion TLS native du reader réussie avec DYLD_LIBRARY_PATH vers OpenSSL 3 (préchargement et FALLBACK seuls insuffisants). Documenter ce paramètre de lancement et l’appliquer aux sous-processus du script de test, sans relier globalement de bibliothèques.
  - Tests réels : catalogue, aperçu, filtre/jointure/tri/agrégation/custom SQL, pages/recherche/stats et refus d’écriture réussis. Le build exporté révèle les droits de métadonnées requis par dbt-sqlserver sur `sys.sql_expression_dependencies` ; les accorder au seul builder avec VIEW DEFINITION, sans élargir le reader. Corriger le nettoyage des types `CHAR(2)` rembourrés (`V `) et enlever le schéma exact abandonné `dbt_flow_validation_a93b1bc78cc643c9ae345cb10bf25f68` après vérification de sa propriété.
  - Ancien schéma : propriétaire `dbt_flow_builder` et seules vues `stg_orders`/`stg_users` vérifiés avant suppression ciblée. Les fixtures dbo restent intactes.
  - Test UI réel : le hook du voyant reconstruisait seulement les champs PG/DuckDB, perdant driver/encrypt/trust_cert ; le serveur auto-signé était donc refusé malgré une configuration correcte. Transmettre ces primitives et les inclure dans les dépendances ; vérifier aussi la clé de requête du sélecteur Table. Aucun assouplissement TLS implicite.
- [x] Documenter la configuration, les garanties et les limites de validation, avec preuves conservées.
- Résultat final : 60 tests backend réussis sans skip (PostgreSQL, DuckDB et SQL Server réels activés), 38 tests frontend réussis, lint/build/dependency/diff-check propres. Tests hors connexion isolés de l’environnement réel. SQL Server 2022 CU16 Developer fonctionne sur `127.0.0.1:1433`, base `dbt_flow_test`, schéma `dbo`, reader SELECT-only. Le statut live survit au refresh ; catalogue et sélection des colonnes validés dans l’interface. ZIP téléchargé de 9 fichiers construit sans réécriture SQL : comparaison exhaustive 2/2 lignes sans écart ; les variantes agrégation/custom SQL passent aussi. Sources intactes (3 users, 3 orders), zéro schéma SQL temporaire restant. Preuves et limites : `output/playwright/sqlserver-2026-10-13/VERIFICATION.md` ; guide : `docs/sqlserver.md`. Instance et volume conservés pour les tests utilisateur, backend normal 8765 et frontend 5174 maintenus ; backend provisoire 8766 arrêté. Seul cache de build Docker inutilisé autorisé supprimé (1,758 Go), aucun nettoyage des ressources des autres projets. Aucun commit/push de ce lot.

## Prise en charge multi-SGBD — 13 octobre 2026

Périmètre : plateformes SQL/dbt, couvrant à la fois les bases applicatives et la data/BI. « 95–98 % » reste un objectif produit à mesurer sur les utilisateurs cibles, pas une part de marché démontrée. Premier lot : PostgreSQL préservé et DuckDB validé de bout en bout ; autres moteurs planifiés sans activation prématurée.

- [x] Documenter les vagues de couverture et les critères de validation d’un moteur.
- [x] Généraliser le parcours natif par capacités, conserver PostgreSQL et sécuriser le connecteur DuckDB en lecture seule.
- [x] Compiler l’aperçu dbt DuckDB sans matérialisation et déclarer les dépendances nécessaires.
- [x] Activer DuckDB dans Database, le statut live et le sélecteur de tables avec son schéma `main`.
  - Défaut révélé en UI : Save remplaçait tous les paramètres par les seuls champs du formulaire, perdant les ports dynamiques. Préserver les paramètres non édités lors de la sauvegarde et rejouer le changement de moteur avec deux sorties.
- [x] Tester les catalogues, limites, pagination, statistiques et refus d’écriture sur une vraie base DuckDB.
  - Corriger l’échappement SQL des guillemets dans la fixture de test (identifiants à guillemets doublés), puis relancer tous les cas ; la compilation dbt native a déjà réussi.
  - Couvrir aussi les agrégations et SQL personnalisé générés ; la seconde variante révèle des noms intermédiaires identiques pour une chaîne valide filtre/tri/custom SQL. Suffixer les noms intermédiaires en collision avant la résolution des références, avec un test de régression.
- [x] Manipuler l’interface, exporter le ZIP et comparer sa construction dbt aux données attendues ; vérifier la non-régression PostgreSQL.
  - Le port 5173 héberge une autre application : ne pas l’arrêter ni la modifier ; démarrer notre Vite sur 5174 et vérifier le titre avant toute interaction.
  - Autoriser une origine frontend explicite via `DBT_FLOW_FRONTEND_ORIGIN`, sans ouvrir CORS à toutes les origines, pour tester sur le port alternatif.
  - Dans la requête de comparaison, qualifier complètement `validation.validation.fct_qa_duckdb_join` : le nom du fichier DuckDB et celui du schéma sont identiques, donc deux segments sont ambigus.
- [x] Exécuter tests, lint, build et consigner les preuves et limites.
- Résultat : connecteur DuckDB activé de bout en bout ; 34 tests frontend et 34 tests backend réussis, plus 4 tests PostgreSQL opt-in réussis séparément. Aperçus générés avec jointure/filtre/tri, agrégations et SQL personnalisé validés sur DuckDB ; refus d’écriture et empreintes sources inchangées. ZIP téléchargé en UI construit sans réécriture SQL : 3 succès, zéro erreur ; comparaison exhaustive 1 000/1 000 lignes, aucun écart. Diagnostics TypeScript, lint, build, dépendances et diff-check réussis ; avertissements préexistants de taille de bundle et baseline-browser-mapping conservés. Preuves sous `output/playwright/multi-database-2026-10-13/`. Base de test `.local/duckdb/dbt_flow_test.duckdb` conservée volontairement. Frontend de cette tâche sur 5174 et backend sur 8765 ; application existante sur 5173 laissée intacte.

## Aperçu dbt natif en lecture seule

- [x] Compiler les fichiers dbt exportés avec l'adaptateur PostgreSQL et rendre les dépendances éphémères pour l'aperçu.
- [x] Exécuter le SQL compilé sur la source dans une transaction PostgreSQL en lecture seule, sans matérialisation.
- [x] Servir pagination, recherche, tri et statistiques directement depuis la requête source, sans dépendance DuckDB pour l'aperçu.
- [x] Mettre à jour l'intégration API et la documentation, en conservant l'export dbt existant.
- [x] Tester les résultats natifs et les refus d'écriture sur une instance PostgreSQL isolée ; vérifier que données et relations source restent identiques.
- [x] Exécuter les tests frontend/backend, le lint, le build et le parcours navigateur.

### Ajustement de la validation des macros

- [x] Vérifier le refus de compilation des macros qui tentent une écriture et l'identité du schéma source, sans imposer un message d'erreur spécifique : la compilation sans introspection peut refuser l'accès avant PostgreSQL.

### Validation de l'aperçu natif

- Le même projet dbt est compilé avec dbt-postgres ; les sources YAML et le SQL exportés sont conservés, les dépendances étant éphémères uniquement pour l'aperçu.
- La source exécute le SQL compilé dans des transactions REPEATABLE READ et READ ONLY, fermées après chaque requête. Aucun DuckDB n'est initialisé pour ce parcours.
- Les tests d'intégration comparent relations et données avant/après, vérifient les calculs PostgreSQL (`1 / 2 = 0`), les refus d'écriture, les macros, le tri, la recherche, les statistiques et les résultats vides.
- Le parcours navigateur confirme 53 résultats, 25 lignes au départ, 50 après changement, puis une recherche à une ligne. Capture : `output/playwright/native-postgres-preview.png`.
- 30 tests frontend et 30 tests backend (intégration PostgreSQL activée) réussissent ; lint, build et contrôle de diff propres.
- Chaque page/statistique relit la source : les modifications externes peuvent être visibles entre deux requêtes. L'export conserve les matérialisations normales du modèle.

- [x] Cartographier la génération, l'optimisation et l'exécution des modèles dbt.
- [x] Vérifier statiquement le SQL et les métadonnées dbt générés pour les opérations prises en charge.
- [x] Compiler et exécuter les validations disponibles (frontend, backend et dbt).
- [x] Évaluer les optimisations SQL sans compromettre la sémantique des flows.
- [x] Consigner les constats, preuves et recommandations prioritaires.

## Verdict

Les modèles générés ne sont pas encore fiables pour une exécution dbt. Les défauts
les plus importants concernent la résolution des sources, les références après
regroupement de CTE, certains filtres, l'ordre des entrées de jointure et le profil
dbt utilisé par l'aperçu backend.

## Constats prioritaires

1. Le modèle staging référence `source('raw', ...)`, mais `sources.yml` déclare une
   source différente (`postgres` dans le cas testé). Le projet échoue dès `dbt parse`.
2. Le regroupement optimisé renomme le fichier combiné sans réécrire les `ref()` des
   modèles descendants. Deux scénarios testés produisent respectivement des références
   absentes vers `int_orders_filtered_2` et `int_orders_selected`.
3. Le chemin optimisé ne gère pas `IS NaN` / `IS NOT NaN`. Il génère par exemple
   `amount IS NOT NaN ''`, rejeté par DuckDB.
4. Les opérations `sort` et `custom-sql` sont remplacées silencieusement par des
   `SELECT *` dans le projet dbt, alors que l'aperçu SQL les exécute.
5. Les chaînes contenant une apostrophe et les opérateurs `IN` / `NOT IN` génèrent
   du SQL invalide (`'O'Reilly'`, `IN 1`).
6. `source-manual` stocke le nom sous `table_name`, mais le générateur cherche
   `table`, `tableName` ou `name`; il produit donc `stg_unknown`.
7. Les entrées d'une jointure sont déterminées par l'ordre du tableau d'arêtes, pas
   par `targetHandle`. Un test avec `input-0`/`input-1` inversés a produit une jointure
   avec les tables gauche/droite inversées et des colonnes inexistantes.
8. Le backend écrit toujours le profil `flow_designer_preview`, tandis que le
   `dbt_project.yml` généré demande un profil dérivé du nom du flow. Sa configuration
   `attach` contient aussi un champ `schema` invalide pour `dbt-duckdb 1.10`.
9. `dbt-core` et `dbt-duckdb` sont absents de `backend/requirements.txt`; le venv
   présent est par ailleurs lié à un interpréteur Python supprimé.
10. `schema.yml` invente des tests `unique` et `not_null` sur le premier identifiant
    trouvé, voire sur une colonne `id` inexistante. Ces contraintes ne sont pas
    justifiées par le flow et peuvent faire échouer `dbt test` sur des modèles valides.

## Vérifications effectuées

- `npm run build` : succès (avertissement de bundle supérieur à 500 kB).
- `npm run lint` : 0 erreur, 1 avertissement sans rapport avec dbt.
- Compilation syntaxique Python : succès.
- Import de l'API backend avec Python 3.13 et les paquets du venv : succès.
- `dbt parse` avec dbt-core 1.10.15 / dbt-duckdb 1.10.0 : échec sur la source
  `raw.air_quality_measurements` non déclarée.
- Audit de six flows synthétiques : toutes les sources étaient non résolues; deux
  flows optimisés avaient en plus un `ref()` vers un modèle absent.
- Validation directe DuckDB : les trois formes SQL problématiques (`NaN`, apostrophe,
  `IN`) ont toutes été rejetées par le parseur.

## Direction d'optimisation recommandée

- Désactiver temporairement le regroupement maison et conserver un modèle dbt par
  étape : les modèles `intermediate` sont déjà `ephemeral`, donc dbt réalise
  l'inlining CTE.
- Restaurer d'abord l'équivalence fonctionnelle entre aperçu et export, puis ajouter
  des tests de génération par opération et des tests `dbt parse/build` sur DuckDB.
- Rendre les matérialisations configurables; ne proposer `incremental`, partitionnement
  ou clustering qu'à partir de volumes et de profils d'exécution mesurés.

## Implémentation — connecteur PostgreSQL

- [x] Stabiliser la génération dbt nécessaire à une exécution PostgreSQL fiable.
- [x] Aligner les sources, les dépendances optimisées, les filtres et les opérations du flow.
- [x] Rendre l'ordre des jointures déterministe et valider les flows incomplets.
- [x] Finaliser l'exécution dbt-duckdb sur une source PostgreSQL en lecture seule.
- [x] Protéger les identifiants de connexion et limiter explicitement les résultats.
- [x] Ajouter des tests de non-régression frontend et backend.
- [x] Exécuter les validations de build, lint, dbt et un test PostgreSQL réel.

## Résultat de l'implémentation

- L'export produit désormais des sources cohérentes avec les appels `source()`, des
  `ref()` résolues et un fichier par étape par défaut. Les intermédiaires restent
  `ephemeral`, ce qui laisse dbt effectuer l'inlining CTE sans regroupement maison.
- Les filtres échappent les chaînes, parenthèsent `IN` / `NOT IN`, gèrent NaN et
  partagent la même génération entre aperçu et export.
- Les jointures utilisent `targetHandle`, les flows incomplets sont refusés et les
  noms de modèles/fichiers dupliqués sont détectés avant écriture.
- Le backend exécute `dbt build +<modèle>` dans DuckDB avec PostgreSQL attaché en
  lecture seule. Les paramètres PostgreSQL sont transmis par variables
  d'environnement et les résultats restent paginés/limités.
- Les identifiants SQL sont quotés, les chemins de fichiers entrants sont confinés,
  les secrets ne sont ni écrits dans `profiles.yml` ni conservés dans le JSON d'un flow.
- Vérifications finales : 7 tests frontend, 14 tests backend (dont 1 intégration
  optionnelle), build TypeScript/Vite, lint sans erreur et smoke test réel
  PostgreSQL → dbt → DuckDB réussi.

## Base PostgreSQL locale de test

- [x] Créer un cluster PostgreSQL 15 isolé dans `.local/postgres` sur `127.0.0.1:5432`.
- [x] Créer la base `dbt_flow_test`, le schéma `raw` et un jeu de données e-commerce reproductible.
- [x] Créer un rôle `dbt_flow_reader` strictement limité à la lecture des données de test.
- [x] Ajouter des commandes simples de démarrage, arrêt et statut sans supprimer les données.
- [x] Vérifier les jointures, agrégations, droits en lecture et refus des écritures avec ce rôle.
- [x] Documenter les identifiants de connexion et les tables disponibles.

### Validation locale

- Instance PostgreSQL 15.15 active sur `127.0.0.1:5432`.
- Comptages vérifiés : 100 clients, 30 produits, 1 000 commandes, 3 000 lignes
  de commande et 5 000 événements.
- Introspection et requête agrégée réussies via le connecteur applicatif.
- Pour `dbt_flow_reader` : `default_transaction_read_only=on`, droit `SELECT`
  présent, droits `INSERT` et `CREATE` absents.

## Masque translucide des catégories sticky

- [x] Retirer le fond translucide et le flou ajoutés aux titres.
- [x] Appliquer un vrai masque d'opacité au contenu qui passe sous chaque titre sticky.
- [x] Aligner le masque pendant le scroll et les animations d'ouverture.
- [x] Vérifier le build et le lint du frontend.

### Stabilisation des titres

- [x] Empêcher le masque supérieur global d'affecter les titres sticky.
- [x] Vérifier visuellement la hauteur et la position des titres pendant le scroll.
- [x] Relancer le build et le lint du frontend.

## Animation des catégories

- [x] Supprimer la translation opposée des cartes pendant l'ouverture et la fermeture.
- [x] Conserver une révélation verticale ancrée sous le titre.
- [x] Vérifier visuellement les deux sens de l'animation, puis le build et le lint.

### Mouvement des cartes depuis le titre

- [x] Calculer pour chaque carte la distance qui la sépare du titre.
- [x] Faire descendre toutes les cartes depuis le titre à l'ouverture et remonter à la fermeture.
- [x] Synchroniser ce déplacement avec l'expansion verticale de la catégorie.
- [x] Vérifier visuellement le mouvement, puis le build et le lint.

### Effet pile et alignement supérieur

- [x] Mesurer l'espace au-dessus de la première catégorie lorsque la scrollbar apparaît.
- [x] Supprimer l'espace excédentaire sans modifier les autres espacements.
- [x] Ordonner la sortie des cartes en cascade depuis le titre.
- [x] Inverser la cascade pour leur retour vers le titre.
- [x] Vérifier visuellement, puis exécuter le build et le lint.

### Stabilité perceptuelle de la pile

- [x] Restaurer l'espacement supérieur structurel de 16 px.
- [x] Mesurer image par image le titre, le scroll, le masque et les cartes.
- [x] Remplacer la cascade en pile par le déplacement d'un fil unique de cartes.
- [x] Supprimer les recalculs par carte responsables d'un mouvement potentiellement instable.
- [x] Corriger uniquement la source restante du décalage perceptible.
- [x] Vérifier l'ouverture et la fermeture, puis le build et le lint.

### Animation simple et scroll stable

- [x] Remplacer l'effet de fil par un glissement court de la liste complète.
- [x] Désactiver l'ancrage automatique du scroll pendant les changements de hauteur.
- [x] Réserver la largeur de scrollbar avant même qu'elle apparaisse.
- [x] Retirer uniquement la marge conditionnelle de la piste de scrollbar.
- [x] Confirmer que l'espace intérieur de 16 px reste inchangé.
- [x] Vérifier visuellement, puis exécuter le build et le lint.

### Stabilisation réelle et modèle persistant

- [x] Reproduire le décalage conditionnel sans modifier l'inset sticky intentionnel de 16 px.
- [x] Supprimer la bascule de géométrie liée à l'apparition de la scrollbar.
- [x] Retrouver le cycle de vie du modèle courant et son point d'initialisation.
- [x] Enregistrer le modèle courant localement et le restaurer après actualisation.
- [x] Vérifier le scroll, l'ouverture des catégories et la restauration complète du modèle.
- [x] Exécuter les tests, le lint et le build du frontend.

#### Validation

- La zone latérale reste en mode scroll avant et après débordement ; son retrait sticky reste à 16 px et sa largeur utile ne change pas.
- Après actualisation réelle, le nom du modèle et les trois nœuds du scénario de contrôle ont été restaurés.
- Les paramètres non sensibles, positions, connexions et compteur sont persistés ; les mots de passe et jetons sont exclus.
- Vérifications finales : 13 tests réussis, build réussi et lint sans erreur.

### Diagnostic vidéo du décalage latéral

- [x] Extraire les images clés de la vidéo autour de l'apparition du scroll.
- [x] Identifier l'élément et la propriété qui changent réellement de position.
- [x] Reproduire le même enchaînement dans l'application.
- [x] Appliquer la correction minimale en conservant l'inset sticky de 16 px.
- [x] Comparer visuellement et géométriquement le comportement corrigé.
- [x] Relancer les tests, le lint et le build du frontend.

#### Validation vidéo

- Sur la vidéo, le cadre et l'en-tête restent fixes tandis que le contenu passe systématiquement de 0 à +2 pixels physiques quand le débordement s'active.
- La couche du conteneur de scroll est désormais maintenue active avant le débordement, ce qui évite sa recréation et son nouvel arrondi Retina.
- Le scénario corrigé conserve 16 px d'inset et 278 px de largeur utile, avec 0 px de déplacement mesuré entre les deux états.
- Vérifications finales : 16 tests réussis, build réussi et lint sans erreur bloquante.

## Sélection de la source PostgreSQL dans le nœud Table

- [x] Identifier la base PostgreSQL connectée au nœud Table.
- [x] Charger et afficher les tables du schéma configuré, avec une saisie manuelle de secours.
- [x] Charger les colonnes de la table choisie et permettre une sélection multiple.
- [x] Conserver le nœud Select pour les projections réalisées plus loin dans le flow.
- [x] Vérifier le comportement avec la base locale, puis exécuter les tests, le lint et le build.

### Validation du nœud Table

- L’API réelle retourne les 6 relations du schéma `raw` et les 8 colonnes de `orders`.
- Le changement de table annule les requêtes obsolètes et sélectionne ses colonnes par défaut.
- La projection choisie est utilisée directement par l’aperçu SQL et le modèle dbt de staging.
- Vérifications finales : 10 tests frontend, build TypeScript/Vite et lint sans erreur.

## Indicateur de connexion du nœud Database

- [x] Définir les états `checking`, `live` et `offline` sans les enregistrer dans le flow.
- [x] Tester la connexion PostgreSQL après configuration et la revérifier périodiquement.
- [x] Afficher un voyant explicite sur le nœud Database.
- [x] Valider le voyant avec des identifiants locaux valides puis un port indisponible.
- [x] Exécuter les tests, le lint et le build du frontend.

### Validation du voyant Database

- Connexion locale valide : `success: true`, donc voyant vert `Live`.
- Port PostgreSQL indisponible : `success: false`, donc voyant rouge `Not connected`.
- La vérification est relancée toutes les 30 secondes et lorsque la fenêtre reprend le focus.
- Vérifications finales : 10 tests frontend, build TypeScript/Vite et lint sans erreur.

## Alignement horizontal du panneau de paramètres

- [x] Mesurer les retraits gauche et droit du conteneur commun à tous les nœuds.
- [x] Stabiliser la gouttière de scrollbar sans modifier l’espace gauche validé.
- [x] Vérifier plusieurs types de nœuds, avec et sans défilement.
- [x] Exécuter les tests, le lint et le build du frontend.

### Validation de l’alignement

- La première correction stabilisait les deux retraits dans le navigateur de contrôle, mais dépendait encore du comportement natif de sa scrollbar.
- La capture macOS a invalidé cette conclusion : avec une scrollbar superposée, le retrait restait à 17 px à gauche contre 5 px à droite.

## Diagnostic de la connexion live

- [x] Vérifier séparément PostgreSQL, le frontend et le port attendu par l’API.
- [x] Réparer l’environnement Python référencé par la commande de démarrage documentée.
- [x] Démarrer l’API sur `127.0.0.1:8000` et tester les identifiants via `/api/test-connection`.
- [x] Confirmer que le frontend atteint l’API et que le voyant reçoit un résultat positif.

### Cause et validation

- L’ancien environnement `backend/venv` pointait vers un interpréteur Python supprimé.
- Son lien Python a été réparé vers Python 3.13.12 et les imports backend fonctionnent.
- L’API répond sur `127.0.0.1:8000`; le frontend a envoyé son test automatiquement.
- `/api/test-connection` retourne `success: true` et PostgreSQL ne rapporte aucune erreur d’authentification.

## Correction visuelle du sélecteur Table

- [x] Ramener les checkboxes à une taille compacte et accessible.
- [x] Garantir l’affichage du nom et du type de chaque colonne, avec le type ancré à droite même lorsqu’il est tronqué.
- [x] Placer l’actualisation à proximité du schéma.
- [x] Supprimer entièrement la saisie manuelle du nom de table.
- [x] Vérifier visuellement, puis exécuter les tests, le lint et le build.

### Validation du sélecteur Table

- Contrôle navigateur : cases à cocher de 16 × 16 px et même coordonnée droite pour un type court ou tronqué.
- Les noms restent dans la colonne flexible, tandis que les types sont alignés à droite avec une ellipse si nécessaire.
- La saisie manuelle et ses états associés ont été retirés du composant.
- Vérifications finales : 13 tests frontend, build TypeScript/Vite et lint sans erreur.

## Persistance des statuts Undo / Redo

- [x] Définir un format versionné et validé pour la pile d’historique et son index actif.
- [x] Restaurer l’historique uniquement lorsqu’il correspond au modèle courant chargé.
- [x] Persister chaque changement d’index ou de pile sans enregistrer les secrets Database.
- [x] Conserver le mot de passe Database dans le stockage de session et le réhydrater après actualisation.
- [x] Supprimer du stockage de session les secrets effacés ou liés à des nœuds disparus.
- [x] Couvrir le round-trip, les données invalides, la limite de taille et la confidentialité par des tests.
- [x] Vérifier dans le navigateur les statuts Undo / Redo et la reconnexion Database après actualisation.
- [x] Exécuter les tests, le lint, les diagnostics TypeScript et le build frontend.

## Nouveau modèle depuis le menu Model

- [x] Centraliser l’état initial d’un modèle afin que le démarrage et l’action New restent cohérents.
- [x] Ajouter l’action New au menu Model et fermer proprement le menu à son ouverture.
- [x] Demander si les modifications doivent être enregistrées, ignorées ou conservées via Annuler.
- [x] Réinitialiser le canvas, le nom, l’historique, les résultats et les secrets de session.
- [x] Couvrir le parcours avec des tests et une vérification dans le navigateur.

### Validation de la persistance et de New

- Deux actualisations successives conservent une pile de 3 états à l’index 1, avec Undo et Redo disponibles.
- Le mot de passe est réhydraté depuis la session, sans apparaître dans le modèle courant ni dans l’historique.
- Annuler ferme le dialogue sans modifier le modèle ; les deux autres choix créent un modèle vierge avec Database et Model Output.
- Save & New télécharge le modèle courant avant la réinitialisation ; Don’t save supprime également le secret Database de la session.
- Vérifications finales : 21 tests frontend, diagnostics TypeScript, build et lint sans erreur (1 avertissement préexistant dans `useFlowHistory.ts`).

## Restructuration complète de la barre latérale

- [x] Cartographier la structure, les responsabilités de scroll, les masques et les positions sticky actuelles.
- [x] Définir une structure stable séparant cadre, en-tête, masque et surface de défilement, sans changer le rendu perçu.
- [x] Restructurer le composant avec un minimum de changements et retirer les anciens correctifs de composition devenus inutiles.
- [x] Aligner le masque sticky avant peinture sans modifier le cycle d’événements du redimensionnement.
- [x] Préserver l’inset supérieur de 16 px, les dimensions, les espacements et l’animation des catégories, sans laisser les styles globaux du bandeau principal contaminer la barre latérale.
- [x] Vérifier l’absence de déplacement lors des transitions sans débordement / avec débordement et pendant le scroll.
- [x] Exécuter les tests, le lint, les diagnostics TypeScript et le build frontend.

### Validation de la barre latérale restructurée

- La surface vitrée, le viewport masqué et le `nav` scrollable sont désormais trois couches distinctes ; le panneau ouvert ne conserve aucune transformation.
- Le premier titre conserve son inset de 16 px, sa position à 151 px et sa hauteur de 28 px avant comme après l’apparition du débordement.
- Quatre cycles sans débordement / avec débordement et six positions de scroll conservent un déplacement pixel mesuré de 0 pour le titre et les cartes déjà affichées.
- Vérifications finales : 21 tests frontend, diagnostics TypeScript et build réussis ; lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.

## Synchronisation des masques pendant le scroll

- [x] Mesurer le retard entre le déplacement du scroll et la mise à jour des variables de masque.
- [x] Mettre à jour les masques dans le même événement de scroll sans réintroduire de déplacement visuel.
- [x] Vérifier la fluidité sur un scroll continu et les transitions de catégories.
- [x] Exécuter les tests, le lint, les diagnostics TypeScript et le build frontend.

### Validation de la synchronisation

- Le scroll appelle désormais la mise à jour directement, sans frame différée.
- Toutes les lectures géométriques précèdent les écritures CSS afin d’éviter les recalculs de layout répétés.
- Pendant le geste de contrôle, l’écart mesuré entre le masque attendu et le masque appliqué reste à 0 px ; le repli rétablit immédiatement la valeur de repos à -16 px.
- Vérifications finales : 21 tests frontend, diagnostics TypeScript et build réussis ; lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.

## Masque fixe sous le titre Toolbox

- [x] Ajouter un fondu supérieur fixe limité à l’inset de 16 px du viewport.
- [x] Conserver le masque inférieur et la lisibilité complète des titres sticky.
- [x] Préserver l’utilitaire de masque inférieur partagé avec le panneau de résultats.
- [x] Vérifier le rendu au repos et pendant le scroll, puis exécuter les validations frontend.

### Validation du masque Toolbox

- Le masque supérieur passe de transparent à totalement opaque entre 0 et 16 px, exactement avant la position sticky des titres.
- Le titre sticky conserve son inset de 16 px et reste entièrement opaque ; le titre précédent s’efface lorsqu’il est repoussé sous Toolbox.
- Le masque inférieur et le masque partagé du panneau de résultats restent inchangés.
- Vérifications finales : 21 tests frontend et build réussis ; lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.

## Panneaux persistants et contrôles de réduction

- [x] Identifier les états ouvert/réduit et les contrôles actuels des résultats et de la Toolbox.
- [x] Retirer l’action de fermeture du panneau de résultats pour le garder toujours disponible en bas.
- [x] Reprendre le style du bouton de réduction des résultats pour le contrôle de la Toolbox.
- [x] Vérifier au clavier et visuellement les états ouvert et réduit des deux panneaux.
- [x] Exécuter les tests, le lint, les diagnostics TypeScript et le build frontend.

### Validation des panneaux persistants

- L’onglet Query Results est présent dès le chargement et restaure le panneau avec son animation existante.
- Le bouton Test redéploie le panneau lorsqu’il est réduit, y compris pour afficher une erreur de configuration.
- Le panneau de résultats ne comporte plus de bouton de fermeture ; les deux en-têtes utilisent le même bouton circulaire « moins ».
- Les surfaces réduites sont `inert` et masquées de l’arbre d’accessibilité ; seul leur bouton de restauration reste atteignable.
- Vérifications finales : 21 tests frontend et build réussis ; diagnostics TypeScript propres et lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.

## Accélération du repli des languettes

- [x] Réduire uniquement la durée de sortie des languettes Toolbox et Query Results.
- [x] Synchroniser leur durée CSS avec le délai de démontage React.
- [x] Vérifier visuellement les deux transitions, puis relancer les validations frontend.

### Validation du repli accéléré

- Les deux languettes appliquent une sortie de 150 ms et sont démontées au même instant.
- Leurs animations d’entrée restent inchangées à 200 ms avec le délai existant.
- Vérifications finales : 21 tests frontend et build réussis ; contrôle navigateur conforme, lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.

## Contre-exemple macOS de l’alignement Inspector

- [x] Remplacer la compensation fixe de 12 px par la largeur réellement occupée par la scrollbar.
- [x] Conserver le retrait gauche existant sur les scrollbars classiques et superposées.
- [x] Vérifier les panneaux Database et Manual Table avec et sans défilement, y compris après redimensionnement.
- [x] Exécuter les tests, le lint, les diagnostics TypeScript et le build frontend.

### Validation du contre-exemple

- La marge droite n’est plus fixée à -12 px : elle vaut l’opposé de la largeur réellement occupée par la scrollbar, soit 0 px pour une scrollbar macOS superposée.
- Le panneau Database conserve 17 px de chaque côté à 280 px puis à 544 px de large.
- Le panneau Manual Table conserve 17 px de chaque côté avant et après apparition du défilement.
- Vérifications finales : 21 tests, diagnostics TypeScript et build réussis ; lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.
## Suppression du nœud Manual Table

- [x] Inventorier les définitions, l’interface de configuration et les chemins de génération propres à Manual Table.
- [x] Retirer le type de nœud et ses composants sans affecter Database, Table ni les transformations.
- [x] Adapter les tests et vérifier qu’aucune référence active ne subsiste.
- [x] Empêcher les anciens modèles et historiques enregistrés de restaurer un nœud Manual Table.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.

### Validation de la suppression

- La catégorie Sources ne propose plus que le nœud Table dans l’interface.
- La définition, l’icône, l’encart Inspector et les branches des générateurs liées à `source-manual` ont été supprimés.
- Le test du SQL personnalisé s’appuie désormais sur une vraie source PostgreSQL et un test interdit le retour de l’ancien identifiant.
- Les anciens modèles et historiques retirent automatiquement les nœuds Manual Table et leurs connexions lors du chargement.
- Vérifications finales : 23 tests et build réussis ; diagnostics TypeScript des sources propres, lint sans erreur avec un avertissement préexistant dans `useFlowHistory.ts`.
## Coffre chiffré portable des projets

- [x] Définir un format versionné avec un identifiant et une clé distincte par projet.
- [x] Implémenter côté backend le chiffrement authentifié et la clé racine locale à l'application.
- [x] Remplacer le stockage de session en clair par les appels au coffre.
- [x] Inclure l'enveloppe chiffrée dans les sauvegardes JSON et la restaurer à l'import.
- [x] Restaurer automatiquement les secrets du modèle courant après actualisation.
- [x] Ajouter les tests backend et frontend du cycle complet et des données altérées.
- [x] Exécuter les tests, le lint et le build.

### Validation du coffre

- Une clé de projet enveloppée reste stable lorsque son mot de passe change ; seul le contenu AES-GCM et son nonce sont renouvelés.
- Le JSON et les stockages navigateur ne contiennent plus le mot de passe en clair ; l'ancien `sessionStorage` est supprimé après migration.
- Les routes du coffre refusent les clients non locaux et les enveloppes altérées ou créées avec une autre clé d'application.
- Le cycle HTTP réel chiffrement → mise à jour → déchiffrement a restauré le mot de passe attendu sans l'exposer dans l'enveloppe.
- Vérifications finales : 29 tests frontend, 19 tests backend dont 1 test d'intégration optionnel ignoré, lint et build réussis.

### Correction de la restauration réelle

- [x] Inspecter le JSON réellement téléchargé et les appels réseau du navigateur.
- [x] Identifier pourquoi l'enveloppe n'est créée ni restaurée dans l'application lancée.
- [x] Corriger le cycle de synchronisation sans stockage de secret en clair.
- [x] Reproduire dans un navigateur sauvegarde, actualisation et import.
- [x] Relancer les tests backend/frontend, le lint et le build.

#### Ajustement de validation

- [x] Vérifier la régression CORS sans introduire une dépendance de test supplémentaire.

#### Validation de la restauration réelle

- Le serveur actif charge désormais le module de chiffrement dans ses deux environnements Python locaux.
- L'API suit automatiquement le nom d'hôte de l'interface et accepte `localhost` comme `127.0.0.1` pour le développement local.
- Le parcours navigateur réel chiffre à la validation, restaure après actualisation, exporte une enveloppe puis la déchiffre à l'import.
- Le mot de passe de contrôle est absent du stockage navigateur et du JSON exporté en clair.
- Vérifications finales : 29 tests frontend, 20 tests backend dont 1 intégration optionnelle ignorée, lint et build réussis.

### Isolation du coffre sur un port dédié

- [x] Identifier quel serveur répond réellement lors de l'actualisation signalée.
- [x] Attribuer à dbt Flow Designer un port backend distinct et centralisé.
- [x] Mettre à jour les commandes de lancement sans toucher à l'autre projet local.
- [x] Vérifier le cycle mot de passe → actualisation contre le serveur identifié.
- [x] Relancer les tests, le lint et le build.

#### Course d'écriture détectée

- [x] Persister l'enveloppe dès la réponse de chiffrement, avant le rendu React suivant.
- [x] Vérifier une actualisation déclenchée immédiatement après la réponse du coffre.

#### Validation de l'isolation et de l'écriture atomique

- Le port `8000` continue de servir l'autre projet local et dbt Flow Designer répond exclusivement sur `127.0.0.1:8765`.
- Le contrôle de santé valide désormais l'identité `dbt-flow-designer`, pas seulement un code HTTP réussi.
- L'enveloppe chiffrée est écrite immédiatement à la réponse du coffre, sans attendre un effet React ultérieur.
- Cinq cycles navigateur consécutifs ont restauré le mot de passe après actualisation et import, sans texte clair dans le stockage ou le JSON.
- Vérifications finales : 29 tests frontend, 21 tests backend dont 1 intégration optionnelle ignorée, lint et build réussis.

## Pagination des résultats à 25 lignes

- [x] Aligner la valeur initiale du panneau sur 25 lignes.
- [x] Aligner les valeurs par défaut du client API et du backend.
- [x] Ajouter une vérification de régression du défaut backend.
- [x] Exécuter les tests, le lint et le build.

### Validation de la pagination

- Le sélecteur « Rows » affiche 25 dès le premier rendu dans le navigateur.
- Le panneau et le client partagent la même constante frontend ; le modèle backend utilise aussi 25 par défaut.
- Vérifications finales : 30 tests frontend, 22 tests backend dont 1 intégration optionnelle ignorée, lint et build réussis.

## Suppression des changements parasites Undo/Redo

- [x] Cartographier la création des entrées d’historique et les champs transitoires provenant de React Flow.
- [x] Définir une représentation canonique ne conservant que les données métier annulables.
- [x] Utiliser cette représentation pour la comparaison, la restauration et la persistance de l’historique.
- [x] Ajouter des tests couvrant les métadonnées parasites ainsi que les vraies modifications.
- [x] Vérifier les diagnostics, les tests, le lint et le build frontend.

### Validation de l’historique canonique

- Les métadonnées React Flow, l’ordre des collections et les dérives de position jusqu’à 1 px ne créent plus d’entrée.
- Les paramètres, déplacements réels, ajouts, suppressions et changements de poignée de connexion restent annulables.
- Le parcours navigateur conserve « Added node \"Table\" » après une sélection puis un recentrage, sans changement parasite.
- Vérifications finales : 29 tests, diagnostics TypeScript, lint et build réussis.

## Aplatissement des panneaux de paramétrage

- [x] Inventorier les conteneurs imbriqués communs et spécifiques aux différents nœuds.
- [x] Définir une hiérarchie plate fondée sur l’espacement, les titres et les séparateurs, avec une exception explicite pour les groupes de filtres.
- [x] Appliquer le style partagé sans retirer les bordures utiles des champs et contrôles interactifs.
- [x] Afficher le type sous le nom dans la liste compacte des colonnes du nœud Table.
- [x] Ajouter un en-tête explicite « Filter » aux cartes de condition, aligné sur celui des groupes.
- [x] Distinguer les actions du niveau racine de celles des groupes imbriqués dans le builder de filtres.
- [x] Vérifier visuellement plusieurs types de nœuds et corriger les cas spécifiques.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.

### Validation des panneaux aplatis

- Les paramètres Database, Table et Aggregate utilisent désormais des sections ouvertes, des séparateurs et des rails latéraux plutôt que des cartes imbriquées.
- Les cartes Filter et les cadres Group sont conservés car ils matérialisent la logique AND/OR.
- Les conditions affichent un en-tête « Filter » ; les groupes imbriqués ajoutent leurs enfants depuis un menu compact dans leur propre en-tête.
- Les actions principales restent identifiées par « Add to root », ce qui distingue clairement leur portée.
- Dans le sélecteur Table, le type est affiché sous le nom de colonne pour préserver la lisibilité aux faibles largeurs.
- Vérifications finales : parcours navigateur, 29 tests, diagnostics TypeScript, lint et build réussis.

## Stabilisation visuelle et ResizeObserver

- [x] Reproduire les erreurs navigateur et inventorier les ResizeObserver ainsi que les écritures de layout associées.
- [x] Identifier la boucle de rétroaction responsable des variations verticales et horizontales.
- [x] Remplacer la mesure instable par une stratégie qui n’altère pas l’élément observé.
- [x] Vérifier la stabilité pendant les ouvertures, redimensionnements et changements de contenu des panneaux.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.

### Validation de la stabilité visuelle

- Le panneau Parameters ne s’observe plus lui-même pour calculer la largeur de sa scrollbar ; la mesure est effectuée avant affichage puis seulement lors d’un redimensionnement de fenêtre.
- L’effet dépend désormais de l’identifiant du nœud et ne redémarre plus à chaque mise à jour de ses paramètres.
- Le ResizeObserver du Toolbox ne modifie plus le DOM pendant sa notification : ses écritures de masque sont regroupées sur la frame suivante.
- Le stress test navigateur combine six changements de largeur, seize transitions de catégories et cinq défilements du panneau sans erreur ResizeObserver.
- Après stabilisation, aucun changement de géométrie n’est détecté sur 120 frames consécutives.

## Recentrage sensible à la Toolbox

- [x] Identifier le propriétaire du bouton Fit View et l’état actuel d’ouverture/largeur de la Toolbox.
- [x] Exposer uniquement les dimensions utiles sans déplacer inutilement tout l’état du panneau.
- [x] Calculer le cadrage React Flow dans la zone visible selon que la Toolbox est ouverte ou réduite.
- [x] Appliquer le même espace disponible au cadrage initial après actualisation.
- [x] Garantir que le flou de la Toolbox reste visible pendant son animation d’ouverture.
- [x] Vérifier les cadrages Toolbox ouverte et fermée dans le navigateur.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : cadrage initial et manuel validé à 280 px et 480 px, Toolbox réduite validée, flou validé en mouvement et au chargement, aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.

## Recentrage sensible au panneau d’édition

- [x] Identifier l’état d’ouverture et la largeur réelle du panneau droit.
- [x] Exposer sa largeur au cadrage sans provoquer de rerenders pendant son redimensionnement.
- [x] Appliquer une marge droite dynamique au recentrage manuel et initial.
- [x] Vérifier les cas panneau droit ouvert, fermé et redimensionné dans le navigateur.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : panneau droit à 280 px et 477 px, panneau fermé, combinaison avec la Toolbox ouverte, aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.

## Visibilité du nœud sélectionné

- [x] Détecter si le nœud sélectionné serait recouvert par le panneau d’édition à son ouverture.
- [x] Décaler horizontalement le canvas uniquement dans ce cas, sans changer le zoom ni la position verticale.
- [x] Placer le nœud déplacé juste à gauche du panneau d’édition avec une marge de 32 px.
- [x] Vérifier dans le navigateur un nœud masqué et un nœud déjà visible.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : nœud recouvert déplacé de x=912–1200 à x=664–952, soit 32 px avant le panneau commençant à x=984, sans changement de zoom ni de hauteur ; nœud déjà visible et viewport inchangés ; aucune erreur navigateur ; 30 tests, diagnostics TypeScript, lint et build réussis.

## Recentrage à la fermeture de l’éditeur

- [x] Détecter uniquement la transition du panneau droit d’ouvert à fermé.
- [x] Déclencher le même Fit View contextuel pendant la fermeture, sans effet au chargement ni lors d’un changement de nœud.
- [x] Vérifier le retour du flow dans tout l’espace disponible avec la Toolbox ouverte.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : aucune action au chargement, nœud masqué rapproché du panneau à l’ouverture, viewport revenu de x=-56 à x=192 à la fermeture, Toolbox ouverte respectée, aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.

## Recentrage conditionnel à la fermeture

- [x] Mémoriser si l’ouverture de l’éditeur a réellement déplacé le viewport.
- [x] Ne lancer Fit View à la fermeture que pour une session dont l’ouverture a modifié la vue.
- [x] Vérifier les branches nœud masqué et nœud déjà visible dans le navigateur.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : le nœud masqué déclenche un déplacement puis un Fit View à la fermeture ; après un zoom manuel, le nœud déjà visible ne déplace pas la vue et sa fermeture conserve exactement le viewport ; aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.

## Visibilité du nœud à l’ouverture de la Toolbox

- [x] Publier uniquement les transitions d’ouverture de la Toolbox au gestionnaire de viewport.
- [x] Déplacer au minimum un nœud recouvert pour le placer juste à droite de la Toolbox avec 32 px de marge.
- [x] Ne lancer Fit View à la réduction que si l’ouverture a réellement déplacé la vue.
- [x] Vérifier les branches nœud recouvert et nœud déjà visible dans le navigateur.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : Toolbox terminant à x=296 et nœud recouvert replacé à x=328, soit 32 px à sa droite ; nœud déjà visible à x=380 et viewport inchangé à l’ouverture comme à la réduction ; aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.

## Validation utilisateur et exports dbt — 12 octobre 2026

- [x] Vérifier et démarrer les services locaux sans réinitialiser les données existantes.
  - Le port 5432 appartient à l’instance Homebrew et ne contient pas notre rôle ; réutiliser le cluster `.local/postgres/data` sur le port 5433 pour cette validation.
- [x] Créer dans une session navigateur dédiée des modèles de projection, filtre, agrégation, jointure et SQL personnalisé.
  - Défauts trouvés en UI : port Database ajouté non enregistré avant refresh ; bouton de retrait recouvrant le port ; Join interdit deux clés de même nom. Conserver les reproductions et utiliser un alias explicite côté clients pour terminer la validation du SQL de jointure.
- [x] Sauvegarder les flows et exporter les archives dbt via l’interface.
- [x] Compiler/exécuter les exports et comparer les résultats complets à des requêtes PostgreSQL indépendantes.
  - Valider aussi les ZIP sans réécriture du SQL via dbt-postgres, en matérialisant uniquement dans des schémas dédiés du cluster de test sur 5433. Adaptateur temporaire : `/private/tmp/dbt-flow-audit-adapter.XYu6ah`, propriétaire : cette tâche.
- [x] Conserver un rapport avec les preuves, limites et éventuels défauts reproductibles.
  - Des modifications externes ont changé le backend et la pagination pendant l’audit (12 octobre, 14:01–14:05). Redémarrer notre service et revalider les cinq flows contre la version actuelle avant de conclure.
- [x] Fournir les commandes de démarrage et les conclusions vérifiées.
- Résultat : 5 ZIP dbt originaux construits sur PostgreSQL avec zéro écart exhaustif ; 5 flows repassés dans le backend PostgreSQL natif actuel ; 30 tests frontend, 24 tests backend et 3 tests d’intégration PostgreSQL réussis. Rapport et bundle sous `output/playwright/dbt-audit-2026-10-12/`. Adaptateur temporaire supprimé et absence du dossier vérifiée. Services conservés sur 5173, 8765 et PostgreSQL 5433.

## Correction des trois défauts de l’audit dbt — 12 octobre 2026

- [x] Autoriser les deux colonnes homonymes dans le paramétrage d’une jointure.
- [x] Synchroniser les ports et leurs positions avec React Flow lors de leur ajout, retrait et chargement.
- [x] Séparer les commandes d’ajout/retrait des zones de connexion et vérifier les deux côtés.
- [x] Reproduire en UI les connexions immédiates et la jointure customer_id = customer_id, puis exporter et exécuter son dbt sur PostgreSQL.
- [x] Exécuter les vérifications frontend adaptées et consigner les résultats.
- Résultat : nouveaux ports Database et Join connectables immédiatement par glisser-déposer au centre ; boutons de retrait hors des zones de connexion ; 5 liens conservés au chargement puis au refresh ; aucune erreur ni avertissement navigateur. Jointure sans alias validée par le bouton Test, puis ZIP original construit avec dbt-postgres (3 succès, zéro erreur). Comparaison exhaustive : 1 000 lignes attendues et obtenues, zéro ligne manquante ou supplémentaire. 30 tests frontend, diagnostics TypeScript, lint, build et diff-check réussis. Preuves sous `output/playwright/dbt-fixes-2026-10-12/`.

## Visibilité du nœud au clic derrière la Toolbox

- [x] Calculer au clic les limites visibles entre la Toolbox et l’éditeur.
- [x] Déplacer au minimum le nœud s’il est partiellement ou totalement recouvert à gauche.
- [x] Préserver le comportement existant pour l’éditeur droit sans déclencher deux déplacements concurrents.
- [x] Vérifier les recouvrements partiel et total ainsi que le cas déjà visible dans le navigateur.
- [x] Exécuter les diagnostics, les tests, le lint et le build frontend.
- Vérifications finales : chevauchement partiel depuis x=212 et recouvrement total de x=-38 à x=250, avec une Toolbox terminant à x=296 ; les deux sont replacés à x=328, soit 32 px à droite ; nœud déjà visible à x=462 et viewport inchangé au clic puis à la fermeture ; aucune erreur navigateur, 30 tests, diagnostics TypeScript, lint et build réussis.
