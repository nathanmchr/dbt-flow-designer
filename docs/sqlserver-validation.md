# Validation SQL Server — 13 octobre 2026

Le connecteur SQL Server est validé sur une instance dédiée SQL Server 2022
Developer CU16 (16.0.4165.4), avec Microsoft ODBC 18.7.1.1 et dbt-sqlserver 1.10.1.
Le compte source est SELECT-only ; un compte builder distinct construit les
exports dans des schémas de validation uniques, supprimés après les tests.

## Base de test

L’instance Docker `dbt-flow-sqlserver-test` et son volume dédié sont réutilisés
après vérification de leur label propriétaire. La base `dbt_flow_test` est
accessible sur `127.0.0.1:1433`. Les trois users/commandes du schéma `dbo` sont
conservés. Le schéma `qa` ajoute 100 clients, 30 produits, 1 000 commandes et
3 000 lignes de commande. Les fixtures comprennent NULL, décimaux, BIT, Unicode,
doublons et vingt commandes sans client correspondant.

```bash
backend/venv/bin/python scripts/local-sqlserver.py setup
backend/venv/bin/python scripts/local-sqlserver.py test --all
```

Le setup répété préserve les tables et données existantes. Les identifiants sont
dans `.local/sqlserver/credentials.json`, privé et ignoré par Git. Pour utiliser
la fixture enrichie, sélectionner SQL Server, base `dbt_flow_test`, schéma `qa`,
compte `dbt_flow_reader`, chiffrement activé et confiance explicite dans le
certificat auto-signé de cette seule instance locale.

## Modèles et comparaisons exhaustives

Les flows passent par le générateur frontend réel, la compilation dbt native et
le parcours d’aperçu SQL Server. Les fichiers SQL/YAML exportés sont construits
sans modification ; seul un profil cible externe est fourni. Chaque comparaison
porte sur toutes les colonnes et toutes les lignes, avec conservation des NULL
et de la multiplicité des doublons. Les références sont des requêtes T-SQL
indépendantes des fichiers générés.

- Projection et alias : 1 000 lignes.
- Filtres AND/OR imbriqués, apostrophe/Unicode et BIT, tri décroissant : 6 lignes.
- LEFT JOIN avec sélection/alias et tri : 1 000 lignes, dont 20 sans correspondance.
- SUM, COUNT(*), COUNT(colonne), AVG entier et COUNT DISTINCT : 99 groupes.
- Deux INNER JOIN, filtre, SQL personnalisé calculant le revenu, agrégation,
  filtre après agrégation et tri : 3 catégories.
- ROW_NUMBER partitionné et sélection des deux premières commandes par client :
  198 lignes.
- UNION ALL avec doublons et NULL : 200 lignes.
- Filtre sans résultat : zéro ligne, colonnes conservées.

Résultat : zéro écart pour les huit aperçus et les huit builds d’exports.
Les trois variantes du petit jeu `dbo` (jointure/filtre/tri, agrégation et SQL
personnalisé) passent également. Pagination exhaustive par pages de 250,
recherche Unicode, statistiques/NULL, refus d’écriture par le parseur et par
les droits SQL Server, et intégrité complète des quatre tables `qa` sont vérifiés.

## Interface et ZIP téléchargé

Le modèle complexe est chargé dans l’interface sur `http://127.0.0.1:5174`, avec
le backend normal sur 8765. Le voyant Live fonctionne et Test affiche Books
(37 500), Home (35 000), Tech (32 500), chacun avec 2 000 unités et 800 lignes.
Le ZIP effectivement téléchargé contient 16 fichiers ; son build dbt réussit
sans réécriture et ses trois lignes correspondent entièrement à la référence.
Les sources sont inchangées.
Le flow de projection est également importé puis rechargé : secret déchiffré,
voyant Live et Test fonctionnels, 1 000 lignes/deux colonnes, 25 lignes par page
et 40 pages. La console ne contient aucune erreur ni avertissement. Ce contrôle
utilise une session Playwright dédiée après un état de dialogue périmé du
navigateur T3 ; le parcours applicatif et le backend ne sont pas détournés.

## Contrôles et preuves

- 61 tests backend réussis, zéro skip, avec PostgreSQL, DuckDB et SQL Server réels.
- 38 tests frontend réussis, zéro skip.
- Lint, TypeScript/build Vite, `pip check` et `git diff --check` réussis.
- Avertissements préexistants : bundle Vite >500 kB et baseline-browser-mapping ancien.

Preuves locales durables : `output/playwright/sqlserver-dev-2026-10-13/`, notamment
`backend-all.log`, `models.json`, exports et SQL compilés par modèle, ZIP UI,
`ui_zip_build.log` et `ui_zip_result.json`. Les projets dbt temporaires des tests
sont supprimés automatiquement ; leurs journaux utiles sont conservés.
La base et le volume restent disponibles pour les essais utilisateur.

## Limites

Ce résultat couvre cette version et l’authentification SQL/TCP. Azure SQL,
Windows/Entra, les autres versions et les jointures inter-SGBD ne sont pas
certifiés. La fixture Mac ARM utilise l’émulation x86-64 et root dans un
conteneur isolé non privilégié ; elle ne représente pas un déploiement de
production. Les détails de configuration restent dans [le guide](sqlserver.md).
