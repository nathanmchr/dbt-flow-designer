"""
Database Connectors Package

Provides connectors for various database types.
"""

from .base import BaseConnector, DuckDBStore
from .postgres import PostgresConnector
from .duckdb_connector import DuckDBConnector

# Connector registry - maps adapter types to connector classes
CONNECTORS: dict[str, type[BaseConnector]] = {
    "postgres": PostgresConnector,
    "duckdb": DuckDBConnector,
    # Add more as needed:
    # "snowflake": SnowflakeConnector,
    # "bigquery": BigQueryConnector,
}


def get_connector(adapter_type: str, credentials: dict) -> BaseConnector:
    """
    Get the appropriate connector for a database type.

    Args:
        adapter_type: Type of database (postgres, snowflake, etc.)
        credentials: Connection credentials

    Returns:
        Configured connector instance

    Raises:
        ValueError: If adapter type is not supported
    """
    connector_class = CONNECTORS.get(adapter_type)
    if not connector_class:
        supported = ", ".join(CONNECTORS.keys())
        raise ValueError(
            f"Unsupported adapter type: {adapter_type}. " f"Supported: {supported}"
        )
    return connector_class(credentials)


__all__ = [
    "BaseConnector",
    "DuckDBStore",
    "PostgresConnector",
    "DuckDBConnector",
    "get_connector",
    "CONNECTORS",
]
