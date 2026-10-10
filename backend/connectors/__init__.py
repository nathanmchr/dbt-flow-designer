"""
Database Connectors Package

Provides connectors for various database types.
"""

from typing import Callable

from .base import BaseConnector, DuckDBStore
from .postgres import PostgresConnector


def _create_duckdb_connector(credentials: dict) -> BaseConnector:
    # Keep PostgreSQL-only execution independent of the optional engine import.
    from .duckdb_connector import DuckDBConnector

    return DuckDBConnector(credentials)

# Connector registry - factories can load their engine dependencies lazily.
CONNECTORS: dict[str, Callable[[dict], BaseConnector]] = {
    "postgres": PostgresConnector,
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
    connector_factory = CONNECTORS.get(adapter_type)
    if not connector_factory:
        supported = ", ".join(CONNECTORS.keys())
        raise ValueError(
            f"Unsupported adapter type: {adapter_type}. " f"Supported: {supported}"
        )
    return connector_factory(credentials)


__all__ = [
    "BaseConnector",
    "DuckDBStore",
    "PostgresConnector",
    "get_connector",
    "CONNECTORS",
]
