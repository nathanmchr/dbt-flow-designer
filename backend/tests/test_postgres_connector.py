import unittest
from unittest.mock import MagicMock, patch

from connectors.postgres import PostgresConnector


class Cursor:
    def __init__(self, rows=None) -> None:
        self.rows = rows or []
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        return None

    def execute(self, query, parameters=None) -> None:
        self.executions.append((query, parameters))

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self, cursor: Cursor) -> None:
        self._cursor = cursor
        self.autocommit = False
        self.closed = False

    def cursor(self, **_kwargs):
        return self._cursor

    def close(self) -> None:
        self.closed = True

    def set_session(self, **_kwargs) -> None:
        pass

    def rollback(self) -> None:
        pass


class PostgresConnectorTests(unittest.TestCase):
    def test_connect_enforces_read_only_and_timeouts(self) -> None:
        connection = MagicMock()
        with patch("connectors.postgres.psycopg2.connect", return_value=connection) as connect:
            connector = PostgresConnector(
                {
                    "host": "db.example.test",
                    "port": 5433,
                    "database": "warehouse",
                    "user": "reader",
                    "password": "secret",
                    "sslmode": "verify-full",
                }
            )
            connector.connect()

        parameters = connect.call_args.kwargs
        self.assertEqual(parameters["connect_timeout"], 10)
        self.assertEqual(parameters["sslmode"], "verify-full")
        self.assertIn("statement_timeout=30000", parameters["options"])
        self.assertIn("default_transaction_read_only=on", parameters["options"])
        self.assertTrue(connection.autocommit)

    def test_execute_wraps_select_and_binds_a_capped_limit(self) -> None:
        cursor = Cursor([{"id": 1}, {"id": 2}])
        connector = PostgresConnector({})
        connector.connection = Connection(cursor)

        rows = connector.execute("SELECT id FROM orders;", limit=50_000)

        query, parameters = cursor.executions[0]
        self.assertEqual(rows, [{"id": 1}, {"id": 2}])
        self.assertEqual(parameters, (10_000,))
        self.assertEqual(
            query,
            "SELECT * FROM (\nSELECT id FROM orders\n) AS preview_query LIMIT %s",
        )

    def test_execute_rejects_non_query_statements(self) -> None:
        connector = PostgresConnector({})
        connector.connection = Connection(Cursor())

        with self.assertRaisesRegex(ValueError, "read-only SELECT"):
            connector.execute("DELETE FROM orders")

    def test_execute_rejects_multiple_statements_and_writable_ctes(self) -> None:
        connector = PostgresConnector({})
        connector.connection = Connection(Cursor())
        for sql in (
            "SELECT 1; COMMIT; DELETE FROM orders",
            "WITH x AS (SELECT 1) DELETE FROM orders",
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(ValueError, "single read-only SELECT"):
                connector.execute(sql)

    def test_execute_rolls_back_a_read_only_transaction(self) -> None:
        connector = PostgresConnector({})
        connector.connection = MagicMock()
        connector.execute("SELECT 1")

        connector.connection.set_session.assert_any_call(
            readonly=True, isolation_level="REPEATABLE READ", autocommit=False
        )
        connector.connection.rollback.assert_called_once()

    def test_connection_errors_are_not_hidden(self) -> None:
        connector = PostgresConnector({})
        with patch.object(connector, "connect", side_effect=RuntimeError("unreachable")):
            with self.assertRaisesRegex(RuntimeError, "unreachable"):
                connector.test_connection()


if __name__ == "__main__":
    unittest.main()
