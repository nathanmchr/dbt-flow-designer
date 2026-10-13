"""Native SQL Server previews, using SQL authentication and a SELECT-only login."""

from contextlib import contextmanager
from decimal import Decimal
from typing import Any

from sqlglot import exp, parse
from sqlglot.errors import ParseError

from .base import BaseConnector


def credential_bool(value: Any, default: bool) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if str(value).lower() in {"true", "yes", "1"}:
        return True
    if str(value).lower() in {"false", "no", "0"}:
        return False
    raise ValueError("SQL Server boolean options must be true or false")


class SQLServerConnector(BaseConnector):
    supports_native_preview = True
    default_schema = "dbo"
    DEFAULT_DRIVER = "ODBC Driver 18 for SQL Server"
    # ApplicationIntent is a routing hint, NOT a read-only security boundary.
    # Reject elevated accounts before compilation as well as native previews.
    PERMISSIONS_SQL = """
        SELECT permission_name FROM sys.fn_my_permissions(NULL, 'SERVER')
        UNION ALL
        SELECT permission_name FROM sys.fn_my_permissions(NULL, 'DATABASE')
        UNION ALL
        SELECT p.permission_name FROM sys.schemas s
        CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name), 'SCHEMA') p
        UNION ALL
        SELECT p.permission_name FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        CROSS APPLY sys.fn_my_permissions(
            QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT') p
        WHERE o.is_ms_shipped = 0 AND o.type IN ('U', 'V', 'P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT', 'AF', 'SO', 'SN')
    """
    UNSAFE_PERMISSION_PREFIXES = (
        "ALTER", "CONTROL", "CREATE", "DELETE", "EXECUTE", "IMPERSONATE",
        "INSERT", "UPDATE", "TAKE OWNERSHIP", "ADMINISTER", "BACKUP",
    )

    @staticmethod
    def _odbc_value(value: Any) -> str:
        # Brace every value, including passwords with semicolons and closing braces.
        text = str(value)
        if "\x00" in text:
            raise ValueError("Invalid SQL Server connection value")
        return "{" + text.replace("}", "}}") + "}"

    def connection_options(self) -> dict[str, Any]:
        missing = [name for name in ("host", "database", "user", "password")
                   if not self.credentials.get(name)]
        if missing:
            raise ValueError(f"Missing SQL Server credential(s): {', '.join(missing)}")
        port = int(1433 if self.credentials.get("port") is None else self.credentials["port"])
        if not 1 <= port <= 65535:
            raise ValueError("Invalid SQL Server port")
        host = str(self.credentials["host"])
        if any(character in host for character in (";", ",", "\x00")):
            raise ValueError("SQL Server host must not include connection options or a port")
        driver = str(self.credentials.get("driver") or self.DEFAULT_DRIVER)
        if driver not in {self.DEFAULT_DRIVER, "ODBC Driver 17 for SQL Server"}:
            raise ValueError("Use Microsoft ODBC Driver 17 or 18 for SQL Server")
        if any(character in str(self.credentials["database"]) for character in (";", "\x00")):
            raise ValueError("SQL Server database must not include connection options")
        return {
            "driver": driver, "port": port,
            "encrypt": credential_bool(self.credentials.get("encrypt"), True),
            "trust_cert": credential_bool(self.credentials.get("trust_cert"), False),
        }

    def connect(self) -> None:
        options = self.connection_options()
        try:
            import pyodbc
        except ImportError as error:
            raise RuntimeError("SQL Server requires pyodbc and Microsoft ODBC Driver 18 on the backend host") from error
        if options["driver"] not in pyodbc.drivers():
            raise RuntimeError(f"Install {options['driver']} on the backend host")
        values = {
            "DRIVER": options["driver"],
            "SERVER": f"tcp:{self.credentials['host']},{options['port']}",
            "DATABASE": self.credentials["database"],
            "UID": self.credentials["user"], "PWD": self.credentials["password"],
            "Encrypt": "yes" if options["encrypt"] else "no",
            "TrustServerCertificate": "yes" if options["trust_cert"] else "no",
            "APP": "dbt-flow-designer", "ApplicationIntent": "ReadOnly",
        }
        connection_string = ";".join(f"{key}={self._odbc_value(value)}" for key, value in values.items())
        try:
            self.connection = pyodbc.connect(connection_string, timeout=10, autocommit=False)
            self.connection.timeout = 30
            with self._cursor() as cursor:
                cursor.execute("SET QUOTED_IDENTIFIER ON; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET LOCK_TIMEOUT 10000")
                cursor.execute(self.PERMISSIONS_SQL)
                unsafe = {str(row[0]).upper() for row in cursor.fetchall()
                          if str(row[0]).upper().startswith(self.UNSAFE_PERMISSION_PREFIXES)}
                if unsafe:
                    raise ValueError("SQL Server previews require a SELECT-only account, without write, DDL or EXECUTE permissions")
            self.connection.rollback()
        except Exception as error:
            self.close()
            message = str(error).replace(str(self.credentials["password"]), "[REDACTED]")
            raise RuntimeError(message) from None

    @contextmanager
    def _cursor(self):
        if self.connection is None:
            raise RuntimeError("Not connected to database")
        cursor = self.connection.cursor()
        try:
            yield cursor
        finally:
            cursor.close()

    @contextmanager
    def _transaction(self):
        try:
            with self._cursor() as cursor:
                yield cursor
        finally:
            if self.connection is not None:
                self.connection.rollback()

    def _validate_query(self, sql: str) -> exp.Query:
        try:
            statements = [statement for statement in parse(sql, read="tsql") if statement is not None]
        except ParseError as error:
            raise ValueError("Invalid SQL Server SELECT query") from error
        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)):
            raise ValueError("Only a single read-only SELECT query can be executed")
        query = statements[0]
        forbidden = {"into", "insert", "update", "delete", "merge", "create", "drop", "alter",
                     "command", "execute", "grant", "revoke", "nextvaluefor", "lock", "transaction"}
        for expression in query.walk():
            if expression.key in forbidden:
                raise ValueError("Only a single read-only SELECT query can be executed")
            if isinstance(expression, exp.Table):
                if not isinstance(expression.this, exp.Identifier):
                    raise ValueError("External and table-valued functions are not supported in previews")
                if expression.catalog and expression.catalog.casefold() != str(self.credentials["database"]).casefold():
                    raise ValueError("SQL Server previews cannot access another database or linked server")
                if isinstance(expression.args.get("catalog"), exp.Dot):
                    raise ValueError("Linked servers are not supported in previews")
        return query

    def _preview_source(self, sql: str) -> tuple[str, str, str]:
        """Hoist dbt's CTEs: SQL Server forbids a WITH nested in a derived table."""
        query = self._validate_query(sql).copy()
        # SQLGlot's T-SQL AST attaches an unparenthesized UNION's final ORDER BY
        # to the right SELECT, although SQL Server applies it to the whole set.
        for operation in query.find_all(exp.SetOperation):
            right = operation.expression
            if isinstance(right, exp.Select) and right.args.get("order"):
                for key in ("order", "offset", "limit"):
                    if right.args.get(key) is not None:
                        operation.set(key, right.args[key])
                        right.set(key, None)
        with_clause = query.args.get("with")
        used_names = {cte.alias_or_name.casefold() for cte in query.find_all(exp.CTE)}
        name = "__dbt_flow_preview"
        while name.casefold() in used_names:
            name += "_"
        # The outer query becomes a CTE. Do not silently repair invalid inner
        # models: that would make preview succeed while the unchanged export fails.
        for selection in query.find_all(exp.Query):
            if selection.args.get("order") and not selection.args.get("limit") and not selection.args.get("offset"):
                if selection is not query:
                    raise ValueError("ORDER BY inside SQL Server models requires TOP or OFFSET; add OFFSET 0 ROWS")
                selection.set("offset", exp.Offset(expression=exp.Literal.number(0)))
        order = query.args.get("order")
        if order:
            # Its table aliases are not in scope outside the preview CTE.
            order = order.copy()
            for column in order.find_all(exp.Column):
                column.set("table", None)
                column.set("db", None)
                column.set("catalog", None)
        outer_order = order.sql(dialect="tsql") if order else ""
        query.set("with", None)
        prefix = with_clause.sql(dialect="tsql") + ", " if with_clause else "WITH "
        prefix += f"{self._quote_identifier(name)} AS (\n{query.sql(dialect='tsql')}\n)\n"
        return prefix, self._quote_identifier(name), outer_order

    def get_results_page(self, sql: str, page: int = 1, page_size: int = 25,
                         sort_column: str | None = None, sort_direction: str = "ASC",
                         search: str | None = None) -> dict[str, Any]:
        prefix, source, original_order = self._preview_source(sql)
        size = min(max(int(page_size), 1), 250)
        with self._transaction() as cursor:
            cursor.execute(f"{prefix}SELECT TOP (0) * FROM {source}")
            columns = [column[0] for column in cursor.description]
            if len(set(columns)) != len(columns):
                raise ValueError("Preview columns must have unique names; use aliases")
            parameters = []
            where = ""
            if search and search.strip():
                # Escape LIKE wildcards so search stays a literal, including '[' in T-SQL.
                term = search.strip().replace("~", "~~").replace("%", "~%").replace("_", "~_").replace("[", "~[")
                where = " WHERE " + " OR ".join(
                    f"LOWER(TRY_CONVERT(NVARCHAR(MAX), {self._quote_identifier(column)})) LIKE LOWER(?) ESCAPE '~'"
                    for column in columns
                )
                parameters = [f"%{term}%"] * len(columns)
            cursor.execute(f"{prefix}SELECT COUNT_BIG(*) FROM {source}{where}", *parameters)
            total = int(cursor.fetchone()[0])
            total_pages = max(1, (total + size - 1) // size)
            selected_page = min(max(int(page), 1), total_pages)
            if sort_column and sort_column in columns:
                direction = "DESC" if sort_direction.upper() == "DESC" else "ASC"
                order = f"ORDER BY {self._quote_identifier(sort_column)} {direction}"
            else:
                order = original_order or "ORDER BY (SELECT NULL)"
            offset = (selected_page - 1) * size
            cursor.execute(f"{prefix}SELECT * FROM {source}{where} {order} OFFSET {offset} ROWS FETCH NEXT {size} ROWS ONLY", *parameters)
            return {"columns": columns, "data": [dict(zip(columns, row)) for row in cursor.fetchall()],
                    "total_rows": total, "page": selected_page, "page_size": size, "total_pages": total_pages}

    def execute(self, sql: str, limit: int = 1000) -> list[dict[str, Any]]:
        prefix, source, order = self._preview_source(sql)
        limit = min(max(int(limit), 1), 10000)
        with self._transaction() as cursor:
            cursor.execute(f"{prefix}SELECT TOP ({limit}) * FROM {source} {order}")
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def get_query_stats(self, sql: str) -> dict[str, Any]:
        prefix, source, _ = self._preview_source(sql)
        with self._transaction() as cursor:
            cursor.execute(f"{prefix}SELECT TOP (0) * FROM {source}")
            numeric = [column[0] for column in cursor.description if column[1] in {int, float, Decimal}]
            if not numeric:
                return {}
            expressions = []
            for name in numeric:
                identifier = self._quote_identifier(name)
                expressions.extend([f"MIN({identifier})", f"MAX({identifier})", f"AVG(CAST({identifier} AS FLOAT))",
                                    f"COUNT_BIG(*) - COUNT_BIG({identifier})"])
            cursor.execute(f"{prefix}SELECT {', '.join(expressions)} FROM {source}")
            values = cursor.fetchone()
            stats = {}
            for index, name in enumerate(numeric):
                minimum, maximum, average, nulls = values[index * 4:index * 4 + 4]
                stats[name] = {"min": minimum, "max": maximum, "avg": round(average, 2) if average is not None else None,
                               "nulls": nulls, "type": "numeric"}
            return stats

    def get_tables(self, schema: str = "dbo") -> list[str]:
        with self._transaction() as cursor:
            cursor.execute("""SELECT o.name FROM sys.objects o
                JOIN sys.schemas s ON o.schema_id = s.schema_id
                WHERE s.name = ? AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
                AND HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1
                ORDER BY o.name""", schema)
            return [row[0] for row in cursor.fetchall()]

    def get_columns(self, table: str, schema: str = "dbo") -> list[dict[str, str]]:
        with self._transaction() as cursor:
            cursor.execute("""SELECT c.COLUMN_NAME, c.DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? ORDER BY c.ORDINAL_POSITION""", schema, table)
            return [{"name": row[0], "type": row[1].upper()} for row in cursor.fetchall()]

    def test_connection(self) -> bool:
        try:
            self.connect()
            with self._transaction() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone()[0] == 1
        finally:
            self.close()

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return "[" + identifier.replace("]", "]]") + "]"

    def close(self) -> None:
        if self.connection is not None:
            try:
                self.connection.rollback()
            finally:
                self.connection.close()
                self.connection = None
