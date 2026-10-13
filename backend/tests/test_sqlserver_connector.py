"""Driver-independent SQL Server contracts; no mock is presented as a live test."""

from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from sqlglot import parse_one, exp

from connectors import get_connector
from connectors.sqlserver import SQLServerConnector, credential_bool


CREDS = {"host": "db.example.test", "database": "warehouse", "user": "reader", "password": "secret; } "}


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.description = [("id", int), ("email", str), ("amount", Decimal)]
        self.rows = []

    def execute(self, sql, *parameters):
        self.connection.calls.append((sql, parameters))
        if "fn_my_permissions" in sql:
            self.rows = [(permission,) for permission in self.connection.permissions]
        elif "COUNT_BIG(*) FROM" in sql:
            self.rows = [(3,)]
        elif "AVG(CAST" in sql:
            self.rows = [(1, 3, 2.0, 0, Decimal("10"), Decimal("30"), 20.0, 0)]
        elif "FROM sys.objects" in sql:
            self.rows = [("orders",), ("order_summary",)]
        elif "INFORMATION_SCHEMA.COLUMNS" in sql:
            self.rows = [("id", "int"), ("amount", "decimal")]
        elif sql == "SELECT 1":
            self.rows = [(1,)]
        else:
            self.rows = [(3, "gamma", Decimal("30"))]
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]

    def close(self):
        self.connection.closed_cursors += 1


class FakeConnection:
    def __init__(self, permissions=("CONNECT", "SELECT", "VIEW DEFINITION")):
        self.permissions = permissions
        self.calls = []
        self.rollbacks = 0
        self.closed = False
        self.closed_cursors = 0

    def cursor(self):
        return FakeCursor(self)

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class SQLServerConnectorTests(unittest.TestCase):
    def connector(self):
        connector = SQLServerConnector(CREDS)
        connector.connection = FakeConnection()
        return connector

    def driver(self, connection):
        return SimpleNamespace(drivers=lambda: [SQLServerConnector.DEFAULT_DRIVER], connect=Mock(return_value=connection))

    def test_registry_loads_native_connector(self):
        connector = get_connector("sqlserver", CREDS)
        self.assertIsInstance(connector, SQLServerConnector)
        self.assertTrue(connector.supports_native_preview)
        self.assertEqual(connector.default_schema, "dbo")

    def test_secure_connection_options_and_escaped_credentials(self):
        connector = SQLServerConnector(CREDS)
        connection = FakeConnection()
        driver = self.driver(connection)
        with patch.dict("sys.modules", {"pyodbc": driver}):
            connector.connect()
        value = driver.connect.call_args.args[0]
        self.assertIn("Encrypt={yes}", value)
        self.assertIn("TrustServerCertificate={no}", value)
        self.assertIn("PWD={secret; }} }", value)
        self.assertIn("SERVER={tcp:db.example.test,1433}", value)
        self.assertEqual(driver.connect.call_args.kwargs, {"timeout": 10, "autocommit": False})
        self.assertEqual(connection.timeout, 30)
        self.assertTrue(any("fn_my_permissions" in sql for sql, _ in connection.calls))
        connector.close()
        self.assertTrue(connection.closed)

    def test_boolean_validation_and_missing_credentials(self):
        self.assertFalse(credential_bool("false", True))
        self.assertTrue(credential_bool(None, True))
        with self.assertRaises(ValueError):
            credential_bool("maybe", True)
        for credentials in ({}, {**CREDS, "port": 0}, {**CREDS, "host": "db;Encrypt=no"},
                            {**CREDS, "driver": "other"}, {**CREDS, "database": "db;UID=admin"}):
            with self.subTest(credentials=credentials), self.assertRaises(ValueError):
                SQLServerConnector(credentials).connection_options()

    def test_missing_odbc_driver_has_actionable_error(self):
        with patch.dict("sys.modules", {"pyodbc": SimpleNamespace(drivers=lambda: [])}):
            with self.assertRaisesRegex(RuntimeError, "Install ODBC Driver"):
                SQLServerConnector(CREDS).connect()

    def test_elevated_or_write_accounts_are_rejected_and_closed(self):
        for permission in ("INSERT", "UPDATE", "DELETE", "CONTROL", "EXECUTE", "CREATE TABLE", "ALTER ANY LOGIN"):
            connection = FakeConnection(("SELECT", permission))
            with self.subTest(permission=permission), patch.dict("sys.modules", {"pyodbc": self.driver(connection)}):
                with self.assertRaisesRegex(RuntimeError, "SELECT-only"):
                    SQLServerConnector(CREDS).connect()
                self.assertTrue(connection.closed)

    def test_driver_errors_do_not_return_passwords(self):
        driver = self.driver(FakeConnection())
        driver.connect.side_effect = RuntimeError("bad password " + CREDS["password"])
        with patch.dict("sys.modules", {"pyodbc": driver}), self.assertRaises(RuntimeError) as raised:
            SQLServerConnector(CREDS).connect()
        self.assertNotIn(CREDS["password"], str(raised.exception))

    def test_select_only_ast_rejects_writes_sequences_and_remote_sources(self):
        queries = ["DELETE FROM dbo.orders", "SELECT 1; DELETE FROM dbo.orders", "SELECT * INTO dbo.copy FROM dbo.orders",
                   "WITH x AS (DELETE FROM dbo.orders OUTPUT deleted.*) SELECT * FROM x",
                   "SELECT NEXT VALUE FOR dbo.sequence AS id", "EXEC dbo.proc", "SELECT * FROM other.dbo.orders",
                   "SELECT * FROM remote.warehouse.dbo.orders", "SELECT * FROM OPENQUERY(remote, 'SELECT 1')",
                   "SELECT * FROM OPENROWSET(BULK '/private/file', SINGLE_CLOB) x"]
        for query in queries:
            with self.subTest(query=query), self.assertRaises(ValueError):
                SQLServerConnector(CREDS)._validate_query(query)
        SQLServerConnector(CREDS)._validate_query("SELECT * FROM warehouse.dbo.orders WHERE email = N'O''Reilly; delete'")

    def test_ctes_are_hoisted_and_unbounded_sorts_are_valid_in_tsql(self):
        prefix, source, order = SQLServerConnector(CREDS)._preview_source(
            "WITH __dbt_flow_preview AS (SELECT id FROM dbo.orders ORDER BY id OFFSET 0 ROWS), "
            "x AS (SELECT * FROM __dbt_flow_preview) SELECT * FROM x ORDER BY x.id DESC;")
        self.assertEqual(source, "[__dbt_flow_preview_]")
        self.assertEqual(order, "ORDER BY id DESC")
        query = prefix + "SELECT TOP (0) * FROM " + source
        ast = parse_one(query, read="tsql")
        self.assertEqual(len(list(ast.find_all(exp.With))), 1)
        self.assertIn("OFFSET 0 ROWS", query)

    def test_invalid_inner_sort_is_not_silently_repaired_for_preview_only(self):
        with self.assertRaisesRegex(ValueError, "requires TOP or OFFSET"):
            SQLServerConnector(CREDS)._preview_source("WITH x AS (SELECT id FROM dbo.orders ORDER BY id) SELECT * FROM x")
        prefix, source, _ = SQLServerConnector(CREDS)._preview_source("SELECT id FROM dbo.orders UNION ALL SELECT id FROM dbo.orders ORDER BY id")
        parse_one(prefix + "SELECT * FROM " + source, read="tsql")
        self.assertIn("OFFSET 0 ROWS", prefix)

    def test_top_and_existing_offset_are_not_replaced(self):
        prefix, _, _ = SQLServerConnector(CREDS)._preview_source("SELECT TOP (2) id FROM dbo.orders ORDER BY id DESC")
        self.assertIn("TOP 2", prefix)
        self.assertNotIn("OFFSET", prefix)
        prefix, _, _ = SQLServerConnector(CREDS)._preview_source("SELECT id FROM dbo.orders ORDER BY id OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY")
        self.assertIn("OFFSET 1 ROWS", prefix)
        self.assertIn("FETCH NEXT 2 ROWS ONLY", prefix)

    def test_pagination_search_sort_and_size_limits(self):
        connector = self.connector()
        result = connector.get_results_page("SELECT id, email, amount FROM dbo.orders", page=999, page_size=1,
                                            sort_column="amount", sort_direction="DESC", search="O'Reilly 100%_[~")
        self.assertEqual(result["page"], 3)
        self.assertEqual(result["total_rows"], 3)
        query, parameters = connector.connection.calls[-1]
        self.assertIn("ORDER BY [amount] DESC OFFSET 2 ROWS FETCH NEXT 1 ROWS ONLY", query)
        self.assertNotIn("O'Reilly", query)
        self.assertEqual(parameters, ("%O'Reilly 100~%~_~[~~%",) * 3)
        self.assertEqual(connector.connection.rollbacks, 1)
        connector.get_results_page("SELECT id, email, amount FROM dbo.orders", page_size=10000,
                                   sort_column="id]; DROP TABLE orders--", sort_direction="invalid")
        self.assertIn("ORDER BY (SELECT NULL)", connector.connection.calls[-1][0])
        self.assertIn("FETCH NEXT 250 ROWS ONLY", connector.connection.calls[-1][0])

    def test_empty_results_preserve_columns_and_duplicates_are_rejected(self):
        connector = self.connector()
        cursor = FakeCursor(connector.connection)
        original_execute = cursor.execute
        def empty(sql, *parameters):
            original_execute(sql, *parameters)
            cursor.rows = [(0,)] if "COUNT_BIG(*) FROM" in sql else []
            return cursor
        cursor.execute = empty
        with patch.object(connector.connection, "cursor", return_value=cursor):
            result = connector.get_results_page("SELECT id, email, amount FROM dbo.orders WHERE 1=0")
            self.assertEqual(result["columns"], ["id", "email", "amount"])
            self.assertEqual(result["data"], [])
            self.assertEqual(result["total_rows"], 0)
            self.assertEqual(result["total_pages"], 1)
            cursor.description = [("id", int), ("id", int)]
            with self.assertRaisesRegex(ValueError, "unique names"):
                connector.get_results_page("SELECT id, id FROM dbo.orders")

    def test_catalog_is_parameterized_and_includes_views(self):
        connector = self.connector()
        self.assertEqual(connector.get_tables("dbo'"), ["orders", "order_summary"])
        sql, parameters = connector.connection.calls[-1]
        self.assertEqual(parameters, ("dbo'",))
        self.assertIn("('U', 'V')", sql)
        self.assertEqual(connector.get_columns("orders'", "dbo"), [{"name": "id", "type": "INT"}, {"name": "amount", "type": "DECIMAL"}])
        self.assertEqual(connector.connection.calls[-1][1], ("dbo", "orders'"))

    def test_numeric_statistics_and_bounded_execute(self):
        connector = self.connector()
        stats = connector.get_query_stats("SELECT id, email, amount FROM dbo.orders")
        self.assertEqual(stats["amount"]["avg"], 20)
        self.assertEqual(stats["id"]["nulls"], 0)
        connector.execute("SELECT id FROM dbo.orders", limit=99999)
        self.assertIn("SELECT TOP (10000)", connector.connection.calls[-1][0])

    def test_transaction_rolls_back_and_closes_cursor_on_error(self):
        connector = self.connector()
        with patch.object(FakeCursor, "execute", side_effect=RuntimeError("query timeout")):
            with self.assertRaisesRegex(RuntimeError, "query timeout"):
                connector.get_results_page("SELECT id FROM dbo.orders")
        self.assertEqual(connector.connection.rollbacks, 1)
        self.assertEqual(connector.connection.closed_cursors, 1)


if __name__ == "__main__":
    unittest.main()
