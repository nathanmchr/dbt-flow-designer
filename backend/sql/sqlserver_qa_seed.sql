-- Add deterministic, richer fixtures without replacing existing source data.
-- Only the dedicated local test database is permitted.
IF DB_NAME() <> 'dbt_flow_test'
    THROW 50000, 'QA fixtures require the dedicated dbt_flow_test database.', 1;
IF SCHEMA_ID('qa') IS NOT NULL
BEGIN
    IF OBJECT_ID('qa.customers', 'U') IS NULL OR OBJECT_ID('qa.products', 'U') IS NULL
       OR OBJECT_ID('qa.orders', 'U') IS NULL OR OBJECT_ID('qa.order_items', 'U') IS NULL
        THROW 50001, 'Existing qa schema is incomplete; no data has been replaced.', 1;
    RETURN;
END;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC(N'CREATE SCHEMA qa AUTHORIZATION dbo');
CREATE TABLE qa.customers (customer_id INT PRIMARY KEY, customer_name NVARCHAR(200), country NVARCHAR(10), active BIT);
CREATE TABLE qa.products (product_id INT PRIMARY KEY, category NVARCHAR(30), price DECIMAL(18,2));
CREATE TABLE qa.orders (order_id INT PRIMARY KEY, customer_id INT, amount DECIMAL(18,2), status NVARCHAR(30));
CREATE TABLE qa.order_items (item_id INT PRIMARY KEY, order_id INT, product_id INT, quantity INT);
;WITH numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 100)
INSERT INTO qa.customers
SELECT n, CASE WHEN n=1 THEN N'L''été 東京' ELSE CONCAT(N'Customer ', n) END,
       CASE WHEN n%10=0 THEN NULL WHEN n%2=0 THEN N'FR' ELSE N'JP' END,
       CAST(n%2 AS BIT) FROM numbers OPTION (MAXRECURSION 100);
;WITH numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 30)
INSERT INTO qa.products
SELECT n, CASE WHEN n%3=0 THEN N'Books' WHEN n%3=1 THEN N'Tech' ELSE N'Home' END,
       CAST(n*1.25 AS DECIMAL(18,2)) FROM numbers OPTION (MAXRECURSION 100);
;WITH numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000)
INSERT INTO qa.orders
SELECT n, CASE WHEN n%50=0 THEN 999 ELSE (n-1)%100+1 END,
       CASE WHEN n%37=0 THEN NULL ELSE CAST((n%97)*1.25 AS DECIMAL(18,2)) END,
       CASE WHEN n%5=0 THEN N'cancelled' ELSE N'paid' END
FROM numbers OPTION (MAXRECURSION 1000);
;WITH numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 3000)
INSERT INTO qa.order_items
SELECT n, (n-1)/3+1, (n-1)%30+1, (n%4)+1
FROM numbers OPTION (MAXRECURSION 3000);
COMMIT;
