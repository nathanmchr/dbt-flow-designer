"""
Database Connector Base Class

Defines the interface for all database connectors.
Each connector must implement connect(), execute(), and close().
"""

from abc import ABC, abstractmethod
from typing import Any


class BaseConnector(ABC):
    """Abstract base class for database connectors."""

    supports_native_preview = False
    default_schema = "public"

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
        import duckdb

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
        table = self._quote_identifier(table_name)
        self.db.execute(f"DROP TABLE IF EXISTS {table}")
        self.db.execute(f"CREATE TABLE {table} AS SELECT * FROM df")

    def clear_results(self, table_name: str) -> None:
        """Remove a cached result table without accepting raw SQL identifiers."""
        table = self._quote_identifier(table_name)
        self.db.execute(f"DROP TABLE IF EXISTS {table}")

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
        table = self._quote_identifier(table_name)
        safe_limit = min(max(int(limit), 1), 10_000)
        result = self.db.execute(f"SELECT * FROM {table} LIMIT ?", [safe_limit])
        columns = [description[0] for description in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]

    def get_table_page(
        self,
        table_name: str,
        page: int = 1,
        page_size: int = 50,
        sort_column: str | None = None,
        sort_direction: str = "ASC",
        search: str | None = None,
    ) -> dict[str, Any]:
        """
        Get a paginated slice of results from a table.

        Args:
            table_name: Table name
            page: Page number (1-indexed)
            page_size: Number of rows per page
            sort_column: Column to sort by (optional)
            sort_direction: ASC or DESC
            search: Search term to filter across all columns (optional)

        Returns:
            Dict with 'data', 'columns', 'total_rows', 'page', 'page_size', 'total_pages'
        """
        # Get column names first
        table = self._quote_identifier(table_name)
        columns_result = self.db.execute(f"SELECT * FROM {table} LIMIT 0")
        columns = [desc[0] for desc in columns_result.description]

        # Build WHERE clause for search
        where_clause = ""
        parameters: list[Any] = []
        if search and search.strip():
            conditions = [
                f"CAST({self._quote_identifier(col)} AS TEXT) ILIKE ?"
                for col in columns
            ]
            where_clause = f" WHERE ({' OR '.join(conditions)})"
            parameters = [f"%{search.strip()}%"] * len(columns)

        # Get total count (with search filter)
        count_sql = f"SELECT COUNT(*) FROM {table}{where_clause}"
        count_result = self.db.execute(count_sql, parameters)
        total_rows = count_result.fetchone()[0]

        # Build query with pagination
        safe_page_size = min(max(int(page_size), 1), 250)
        total_pages = max(1, (total_rows + safe_page_size - 1) // safe_page_size)
        safe_page = min(max(int(page), 1), total_pages)
        offset = (safe_page - 1) * safe_page_size
        sql = f"SELECT * FROM {table}{where_clause}"

        if sort_column and sort_column in columns:
            direction = "DESC" if sort_direction.upper() == "DESC" else "ASC"
            sql += f" ORDER BY {self._quote_identifier(sort_column)} {direction}"

        sql += " LIMIT ? OFFSET ?"

        # Execute
        result = self.db.execute(sql, [*parameters, safe_page_size, offset])
        rows = result.fetchall()
        data = [dict(zip(columns, row)) for row in rows]

        return {
            "columns": columns,
            "data": data,
            "total_rows": total_rows,
            "page": safe_page,
            "page_size": safe_page_size,
            "total_pages": total_pages,
        }

    def table_exists(self, table_name: str) -> bool:
        """Check if a table exists in the store."""
        try:
            table = self._quote_identifier(table_name)
            self.db.execute(f"SELECT 1 FROM {table} LIMIT 1")
            return True
        except Exception:
            return False

    def get_column_stats(self, table_name: str) -> dict[str, Any]:
        """
        Get statistics for numeric columns in a table.

        Returns dict with column names as keys and stats (min, max, avg, nulls) as values.
        """
        if not self.table_exists(table_name):
            return {}

        # Get column info
        table = self._quote_identifier(table_name)
        result = self.db.execute(f"DESCRIBE {table}")
        columns_info = result.fetchall()

        stats = {}
        numeric_types = (
            "INTEGER",
            "BIGINT",
            "DOUBLE",
            "FLOAT",
            "DECIMAL",
            "NUMERIC",
            "REAL",
            "SMALLINT",
            "TINYINT",
        )

        for col_info in columns_info:
            col_name = col_info[0]
            col_type = col_info[1].upper()

            # Check if numeric type
            is_numeric = any(t in col_type for t in numeric_types)

            if is_numeric:
                try:
                    column = self._quote_identifier(col_name)
                    stat_result = self.db.execute(
                        f"""
                        SELECT
                            MIN({column}) as min_val,
                            MAX({column}) as max_val,
                            AVG({column}) as avg_val,
                            SUM(CASE WHEN {column} IS NULL THEN 1 ELSE 0 END) as null_count
                        FROM {table}
                    """
                    )
                    row = stat_result.fetchone()
                    stats[col_name] = {
                        "min": row[0],
                        "max": row[1],
                        "avg": round(row[2], 2) if row[2] is not None else None,
                        "nulls": row[3],
                        "type": "numeric",
                    }
                except Exception:
                    pass

        return stats

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        escaped = identifier.replace('"', '""')
        return f'"{escaped}"'

    def close(self) -> None:
        """Close the DuckDB connection."""
        self.db.close()
