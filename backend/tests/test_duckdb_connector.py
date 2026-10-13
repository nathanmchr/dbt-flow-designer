import hashlib
import tempfile
import unittest
from pathlib import Path

import duckdb

from connectors import get_connector
from connectors.duckdb_connector import DuckDBConnector
from executor import QueryExecutor


class DuckDBConnectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "source.duckdb"
        with duckdb.connect(str(self.path)) as connection:
            connection.execute("CREATE TABLE orders AS SELECT i AS id, 'Customer ' || i AS name, "
                               "CASE WHEN i = 3 THEN NULL ELSE i * 10 END AS amount FROM range(1, 101) r(i)")
            connection.execute('CREATE SCHEMA "raw data"')
            connection.execute('CREATE TABLE "raw data"."odd""table" ("odd""column" INTEGER)')
            connection.execute('CREATE VIEW order_view AS SELECT * FROM orders')
        self.credentials = {"path": str(self.path)}
        self.before = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def tearDown(self) -> None:
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), self.before)
        self.directory.cleanup()

    def test_native_catalog_views_and_quoted_identifiers(self) -> None:
        with get_connector("duckdb", self.credentials) as connector:
            self.assertEqual(connector.get_tables(), ["order_view", "orders"])
            self.assertEqual(connector.get_tables("raw data"), ['odd"table'])
            self.assertEqual(connector.get_columns('odd"table', "raw data"),
                             [{"name": 'odd"column', "type": "INTEGER"}])
            self.assertEqual(connector.get_columns("orders' OR TRUE --"), [])
        self.assertIsNone(connector.connection)

    def test_pagination_sort_search_and_full_row_count(self) -> None:
        executor = QueryExecutor()
        self.assertEqual(executor.get_tables("duckdb", self.credentials), ["order_view", "orders"])
        self.assertEqual(executor.get_columns("duckdb", self.credentials, "orders")[0]["name"], "id")
        preview = executor.execute_query("duckdb", self.credentials, "SELECT * FROM orders", 25)
        self.assertEqual(preview["row_count"], 100)
        self.assertEqual(len(preview["data"]), 25)
        self.assertIsNone(executor.result_store)
        second = executor.get_results_page(page=2, page_size=10, sort_column="id", sort_direction="DESC")
        self.assertEqual(second["data"][0]["id"], 90)
        self.assertEqual(second["total_pages"], 10)
        search = executor.get_results_page(search="CUSTOMER 99", sort_column="id")
        self.assertEqual(search["total_rows"], 1)
        self.assertEqual(search["data"][0]["id"], 99)
        self.assertEqual(executor.get_results_page(search="' OR TRUE --")["total_rows"], 0)
        executor.close()

    def test_ctes_percent_literals_and_outer_limit(self) -> None:
        with DuckDBConnector(self.credentials) as connector:
            result = connector.execute("WITH x AS (SELECT id, '50% limit' AS label FROM orders LIMIT 10) SELECT * FROM x;", 2)
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["label"], "50% limit")
            self.assertEqual(len(connector.get_results_page("SELECT * FROM orders", page_size=500)["data"]), 100)

    def test_empty_results_retain_columns_and_numeric_stats(self) -> None:
        with DuckDBConnector(self.credentials) as connector:
            empty = connector.get_results_page("SELECT id, amount FROM orders WHERE FALSE")
            self.assertEqual(empty["columns"], ["id", "amount"])
            self.assertEqual(empty["total_rows"], 0)
            stats = connector.get_query_stats("SELECT * FROM orders")
            self.assertEqual(stats["amount"]["nulls"], 1)
            self.assertEqual(stats["amount"]["max"], 1000)
            self.assertEqual(stats["amount"]["min"], 10)

    def test_rejects_sql_writes_and_multiple_statements(self) -> None:
        with DuckDBConnector(self.credentials) as connector:
            for query in ("DELETE FROM orders", "DROP TABLE orders", "SELECT 1; SELECT 2", "COPY orders TO '/tmp/unsafe.csv'"):
                with self.subTest(query=query), self.assertRaises(ValueError):
                    connector.execute(query)
            # The database itself is read-only even if validation is bypassed by a macro.
            with self.assertRaises(duckdb.InvalidInputException):
                connector.connection.execute("CREATE TABLE forbidden (id INTEGER)")

    def test_disables_external_file_access(self) -> None:
        csv = Path(self.directory.name) / "private.csv"
        csv.write_text("private\nsecret\n", encoding="utf-8")
        with DuckDBConnector(self.credentials) as connector:
            with self.assertRaises(duckdb.PermissionException):
                connector.execute(f"SELECT * FROM read_csv_auto('{csv}')")

    def test_missing_files_and_memory_sources_are_rejected_without_creation(self) -> None:
        missing = Path(self.directory.name) / "missing.duckdb"
        for path in (str(missing), ":memory:", "", "md:cloud"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                DuckDBConnector({"path": path}).test_connection()
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
