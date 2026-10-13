"""Opt-in live verification on the dedicated fixture; no server is provisioned."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from uuid import uuid4

import yaml

from connectors.sqlserver import SQLServerConnector, credential_bool
from dbt_executor import DbtExecutor
from executor import QueryExecutor


def credentials():
    return {
        "host": os.environ["DBT_FLOW_SQLSERVER_HOST"],
        "port": int(os.environ.get("DBT_FLOW_SQLSERVER_PORT", "1433")),
        "database": os.environ["DBT_FLOW_SQLSERVER_DATABASE"],
        "schema": "dbo", "user": os.environ["DBT_FLOW_SQLSERVER_USER"],
        "password": os.environ["DBT_FLOW_SQLSERVER_PASSWORD"],
        "driver": os.environ.get("DBT_FLOW_SQLSERVER_DRIVER", SQLServerConnector.DEFAULT_DRIVER),
        "encrypt": credential_bool(os.environ.get("DBT_FLOW_SQLSERVER_ENCRYPT"), True),
        "trust_cert": credential_bool(os.environ.get("DBT_FLOW_SQLSERVER_TRUST_CERT"), False),
    }


@unittest.skipUnless(os.environ.get("RUN_LIVE_SQLSERVER_TEST") == "1",
                     "set RUN_LIVE_SQLSERVER_TEST=1 and SQL Server fixture credentials")
class LiveSQLServerTests(unittest.TestCase):
    def files(self, flag=None):
        root = Path(__file__).resolve().parents[2]
        command = ["node", "--experimental-strip-types", "frontend/tests/generateLivePostgresFixture.ts", "--sqlserver"]
        if flag:
            command.append(flag)
        return json.loads(subprocess.run(command, cwd=root, capture_output=True, text=True, check=True).stdout)

    def snapshot(self, connector):
        return (connector.get_tables(), connector.execute("SELECT * FROM dbo.users ORDER BY id"),
                connector.execute("SELECT * FROM dbo.orders ORDER BY order_id"))

    @unittest.skipUnless(os.environ.get("RUN_SQLSERVER_EXPORT_BUILD") == "1",
                         "enable export builds with the separate local builder login")
    def test_rich_models_preview_and_unchanged_export_against_independent_sql(self):
        """Compare full multisets, including NULLs/duplicates, on the real engine."""
        import pyodbc
        from dbt.adapters.sqlserver.sqlserver_credentials import SQLServerCredentials
        from dbt.adapters.sqlserver.sqlserver_backend import build_pyodbc_connection_string

        root = Path(__file__).resolve().parents[2]
        generated = subprocess.run(["node", "--experimental-strip-types", "frontend/tests/generateSQLServerModels.ts"],
                                   cwd=root, capture_output=True, text=True, check=True)
        cases = json.loads(generated.stdout)
        references = {
            "projection": "SELECT order_id AS id, amount AS total FROM qa.orders",
            "nested_filter": "SELECT * FROM qa.customers WHERE active=1 AND (customer_name=N'L''été 東京' OR customer_id>=90)",
            "left_join": "SELECT o.*, c.customer_id AS customer_key, c.customer_name, c.country FROM qa.orders o LEFT JOIN qa.customers c ON o.customer_id=c.customer_id",
            "aggregate": "SELECT customer_id, SUM(amount) AS total, COUNT(*) AS orders, COUNT(amount) AS non_null, AVG(CAST(order_id AS FLOAT)) AS avg_order, COUNT(DISTINCT status) AS statuses FROM qa.orders GROUP BY customer_id",
            "multi_join_aggregate": "SELECT p.category, SUM(i.quantity*p.price) AS revenue, SUM(i.quantity) AS units, COUNT(*) AS lines FROM qa.order_items i JOIN qa.orders o ON i.order_id=o.order_id JOIN qa.products p ON i.product_id=p.product_id WHERE o.status=N'paid' GROUP BY p.category HAVING SUM(i.quantity*p.price)>30000",
            "window": "SELECT * FROM (SELECT order_id, customer_id, amount, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC, order_id DESC) AS position FROM qa.orders WHERE amount IS NOT NULL) ranked WHERE position<=2",
            "union_duplicates": "SELECT country FROM qa.customers UNION ALL SELECT country FROM qa.customers",
            "empty": "SELECT * FROM qa.orders WHERE order_id<0",
        }
        self.assertEqual({case["name"] for case in cases}, set(references))
        reader = {**credentials(), "schema": "qa"}
        writer = {**reader, "user": os.environ["DBT_FLOW_SQLSERVER_BUILD_USER"],
                  "password": os.environ["DBT_FLOW_SQLSERVER_BUILD_PASSWORD"]}
        schema = "dbt_flow_validation_" + uuid4().hex
        connection_string = build_pyodbc_connection_string(SQLServerCredentials.from_dict({
            "host": writer["host"], "port": writer["port"], "database": writer["database"],
            "schema": schema, "UID": writer["user"], "PWD": writer["password"],
            "driver": writer["driver"], "encrypt": writer["encrypt"], "trust_cert": writer["trust_cert"]}))
        connection = pyodbc.connect(connection_string, timeout=10, autocommit=True)
        connection.timeout = 30
        quote = SQLServerConnector._quote_identifier

        def raw_query(sql):
            cursor = connection.cursor()
            try:
                cursor.execute(sql)
                names = [column[0] for column in cursor.description]
                return names, [dict(zip(names, row)) for row in cursor.fetchall()]
            finally:
                cursor.close()

        def multiset(rows, names):
            return Counter(tuple(row[name] for name in names) for row in rows)

        def source_snapshot():
            return {table: raw_query(f"SELECT * FROM qa.{quote(table)} ORDER BY 1")
                    for table in ("customers", "orders", "products", "order_items")}

        report = []
        evidence = os.environ.get("SQLSERVER_VALIDATION_OUTPUT")
        before = source_snapshot()
        try:
            with SQLServerConnector(reader) as source:
                catalog = source.get_tables("qa")
                self.assertEqual(set(catalog), {"customers", "orders", "products", "order_items"})
                self.assertEqual([len(before[table][1]) for table in ("customers", "orders", "products", "order_items")],
                                 [100, 1000, 30, 3000])
                for case in cases:
                    with self.subTest(model=case["name"]), tempfile.TemporaryDirectory(prefix="dbt-flow-sqlserver-model-") as directory:
                        executor = QueryExecutor()
                        compiler = DbtExecutor(directory)
                        try:
                            expected_names, expected_rows = raw_query(references[case["name"]])
                            compiler.configure_source("sqlserver", reader)
                            compiler.deploy_model_files(case["files"], case["model"])
                            compiled = compiler.compile_model(case["model"])
                            self.assertTrue(compiled["success"], compiled.get("error"))
                            preview = executor.execute_query("sqlserver", reader, compiled["sql"], limit=250)
                            self.assertEqual(preview["row_count"], len(expected_rows))
                            self.assertEqual(set(preview["columns"]), set(expected_names))
                            # Use a stable, unique column for paging; duplicated union rows
                            # have identical values, so their relative order is immaterial.
                            sort_column = preview["columns"][0]
                            actual = []
                            for page in range(1, max(1, (len(expected_rows)+249)//250)+1):
                                actual.extend(executor.get_results_page(page=page, page_size=250, sort_column=sort_column)["data"])
                            self.assertEqual(multiset(actual, expected_names), multiset(expected_rows, expected_names))
                            self.assertIsNone(executor.result_store)
                            if case["name"] == "left_join":
                                self.assertEqual(sum(row["customer_key"] is None for row in actual), 20)
                                self.assertEqual(executor.get_results_page(search="L'été 東京")["total_rows"], 10)
                                stats = executor.get_column_stats()["amount"]
                                self.assertEqual(stats["avg"], round(float(raw_query("SELECT AVG(amount) AS avg FROM qa.orders")[1][0]["avg"]), 2))
                                self.assertEqual(stats["nulls"], 27)
                            if case["name"] == "nested_filter":
                                self.assertEqual([row["customer_id"] for row in preview["data"]], [99, 97, 95, 93, 91, 1])

                            # Export builds use the original SQL/YAML, not the ephemeral
                            # preview files; only the external target profile is supplied.
                            compiler.configure_source("sqlserver", writer)
                            for file in case["files"]:
                                path = Path(directory) / file["path"]
                                path.parent.mkdir(parents=True, exist_ok=True)
                                path.write_text(file["content"], encoding="utf-8")
                            project = yaml.safe_load((Path(directory)/"dbt_project.yml").read_text())
                            profile = yaml.safe_load((Path(directory)/"profiles.yml").read_text())[compiler.PROFILE_NAME]
                            profile["outputs"]["preview"]["schema"] = schema
                            (Path(directory)/"profiles.yml").write_text(yaml.safe_dump({project["profile"]: profile}))
                            result = subprocess.run([sys.executable, "-c", "from dbt.cli.main import cli; cli()", "build",
                                                     "--project-dir", directory, "--profiles-dir", directory,
                                                     "--select", "+"+case["model"], "--no-use-colors"],
                                                    capture_output=True, text=True, timeout=180,
                                                    env={**os.environ, **compiler._source_environment})
                            log = compiler._redact(result.stdout+result.stderr)
                            if evidence:
                                destination = Path(evidence)/case["name"]
                                destination.mkdir(parents=True, exist_ok=True)
                                (destination/"build.log").write_text(log)
                                (destination/"export.json").write_text(json.dumps(case["files"], indent=2))
                                (destination/"compiled.sql").write_text(compiled["sql"])
                            self.assertEqual(result.returncode, 0, log)
                            built_names, built_rows = raw_query(f"SELECT * FROM {quote(schema)}.{quote(case['model'])}")
                            self.assertEqual(set(built_names), set(expected_names))
                            self.assertEqual(multiset(built_rows, expected_names), multiset(expected_rows, expected_names))
                            for file in case["files"]:
                                self.assertEqual((Path(directory)/file["path"]).read_text(), file["content"])
                            report.append({"model": case["name"], "expected_rows": len(expected_rows),
                                           "preview_rows": len(actual), "export_rows": len(built_rows), "differences": 0})
                            print(f"SQL Server {case['name']}: preview/export {len(actual)}/{len(built_rows)} rows, zero differences", flush=True)
                        finally:
                            executor.close()
                            compiler.close()
                for query in ("DELETE FROM qa.orders", "SELECT * INTO qa.copy FROM qa.orders"):
                    with self.assertRaises(ValueError):
                        source.execute(query)
                with self.assertRaises(Exception):
                    with source._transaction() as cursor:
                        cursor.execute("UPDATE qa.orders SET amount=amount WHERE order_id=1")
                self.assertEqual(source.get_tables("qa"), catalog)
            self.assertEqual(source_snapshot(), before)
        finally:
            cursor = connection.cursor()
            try:
                cursor.execute("SELECT o.name, o.type FROM sys.objects o JOIN sys.schemas s ON o.schema_id=s.schema_id WHERE s.name=?", schema)
                for name, kind in cursor.fetchall():
                    kind = kind.strip()
                    self.assertIn(kind, {"U", "V"})
                    cursor.execute(f"DROP {'VIEW' if kind == 'V' else 'TABLE'} {quote(schema)}.{quote(name)}")
                cursor.execute(f"IF SCHEMA_ID(N'{schema}') IS NOT NULL DROP SCHEMA {quote(schema)}")
            finally:
                cursor.close()
                connection.close()
                if evidence:
                    Path(evidence).mkdir(parents=True, exist_ok=True)
                    (Path(evidence)/"models.json").write_text(json.dumps(report, indent=2))

    def test_catalog_preview_pagination_search_stats_empty_results_and_source_integrity(self):
        creds = credentials()
        with SQLServerConnector(creds) as connector:
            before = self.snapshot(connector)
            self.assertIn("order_summary", connector.get_tables())
            self.assertEqual(connector.get_columns("orders")[0], {"name": "order_id", "type": "INT"})
            executor = QueryExecutor()
            try:
                with tempfile.TemporaryDirectory() as directory:
                    compiler = DbtExecutor(directory)
                    compiler.configure_source("sqlserver", creds)
                    for flag in (None, "--aggregate", "--custom-sql"):
                        with self.subTest(flag=flag):
                            compiler.deploy_model_files(self.files(flag), "fct_orders_with_users")
                            result = compiler.compile_model("fct_orders_with_users")
                            self.assertTrue(result["success"], result.get("error"))
                            preview = executor.execute_query("sqlserver", creds, result["sql"])
                            if flag == "--aggregate":
                                self.assertEqual(sorted((row["email"], row["total_amount"], row["order_count"]) for row in preview["data"]),
                                                 [("beta@example.test", 20, 1), ("gamma@example.test", 30, 1)])
                            else:
                                self.assertEqual([row["amount"] for row in preview["data"]], [30] if flag else [30, 20])
                            if flag is None:
                                page = executor.get_results_page(page=2, page_size=1, sort_column="order_id")
                                self.assertEqual(page["data"][0]["order_id"], 3)
                                self.assertEqual(executor.get_results_page(search="beta")["total_rows"], 1)
                                self.assertEqual(executor.get_column_stats()["amount"]["avg"], 25)
                    compiler.close()
                empty = executor.execute_query("sqlserver", creds, "SELECT order_id FROM dbo.orders WHERE 1=0")
                self.assertEqual(empty["columns"], ["order_id"])
                self.assertEqual(empty["data"], [])
                native = executor.execute_query("sqlserver", creds, "SELECT 1 / 2 AS division, N'L''été 東京' AS label, CAST(1 AS BIT) AS active")
                self.assertEqual(native["data"][0]["division"], 0)
                self.assertEqual(native["data"][0]["label"], "L'été 東京")
                for query in ("DELETE FROM dbo.orders", "SELECT * INTO dbo.copy FROM dbo.orders", "SELECT 1; UPDATE dbo.orders SET amount=0"):
                    with self.assertRaises(ValueError):
                        connector.execute(query)
                # Server permissions also deny writes independently of our query parser.
                with self.assertRaises(Exception):
                    with connector._transaction() as cursor:
                        cursor.execute("UPDATE dbo.orders SET amount=amount WHERE order_id=1")
                self.assertEqual(self.snapshot(connector), before)
                self.assertIsNone(executor.result_store)
                if os.environ.get("DBT_FLOW_SQLSERVER_BUILD_USER"):
                    elevated = {**creds, "user": os.environ["DBT_FLOW_SQLSERVER_BUILD_USER"],
                                "password": os.environ["DBT_FLOW_SQLSERVER_BUILD_PASSWORD"]}
                    with self.assertRaisesRegex(RuntimeError, "SELECT-only"):
                        SQLServerConnector(elevated).test_connection()
            finally:
                executor.close()

    @unittest.skipUnless(os.environ.get("RUN_SQLSERVER_EXPORT_BUILD") == "1",
                         "enable RUN_SQLSERVER_EXPORT_BUILD=1 with a separate writer for the isolated output schema")
    def test_export_build_matches_source_and_removes_only_its_output_schema(self):
        # Explicit opt-in authorizes writing only to this randomly named test schema.
        import pyodbc
        from dbt.adapters.sqlserver.sqlserver_credentials import SQLServerCredentials
        from dbt.adapters.sqlserver.sqlserver_backend import build_pyodbc_connection_string

        reader = credentials()
        writer = {**reader, "user": os.environ["DBT_FLOW_SQLSERVER_BUILD_USER"],
                  "password": os.environ["DBT_FLOW_SQLSERVER_BUILD_PASSWORD"]}
        schema = "dbt_flow_validation_" + uuid4().hex
        connection_string = build_pyodbc_connection_string(SQLServerCredentials.from_dict({
            "host": writer["host"], "port": writer["port"], "database": writer["database"],
            "schema": schema, "UID": writer["user"], "PWD": writer["password"],
            "driver": writer["driver"], "encrypt": writer["encrypt"], "trust_cert": writer["trust_cert"]}))
        connection = pyodbc.connect(connection_string, timeout=10, autocommit=True)
        connection.timeout = 30
        quote = SQLServerConnector._quote_identifier
        try:
            with SQLServerConnector(reader) as source:
                before = self.snapshot(source)
                with tempfile.TemporaryDirectory() as directory:
                    for flag in (None, "--aggregate", "--custom-sql"):
                        compiler = DbtExecutor(directory)
                        compiler.configure_source("sqlserver", writer)
                        # The export's SQL is used unchanged, including normal materializations.
                        files = self.files(flag)
                        for file in files:
                            path = Path(directory) / file["path"]
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_text(file["content"], encoding="utf-8")
                        project = yaml.safe_load((Path(directory) / "dbt_project.yml").read_text())
                        profile = yaml.safe_load((Path(directory) / "profiles.yml").read_text())[compiler.PROFILE_NAME]
                        profile["outputs"]["preview"]["schema"] = schema
                        (Path(directory) / "profiles.yml").write_text(yaml.safe_dump({project["profile"]: profile}))
                        command = [sys.executable, "-c", "from dbt.cli.main import cli; cli()", "build",
                                   "--project-dir", directory, "--profiles-dir", directory, "--select", "+fct_orders_with_users", "--no-use-colors"]
                        result = subprocess.run(command, capture_output=True, text=True, timeout=180,
                                                env={**os.environ, **compiler._source_environment})
                        self.assertEqual(result.returncode, 0, compiler._redact(result.stdout + result.stderr))
                        cursor = connection.cursor()
                        try:
                            cursor.execute(f"SELECT * FROM {quote(schema)}.[fct_orders_with_users]")
                            names = [item[0] for item in cursor.description]
                            rows = [dict(zip(names, row)) for row in cursor.fetchall()]
                            if flag == "--aggregate":
                                self.assertEqual(sorted((row["email"], row["total_amount"], row["order_count"]) for row in rows),
                                                 [("beta@example.test", 20, 1), ("gamma@example.test", 30, 1)])
                            else:
                                expected = [{"order_id": 3, "user_id": 3, "amount": 30, "email": "gamma@example.test"}]
                                if flag is None:
                                    expected[0]["id"] = 3
                                    expected.append({"order_id": 2, "user_id": 2, "amount": 20, "id": 2, "email": "beta@example.test"})
                                self.assertEqual(sorted(rows, key=lambda row: row["order_id"]), sorted(expected, key=lambda row: row["order_id"]))
                        finally:
                            cursor.close()
                            compiler.close()
                self.assertEqual(self.snapshot(source), before)
        finally:
            # Exact ownership: only objects under our freshly generated schema are removed.
            cursor = connection.cursor()
            try:
                cursor.execute("SELECT o.name, o.type FROM sys.objects o JOIN sys.schemas s ON o.schema_id=s.schema_id WHERE s.name=?", schema)
                for name, kind in cursor.fetchall():
                    kind = kind.strip()
                    self.assertIn(kind, {"U", "V"})
                    cursor.execute(f"DROP {'VIEW' if kind == 'V' else 'TABLE'} {quote(schema)}.{quote(name)}")
                cursor.execute(f"IF SCHEMA_ID(N'{schema}') IS NOT NULL DROP SCHEMA {quote(schema)}")
            finally:
                cursor.close()
                connection.close()


if __name__ == "__main__":
    unittest.main()
