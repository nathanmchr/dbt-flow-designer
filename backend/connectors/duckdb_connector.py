"""Native, read-only previews of existing local DuckDB databases."""

from contextlib import contextmanager
from pathlib import Path
import re
import threading
from typing import Any

import duckdb
import sqlparse

from .base import BaseConnector


class DuckDBConnector(BaseConnector):
    supports_native_preview = True
    default_schema = "main"
    # Shared with dbt compilation: no external files or automatic extension loading.
    PREVIEW_CONFIG = {
        "access_mode": "READ_ONLY",
        "enable_external_access": "false",
        "autoinstall_known_extensions": "false",
        "autoload_known_extensions": "false",
        "threads": "1",
        "memory_limit": "256MB",
    }

    @staticmethod
    def source_path(credentials: dict[str, Any]) -> Path:
        value = credentials.get("path")
        if not isinstance(value, str) or not value.strip() or value.strip() == ":memory:":
            raise ValueError("DuckDB requires the path to an existing local database file")
        path = Path(value.strip()).expanduser().resolve()
        if not path.is_file():
            raise ValueError("DuckDB database file does not exist on the backend host")
        return path

    def connect(self) -> None:
        self.connection = duckdb.connect(
            str(self.source_path(self.credentials)), config=self.PREVIEW_CONFIG
        )

    @staticmethod
    def _validate_query(sql: str) -> str:
        query = sql.strip().rstrip(";").strip()
        statements = sqlparse.parse(query)
        if len(statements) != 1 or statements[0].get_type() != "SELECT":
            raise ValueError("Only a single read-only SELECT query can be executed")
        return query

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @contextmanager
    def _snapshot(self):
        if self.connection is None:
            raise RuntimeError("Not connected to database")
        self.connection.execute("BEGIN TRANSACTION")
        timer = threading.Timer(30, self.connection.interrupt)
        timer.daemon = True
        timer.start()
        try:
            yield
        finally:
            timer.cancel()
            self.connection.execute("ROLLBACK")

    def execute(self, sql: str, limit: int = 1000) -> list[dict[str, Any]]:
        query = self._validate_query(sql)
        size = min(max(int(limit), 1), 10_000)
        with self._snapshot():
            result = self.connection.execute(
                f"SELECT * FROM (\n{query}\n) AS preview_query LIMIT ?", [size]
            )
            columns = [description[0] for description in result.description]
            return [dict(zip(columns, row)) for row in result.fetchall()]

    def get_results_page(
        self, sql: str, page: int = 1, page_size: int = 25,
        sort_column: str | None = None, sort_direction: str = "ASC",
        search: str | None = None,
    ) -> dict[str, Any]:
        query = self._validate_query(sql)
        size = min(max(int(page_size), 1), 250)
        source = f"(\n{query}\n) AS preview_query"
        with self._snapshot():
            metadata = self.connection.execute(f"SELECT * FROM {source} LIMIT 0")
            columns = [description[0] for description in metadata.description]
            where = ""
            parameters = []
            if search and search.strip() and columns:
                where = " WHERE (" + " OR ".join(
                    f"CAST({self._quote_identifier(column)} AS VARCHAR) ILIKE ?"
                    for column in columns
                ) + ")"
                parameters = [f"%{search.strip()}%"] * len(columns)
            total_rows = self.connection.execute(
                f"SELECT COUNT(*) FROM {source}{where}", parameters
            ).fetchone()[0]
            total_pages = max(1, (total_rows + size - 1) // size)
            selected_page = min(max(int(page), 1), total_pages)
            page_query = f"SELECT * FROM {source}{where}"
            if sort_column and sort_column in columns:
                direction = "DESC" if sort_direction.upper() == "DESC" else "ASC"
                page_query += f" ORDER BY {self._quote_identifier(sort_column)} {direction}"
            result = self.connection.execute(
                page_query + " LIMIT ? OFFSET ?",
                [*parameters, size, (selected_page - 1) * size],
            )
            return {
                "columns": columns,
                "data": [dict(zip(columns, row)) for row in result.fetchall()],
                "total_rows": total_rows, "page": selected_page,
                "page_size": size, "total_pages": total_pages,
            }

    def get_query_stats(self, sql: str) -> dict[str, Any]:
        query = self._validate_query(sql)
        source = f"(\n{query}\n) AS preview_query"
        with self._snapshot():
            metadata = self.connection.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()
            numeric_columns = [
                row[0] for row in metadata
                if re.match(r"^(U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)\b", row[1])
            ]
            if not numeric_columns:
                return {}
            expressions = []
            for name in numeric_columns:
                column = self._quote_identifier(name)
                expressions.extend([
                    f"MIN({column})", f"MAX({column})", f"AVG({column})",
                    f"COUNT(*) FILTER (WHERE {column} IS NULL)",
                ])
            values = self.connection.execute(
                f"SELECT {', '.join(expressions)} FROM {source}"
            ).fetchone()
            stats = {}
            for index, name in enumerate(numeric_columns):
                minimum, maximum, average, nulls = values[index * 4 : index * 4 + 4]
                stats[name] = {
                    "min": minimum, "max": maximum,
                    "avg": round(average, 2) if average is not None else None,
                    "nulls": nulls, "type": "numeric",
                }
            return stats

    def get_tables(self, schema: str = "main") -> list[str]:
        if self.connection is None:
            raise RuntimeError("Not connected to database")
        rows = self.connection.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_catalog = current_database() AND table_schema = ? "
            "AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name", [schema]
        ).fetchall()
        return [row[0] for row in rows]

    def get_columns(self, table: str, schema: str = "main") -> list[dict[str, str]]:
        if self.connection is None:
            raise RuntimeError("Not connected to database")
        rows = self.connection.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_catalog = current_database() AND table_schema = ? "
            "AND table_name = ? ORDER BY ordinal_position", [schema, table]
        ).fetchall()
        return [{"name": row[0], "type": row[1].upper()} for row in rows]

    def test_connection(self) -> bool:
        try:
            self.connect()
            self.connection.execute("SELECT 1")
            return True
        finally:
            self.close()

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None
