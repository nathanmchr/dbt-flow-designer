"""
Database Connector Base Class

Defines the interface for all database connectors.
Each connector must implement connect(), execute(), and close().
"""

from abc import ABC, abstractmethod
from typing import Any
import duckdb


class BaseConnector(ABC):
    """Abstract base class for database connectors."""

    def __init__(self, credentials: dict[str, Any]):
        """
        Initialize connector with credentials.

        Args:
            credentials: Database connection parameters
        """
        self.credentials = credentials
        self.connection = None

    @abstractmethod
    def connect(self) -> None:
        """Establish connection to the database."""
        pass

    @abstractmethod
    def execute(self, sql: str, limit: int = 1000) -> list[dict[str, Any]]:
        """
        Execute SQL query and return results.

        Args:
            sql: SQL query to execute
            limit: Maximum number of rows to return

        Returns:
            List of dictionaries representing rows
        """
        pass

    @abstractmethod
    def close(self) -> None:
        """Close the database connection."""
        pass

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class DuckDBStore:
    """
    DuckDB storage for caching query results.
    Stores intermediate and final results for display.
    """

    def __init__(self):
        """Initialize in-memory DuckDB database."""
        self.db = duckdb.connect(":memory:")

    def store_results(self, table_name: str, data: list[dict[str, Any]]) -> None:
        """
        Store query results in a DuckDB table.

        Args:
            table_name: Name of the table to create
            data: List of row dictionaries
        """
        if not data:
            return

        # Create table from data using Python objects
        import pandas as pd

        df = pd.DataFrame(data)
        self.db.execute(f"DROP TABLE IF EXISTS {table_name}")
        self.db.execute(f"CREATE TABLE {table_name} AS SELECT * FROM df")

    def query(self, sql: str) -> list[dict[str, Any]]:
        """
        Query the DuckDB store.

        Args:
            sql: SQL query

        Returns:
            List of row dictionaries
        """
        result = self.db.execute(sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        return [dict(zip(columns, row)) for row in rows]

    def get_table(self, table_name: str, limit: int = 100) -> list[dict[str, Any]]:
        """
        Get all rows from a table.

        Args:
            table_name: Table name
            limit: Maximum rows to return

        Returns:
            List of row dictionaries
        """
        return self.query(f"SELECT * FROM {table_name} LIMIT {limit}")

    def close(self) -> None:
        """Close the DuckDB connection."""
        self.db.close()
