# ADR-001 — Prise en charge progressive des plateformes SQL

Statut : accepté pour le premier lot, 13 octobre 2026.

## Périmètre et couverture

Le produit construit et teste des modèles dbt. Nous ciblons les plateformes SQL, à la fois bases applicatives et data/BI. Nous ne promettons pas 95–98 % du marché : ni un classement de popularité, ni des pourcentages d’usage multi-choix ne permettent de mesurer cette couverture. Elle devra être mesurée sur les environnements des utilisateurs cibles.

| Vague | Moteurs | Objectif |
| --- | --- | --- |
| Socle | PostgreSQL, DuckDB | Deux moteurs natifs réellement testés, dont un moteur analytique local reproductible |
| Priorité entreprise | SQL Server/Azure SQL, MySQL 8+/MariaDB, Snowflake, BigQuery, Databricks | Couvrir simultanément bases applicatives et entrepôts data/BI |
| Extension | Oracle, Redshift, Microsoft Fabric/Synapse | Grandes entreprises et écosystèmes cloud |
| Besoins spécialisés | ClickHouse, Trino/Starburst, Athena, Spark, Db2, Teradata | Analytics temps réel, fédération et patrimoines existants |

Les variantes managées ne sont pas automatiquement certifiées : RDS/Aurora, Cloud SQL, AlloyDB, etc. doivent être vérifiées avec leur authentification, chiffrement et version. SQLite reste hors priorité analytique ; MongoDB, Redis et autres systèmes non SQL demanderaient un parcours d’ingestion distinct, pas un simple adaptateur dbt.

## Décision

Conserver les interfaces et le registre des connecteurs existants. Sélectionner le parcours de pagination natif par capacité du connecteur, et non par un test `type == postgres`. Chaque moteur apporte son propre catalogue, SQL de pagination, statistiques, et profil de compilation dbt. Ne pas simuler un moteur cloud avec DuckDB et ne pas installer tous les SDK cloud au démarrage.

Le premier lot active DuckDB sur des fichiers locaux existants, en lecture seule : aucun fichier n’est créé par une simple connexion, aucune extension n’est chargée et aucun modèle source n’est matérialisé par le bouton Test. L’export reste un projet dbt ordinaire qui peut être construit séparément avec un profil et une destination adaptés.

Le lot SQL Server implémente maintenant le parcours natif avec SQL authentication,
TLS, catalogue et dbt-sqlserver 1.10.1. Une instance dédiée SQL Server 2022 CU16
Developer a permis de vérifier les aperçus natifs, les droits du reader, les builds
du SQL exporté et l’intégrité des sources. Cette validation locale ne certifie pas
les autres versions/Azure/Entra ni le déploiement émulé macOS pour la production.
Les tests serveur et build exporté restent opt-in ; voir le
[guide SQL Server](../sqlserver.md). SQL Server exige un compte SELECT-only contrôlé,
car il ne dispose pas des transactions READ ONLY de PostgreSQL.

Un modèle s’exécute sur un moteur cible unique. Ajouter plusieurs connecteurs ne permet pas automatiquement une jointure entre PostgreSQL et Snowflake : ce besoin demanderait une ingestion préalable ou un moteur de fédération tel que Trino.

## Alternatives et compromis

- Activer tous les noms déjà présents dans la liste : rapide, mais fausse prise en charge ; rejeté.
- Ajouter une abstraction universelle SQL/ORM : trop tôt, masquerait les différences de dialecte et d’authentification ; rejeté.
- Ajouter progressivement des connecteurs natifs dans la structure existante : retenu ; coût de validation par moteur assumé.

Les identifiants, qualifications de source, types, fonctions, filtres, limites et matérialisations diffèrent selon les dialectes. PostgreSQL et DuckDB partagent ici les formes SQL utilisées ; cela ne vaut pas certification des autres moteurs. Les adaptateurs communautaires, notamment MySQL/MariaDB, exigent une validation de compatibilité avec notre version dbt avant activation.

## Critères pour activer un moteur

1. Connexion et authentification réelles, secrets persistés sans fuite, chiffrement approprié.
2. Tables/vues et colonnes réelles, schémas et bases correctement qualifiés.
3. Projection, filtres, jointures, agrégations et SQL personnalisé cohérents avec le dialecte ; erreurs explicites pour les opérations non prises en charge.
4. Aperçu en lecture seule, pagination/recherche/tri/statistiques sur le moteur, résultats vides conservant leurs colonnes.
5. ZIP exporté construit sans réécriture SQL sur ce moteur et comparaison exhaustive aux résultats attendus.
6. Sources inchangées, tests de refus d’écriture, non-régression et preuves conservées.

Pour les moteurs cloud, des environnements de test et une autorisation de coût seront nécessaires avant une certification réelle.

## Sources de cadrage

- [Stack Overflow Developer Survey 2026 — technologies](https://survey.stackoverflow.co/2026/technology) : indicateur d’usage développeurs, pas part de marché entreprise additive.
- [dbt — plateformes prises en charge](https://docs.getdbt.com/docs/supported-data-platforms) : adaptateurs dédiés et niveaux de maintenance distincts.
- [dbt — configuration MySQL](https://docs.getdbt.com/docs/local/connect-data-platform/mysql-setup) : adaptateur expérimental, différences de versions et matérialisations.
- [dbt — configuration SQL Server](https://docs.getdbt.com/docs/local/connect-data-platform/mssql-setup) : adaptateur communautaire, ODBC et TLS.
- [dbt-duckdb](https://github.com/duckdb/dbt-duckdb) : profil du moteur analytique local.
