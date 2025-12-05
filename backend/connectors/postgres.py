"""
PostgreSQL Database Connector

Connects to PostgreSQL databases using psycopg2.
"""

from typing import Any
import psycopg2
from psycopg2.extras import RealDictCursor

from .base import BaseConnector


class PostgresConnector(BaseConnector):
    """PostgreSQL database connector using psycopg2."""

    def connect(self) -> None:
        """Establish connection to PostgreSQL database."""
        self.connection = psycopg2.connect(
            host=self.credentials.get("host", "localhost"),
            port=self.credentials.get("port", 5432),
            database=self.credentials.get("database", "postgres"),
            user=self.credentials.get("user", "postgres"),
            password=self.credentials.get("password", ""),
            # Connection timeout
            connect_timeout=10,
        )
        # Set autocommit for read queries
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

        # Add LIMIT if not present (safety measure)
        sql_lower = sql.lower().strip()
        if "limit" not in sql_lower:
            sql = f"SELECT * FROM ({sql}) AS subq LIMIT {limit}"

        with self.connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql)
            rows = cursor.fetchall()
            # Convert to regular dicts
            return [dict(row) for row in rows]

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
        except Exception:
            return False
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
                AND table_type = 'BASE TABLE'
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
