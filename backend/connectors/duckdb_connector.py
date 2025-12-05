"""
DuckDB Database Connector

Connects to DuckDB databases (file or in-memory).
Also used as the result cache.
"""

from typing import Any
import duckdb

from .base import BaseConnector


class DuckDBConnector(BaseConnector):
    """DuckDB database connector."""

    def connect(self) -> None:
        """Establish connection to DuckDB database."""
        path = self.credentials.get("path", ":memory:")
        self.connection = duckdb.connect(path)

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

        # Add LIMIT if not present and query is a SELECT
        sql_stripped = sql.strip()
        sql_lower = sql_stripped.lower()
        if sql_lower.startswith("select") and "limit" not in sql_lower:
            sql_stripped = f"{sql_stripped} LIMIT {limit}"

        result = self.connection.execute(sql_stripped)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        return [dict(zip(columns, row)) for row in rows]

    def close(self) -> None:
        """Close the DuckDB connection."""
        if self.connection:
            self.connection.close()
            self.connection = None

    def test_connection(self) -> bool:
        """Test if connection can be established."""
        try:
            self.connect()
            self.connection.execute("SELECT 1")
            return True
        except Exception:
            return False
        finally:
            self.close()

    def get_tables(self) -> list[str]:
        """Get list of tables in the database."""
        if not self.connection:
            raise RuntimeError("Not connected to database")

        result = self.connection.execute(
            """
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'main'
            ORDER BY table_name
        """
        )
        return [row[0] for row in result.fetchall()]

    def get_columns(self, table: str) -> list[dict[str, str]]:
        """Get columns for a table."""
        if not self.connection:
            raise RuntimeError("Not connected to database")

        result = self.connection.execute(f"DESCRIBE {table}")
        return [{"name": row[0], "type": row[1].upper()} for row in result.fetchall()]
