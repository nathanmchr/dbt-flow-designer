"""
PostgreSQL Database Connector

Connects to PostgreSQL databases using psycopg2.
"""

from typing import Any
from contextlib import contextmanager
import psycopg2
from psycopg2.extras import RealDictCursor
import sqlparse

from .base import BaseConnector


class PostgresConnector(BaseConnector):
    """PostgreSQL database connector using psycopg2."""

    supports_native_preview = True

    def connect(self) -> None:
        """Establish connection to PostgreSQL database."""
        statement_timeout_ms = min(
            max(int(self.credentials.get("statement_timeout_ms", 30_000)), 1_000),
            300_000,
        )
        connection_options = (
            f"-c statement_timeout={statement_timeout_ms} "
            "-c default_transaction_read_only=on"
        )
        connection_params = {
            "host": self.credentials.get("host", "localhost"),
            "port": int(self.credentials.get("port", 5432)),
            "database": self.credentials.get("database")
            or self.credentials.get("dbname", "postgres"),
            "user": self.credentials.get("user", "postgres"),
            "password": self.credentials.get("password", ""),
            "connect_timeout": min(
                max(int(self.credentials.get("connect_timeout", 10)), 1), 60
            ),
            "application_name": "dbt-flow-designer",
            "options": connection_options,
        }
        if self.credentials.get("sslmode"):
            sslmode = str(self.credentials["sslmode"])
            allowed_ssl_modes = {
                "disable",
                "allow",
                "prefer",
                "require",
                "verify-ca",
                "verify-full",
            }
            if sslmode not in allowed_ssl_modes:
                raise ValueError(f"Unsupported PostgreSQL SSL mode: {sslmode}")
            connection_params["sslmode"] = sslmode

        self.connection = psycopg2.connect(
            **connection_params,
        )
        self.connection.autocommit = True

    def execute(self, sql: str, limit: int = 1000) -> list[dict[str, Any]]:
        """
        Execute SQL query and return results.

        Args:
            sql: SQL query to execute
            limit: Maximum number of rows to return

        Returns:
            List of dictionaries representing rows
        """
        if not self.connection:
            raise RuntimeError("Not connected to database")

        query = self._validate_query(sql)

        safe_limit = min(max(int(limit), 1), 10_000)
        limited_query = f"SELECT * FROM (\n{query}\n) AS preview_query LIMIT %s"

        with self._read_only_transaction(), self.connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(limited_query, (safe_limit,))
            rows = cursor.fetchall()
            # Convert to regular dicts
            return [dict(row) for row in rows]

    @staticmethod
    def _validate_query(sql: str) -> str:
        query = sql.strip().rstrip(";").strip()
        statements = sqlparse.parse(query)
        if len(statements) != 1 or statements[0].get_type() != "SELECT":
            raise ValueError("Only a single read-only SELECT query can be executed")
        return query

    @contextmanager
    def _read_only_transaction(self):
        """Use one snapshot for each page and always roll it back before closing."""
        if not self.connection:
            raise RuntimeError("Not connected to database")
        self.connection.set_session(
            readonly=True, isolation_level="REPEATABLE READ", autocommit=False
        )
        try:
            yield
        finally:
            self.connection.rollback()
            self.connection.set_session(autocommit=True)

    def get_results_page(
        self, sql: str, page: int = 1, page_size: int = 25,
        sort_column: str | None = None, sort_direction: str = "ASC",
        search: str | None = None,
    ) -> dict[str, Any]:
        query = self._validate_query(sql)
        size = min(max(int(page_size), 1), 250)
        source = f"(\n{query}\n) AS preview_query"
        with self._read_only_transaction(), self.connection.cursor() as cursor:
            # Never interpolate user SQL through psycopg2's parameter formatter.
            cursor.execute(f"SELECT * FROM {source} LIMIT 0")
            columns = [description[0] for description in cursor.description]
            where = ""
            if search and search.strip() and columns:
                literal = cursor.mogrify("%s", (f"%{search.strip()}%",)).decode("utf-8")
                where = " WHERE " + " OR ".join(
                    f"CAST({self._quote_identifier(column)} AS TEXT) ILIKE {literal}"
                    for column in columns
                )
            cursor.execute(f"SELECT COUNT(*) FROM {source}{where}")
            total_rows = cursor.fetchone()[0]
            total_pages = max(1, (total_rows + size - 1) // size)
            selected_page = min(max(int(page), 1), total_pages)
            page_query = f"SELECT * FROM {source}{where}"
            if sort_column and sort_column in columns:
                direction = "DESC" if sort_direction.upper() == "DESC" else "ASC"
                page_query += f" ORDER BY {self._quote_identifier(sort_column)} {direction}"
            offset = (selected_page - 1) * size
            page_query += f" LIMIT {size} OFFSET {offset}"
            cursor.execute(page_query)
            return {
                "columns": columns,
                "data": [dict(zip(columns, row)) for row in cursor.fetchall()],
                "total_rows": total_rows, "page": selected_page,
                "page_size": size, "total_pages": total_pages,
            }

    def get_query_stats(self, sql: str) -> dict[str, Any]:
        query = self._validate_query(sql)
        source = f"(\n{query}\n) AS preview_query"
        numeric_oids = {20, 21, 23, 700, 701, 1700}
        with self._read_only_transaction(), self.connection.cursor() as cursor:
            cursor.execute(f"SELECT * FROM {source} LIMIT 0")
            numeric_columns = [name for name, oid, *_ in cursor.description if oid in numeric_oids]
            if not numeric_columns:
                return {}
            expressions = []
            for name in numeric_columns:
                identifier = self._quote_identifier(name)
                expressions.extend([
                    f"MIN({identifier})", f"MAX({identifier})", f"AVG({identifier})",
                    f"COUNT(*) FILTER (WHERE {identifier} IS NULL)",
                ])
            cursor.execute(f"SELECT {', '.join(expressions)} FROM {source}")
            values = cursor.fetchone()
            stats = {}
            for index, name in enumerate(numeric_columns):
                minimum, maximum, average, nulls = values[index * 4 : index * 4 + 4]
                stats[name] = {
                    "min": minimum, "max": maximum,
                    "avg": round(average, 2) if average is not None else None,
                    "nulls": nulls, "type": "numeric",
                }
            return stats

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    def close(self) -> None:
        """Close the PostgreSQL connection."""
        if self.connection:
            self.connection.close()
            self.connection = None

    def test_connection(self) -> bool:
        """
        Test if connection can be established.

        Returns:
            True if connection successful
        """
        try:
            self.connect()
            with self.connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            return True
        finally:
            self.close()

    def get_tables(self, schema: str = "public") -> list[str]:
        """
        Get list of tables in the database.

        Args:
            schema: Schema name (default: public)

        Returns:
            List of table names
        """
        if not self.connection:
            raise RuntimeError("Not connected to database")

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = %s
                AND table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
                ORDER BY table_name
            """,
                (schema,),
            )
            return [row[0] for row in cursor.fetchall()]

    def get_columns(self, table: str, schema: str = "public") -> list[dict[str, str]]:
        """
        Get columns for a table.

        Args:
            table: Table name
            schema: Schema name

        Returns:
            List of column info dicts with 'name' and 'type'
        """
        if not self.connection:
            raise RuntimeError("Not connected to database")

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
            """,
                (schema, table),
            )
            return [
                {"name": row[0], "type": row[1].upper()} for row in cursor.fetchall()
            ]
