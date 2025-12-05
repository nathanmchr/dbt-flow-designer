"""
Query Executor

Executes SQL queries against source databases and stores results in DuckDB.
Handles the full pipeline execution flow.
"""

from typing import Any
from connectors import get_connector, DuckDBStore


class QueryExecutor:
    """
    Executes SQL queries from the flow designer.

    Connects to source databases, executes queries,
    and stores results in DuckDB for display.
    """

    def __init__(self):
        """Initialize the executor with a DuckDB result store."""
        self.result_store = DuckDBStore()

    def execute_query(
        self,
        adapter_type: str,
        credentials: dict[str, Any],
        sql: str,
        limit: int = 100,
    ) -> dict[str, Any]:
        """
        Execute a SQL query against a source database.

        Args:
            adapter_type: Type of database (postgres, snowflake, etc.)
            credentials: Database connection credentials
            sql: SQL query to execute
            limit: Maximum rows to return

        Returns:
            Dict with 'columns', 'data', and 'row_count'
        """
        try:
            # Get appropriate connector
            connector = get_connector(adapter_type, credentials)

            with connector:
                # Execute query
                results = connector.execute(sql, limit=limit)

                if not results:
                    return {
                        "columns": [],
                        "data": [],
                        "row_count": 0,
                    }

                # Extract column names
                columns = list(results[0].keys()) if results else []

                # Store in DuckDB cache
                self.result_store.store_results("query_result", results)

                return {
                    "columns": columns,
                    "data": results,
                    "row_count": len(results),
                }

        except Exception as e:
            raise RuntimeError(f"Query execution failed: {str(e)}") from e

    def test_connection(
        self,
        adapter_type: str,
        credentials: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Test database connection.

        Args:
            adapter_type: Type of database
            credentials: Connection credentials

        Returns:
            Dict with 'success' and optional 'error'
        """
        try:
            connector = get_connector(adapter_type, credentials)
            success = connector.test_connection()
            return {"success": success}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_tables(
        self,
        adapter_type: str,
        credentials: dict[str, Any],
        schema: str = "public",
    ) -> list[str]:
        """
        Get list of tables from the database.

        Args:
            adapter_type: Type of database
            credentials: Connection credentials
            schema: Schema name (for databases that support it)

        Returns:
            List of table names
        """
        connector = get_connector(adapter_type, credentials)
        with connector:
            if hasattr(connector, "get_tables"):
                if adapter_type == "postgres":
                    return connector.get_tables(schema)
                return connector.get_tables()
            return []

    def get_columns(
        self,
        adapter_type: str,
        credentials: dict[str, Any],
        table: str,
        schema: str = "public",
    ) -> list[dict[str, str]]:
        """
        Get columns for a table.

        Args:
            adapter_type: Type of database
            credentials: Connection credentials
            table: Table name
            schema: Schema name

        Returns:
            List of column info dicts
        """
        connector = get_connector(adapter_type, credentials)
        with connector:
            if hasattr(connector, "get_columns"):
                if adapter_type == "postgres":
                    return connector.get_columns(table, schema)
                return connector.get_columns(table)
            return []

    def close(self) -> None:
        """Close the result store."""
        self.result_store.close()
