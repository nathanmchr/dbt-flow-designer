"""
Query Executor

Executes and pages native SQL queries against source databases in read-only mode.
Handles the full pipeline execution flow.
"""

from typing import Any
import threading
from connectors import get_connector, DuckDBStore


class QueryExecutor:
    """
    Executes SQL queries from the flow designer.

    Connects to source databases, executes queries,
    and retains only the query and credentials needed for native pagination.
    """

    def __init__(self):
        self.result_store = None
        self._preview: tuple[str, dict[str, Any], str] | None = None
        self._preview_lock = threading.RLock()

    def clear_preview(self) -> None:
        """Invalidate the previous result before attempting a new preview."""
        with self._preview_lock:
            self._preview = None
            if self.result_store:
                self.result_store.clear_results("query_result")

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
        connector = get_connector(adapter_type, credentials)
        if connector.supports_native_preview:
            with self._preview_lock:
                self._preview = None
                with connector:
                    result = connector.get_results_page(sql, page_size=limit)
                self._preview = (adapter_type, dict(credentials), sql)
                return {
                    "columns": result["columns"], "data": result["data"],
                    "row_count": result["total_rows"],
                }

        try:
            # Get appropriate connector
            with connector:
                # Execute query
                results = connector.execute(sql, limit=limit)
                self._preview = None
                if self.result_store is None:
                    self.result_store = DuckDBStore()

                if not results:
                    self.result_store.clear_results("query_result")
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

    def get_results_page(
        self,
        page: int = 1,
        page_size: int = 25,
        sort_column: str | None = None,
        sort_direction: str = "ASC",
        search: str | None = None,
    ) -> dict[str, Any]:
        """
        Get a page of results from the last native preview query.

        Args:
            page: Page number (1-indexed)
            page_size: Rows per page
            sort_column: Column to sort by
            sort_direction: ASC or DESC
            search: Search term to filter results

        Returns:
            Paginated results dict
        """
        with self._preview_lock:
            preview = self._preview
        if preview:
            adapter_type, credentials, sql = preview
            with get_connector(adapter_type, credentials) as connector:
                return connector.get_results_page(
                    sql, page=page, page_size=page_size, sort_column=sort_column,
                    sort_direction=sort_direction, search=search,
                )
        if self.result_store is None or not self.result_store.table_exists("query_result"):
            return {
                "columns": [],
                "data": [],
                "total_rows": 0,
                "page": 1,
                "page_size": page_size,
                "total_pages": 1,
            }

        return self.result_store.get_table_page(
            "query_result",
            page=page,
            page_size=page_size,
            sort_column=sort_column,
            sort_direction=sort_direction,
            search=search,
        )

    def get_column_stats(self) -> dict[str, Any]:
        with self._preview_lock:
            preview = self._preview
        if preview:
            adapter_type, credentials, sql = preview
            with get_connector(adapter_type, credentials) as connector:
                return connector.get_query_stats(sql)
        return self.result_store.get_column_stats("query_result") if self.result_store else {}

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
        schema: str | None = None,
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
                return connector.get_tables(
                    schema or credentials.get("schema") or connector.default_schema
                )
            return []

    def get_columns(
        self,
        adapter_type: str,
        credentials: dict[str, Any],
        table: str,
        schema: str | None = None,
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
                return connector.get_columns(
                    table, schema or credentials.get("schema") or connector.default_schema
                )
            return []

    def close(self) -> None:
        """Close the result store."""
        self._preview = None
        if self.result_store:
            self.result_store.close()
