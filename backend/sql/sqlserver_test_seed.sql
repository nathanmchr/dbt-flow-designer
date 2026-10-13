-- Run only in a dedicated, empty SQL Server test database, with an administrator.
-- This script never creates a database, a login, or changes existing data.
IF DB_NAME() IN ('master', 'model', 'msdb', 'tempdb')
    THROW 50000, 'Choose a dedicated test database before running this fixture.', 1;
IF OBJECT_ID('dbo.users') IS NOT NULL OR OBJECT_ID('dbo.orders') IS NOT NULL
    THROW 50001, 'Fixture tables already exist; no data has been replaced.', 1;

CREATE TABLE dbo.users (id INT PRIMARY KEY, email NVARCHAR(200), active BIT);
CREATE TABLE dbo.orders (order_id INT PRIMARY KEY, user_id INT, amount DECIMAL(18,2));
INSERT INTO dbo.users VALUES (1, N'alpha@example.test', 1), (2, N'beta@example.test', 0), (3, N'gamma@example.test', 1);
INSERT INTO dbo.orders VALUES (1, 1, 10), (2, 2, 20), (3, 3, 30);
EXEC(N'CREATE VIEW dbo.order_summary AS SELECT user_id, SUM(amount) AS total_amount FROM dbo.orders GROUP BY user_id');
-- Add the application's dedicated login as a database user, then grant only:
-- GRANT SELECT ON SCHEMA::dbo TO [dbt_flow_reader];
-- Do not grant db_owner, db_datawriter, DDL, EXECUTE or elevated server roles.
