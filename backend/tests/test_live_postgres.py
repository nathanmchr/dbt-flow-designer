import json
import os
import shutil
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
import psycopg2

from dbt_executor import DbtExecutor
from executor import QueryExecutor


@unittest.skipUnless(
    os.environ.get("RUN_LIVE_POSTGRES_TEST") == "1",
    "set RUN_LIVE_POSTGRES_TEST=1 to run the local PostgreSQL smoke test",
)
class LivePostgresSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        postgres_bin = cls._find_postgres_bin()
        if postgres_bin is None:
            raise unittest.SkipTest("a local PostgreSQL server installation is required")

        cls.postgres_bin = postgres_bin
        cls.cluster = tempfile.TemporaryDirectory()
        cls.data_directory = Path(cls.cluster.name) / "data"
        cls.project = tempfile.TemporaryDirectory()
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            cls.port = port_socket.getsockname()[1]

        subprocess.run(
            [
                str(postgres_bin / "initdb"),
                "--pgdata",
                str(cls.data_directory),
                "--auth=trust",
                "--username=postgres",
                "--no-locale",
                "--encoding=UTF8",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                str(postgres_bin / "pg_ctl"),
                "--pgdata",
                str(cls.data_directory),
                "--options",
                f"-p {cls.port} -h 127.0.0.1",
                "--log",
                str(Path(cls.cluster.name) / "postgres.log"),
                "--wait",
                "start",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                str(postgres_bin / "createdb"),
                "--host=127.0.0.1",
                f"--port={cls.port}",
                "--username=postgres",
                "warehouse",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                str(postgres_bin / "psql"),
                "--host=127.0.0.1",
                f"--port={cls.port}",
                "--username=postgres",
                "--dbname=warehouse",
                "--set=ON_ERROR_STOP=1",
                "--command",
                "CREATE TABLE public.users (id INTEGER PRIMARY KEY, email TEXT); "
                "CREATE TABLE public.orders ("
                "order_id INTEGER PRIMARY KEY, user_id INTEGER, amount NUMERIC); "
                "INSERT INTO public.users VALUES "
                "(1, 'alpha@example.test'), (2, 'beta@example.test'), "
                "(3, 'gamma@example.test'); "
                "INSERT INTO public.orders VALUES "
                "(1, 1, 10), (2, 2, 20), (3, 3, 30);",
            ],
            check=True,
            capture_output=True,
            text=True,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "postgres_bin") and hasattr(cls, "data_directory"):
            subprocess.run(
                [
                    str(cls.postgres_bin / "pg_ctl"),
                    "--pgdata",
                    str(cls.data_directory),
                    "--wait",
                    "stop",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        if hasattr(cls, "project"):
            cls.project.cleanup()
        if hasattr(cls, "cluster"):
            cls.cluster.cleanup()

    @staticmethod
    def _find_postgres_bin() -> Path | None:
        candidates = [
            Path("/opt/homebrew/opt/postgresql@15/bin"),
            Path("/opt/homebrew/opt/postgresql@16/bin"),
            Path("/usr/local/opt/postgresql@15/bin"),
            Path("/usr/local/opt/postgresql@16/bin"),
        ]
        postgres = shutil.which("postgres")
        if postgres:
            candidates.insert(0, Path(postgres).parent)
        return next(
            (candidate for candidate in candidates if (candidate / "postgres").exists()),
            None,
        )

    def credentials(self) -> dict:
        return {
            "host": "127.0.0.1", "port": self.port, "database": "warehouse",
            "user": "postgres", "password": "p@ss word", "sslmode": "disable",
            "schema": "public",
        }

    def source_snapshot(self) -> tuple:
        credentials = self.credentials()
        credentials.pop("schema")
        with psycopg2.connect(**credentials) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT relname, relkind FROM pg_class WHERE relnamespace = 'public'::regnamespace ORDER BY relname")
            relations = cursor.fetchall()
            cursor.execute("SELECT * FROM public.orders ORDER BY order_id")
            orders = cursor.fetchall()
            cursor.execute("SELECT * FROM public.users ORDER BY id")
            users = cursor.fetchall()
            return relations, orders, users

    def test_dbt_compiles_and_previews_native_postgres_without_source_writes(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        generated = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                "tests/generateLivePostgresFixture.ts",
            ],
            cwd=repository_root / "frontend",
            check=True,
            capture_output=True,
            text=True,
        )
        files = json.loads(generated.stdout)

        before = self.source_snapshot()
        compiler = DbtExecutor(self.project.name)
        compiler.configure_source("postgres", self.credentials())
        compiler.deploy_model_files(files, "fct_orders_with_users")
        compiled = compiler.compile_model("fct_orders_with_users")
        self.assertTrue(compiled["success"], compiled.get("error") or compiled["output"])
        self.assertIn("__dbt__cte_", compiled["sql"])
        self.assertNotIn("source_db", compiled["sql"])

        executor = QueryExecutor()
        result = executor.execute_query("postgres", self.credentials(), compiled["sql"], limit=25)
        self.assertEqual(
            result["columns"], ["order_id", "user_id", "amount", "id", "email"]
        )
        self.assertEqual(result["row_count"], 2)
        self.assertEqual([row["order_id"] for row in result["data"]], [3, 2])
        page = executor.get_results_page(page=2, page_size=1, sort_column="order_id")
        self.assertEqual([row["order_id"] for row in page["data"]], [3])
        filtered = executor.get_results_page(search="beta", page_size=25)
        self.assertEqual(filtered["total_rows"], 1)
        self.assertEqual(filtered["data"][0]["email"], "beta@example.test")
        self.assertEqual(executor.get_column_stats()["amount"]["avg"], 25)
        self.assertIsNone(executor.result_store)
        self.assertEqual(self.source_snapshot(), before)
        self.assertFalse((Path(self.project.name) / "preview.duckdb").exists())

    def test_native_semantics_percent_literals_empty_columns_and_write_refusal(self) -> None:
        executor = QueryExecutor()
        before = self.source_snapshot()
        result = executor.execute_query(
            "postgres", self.credentials(),
            "SELECT 1 / 2 AS division, 5 % 2 AS remainder, 'O''Reilly 100%' AS label", 25,
        )
        self.assertEqual(result["data"][0]["division"], 0)
        self.assertEqual(result["data"][0]["remainder"], 1)
        self.assertEqual(executor.get_results_page(search="O'Reilly")["total_rows"], 1)
        empty = executor.execute_query("postgres", self.credentials(), "SELECT order_id FROM public.orders WHERE false", 25)
        self.assertEqual(empty["columns"], ["order_id"])
        self.assertEqual(empty["row_count"], 0)

        for query in (
            "DELETE FROM public.orders",
            "SELECT 1; DELETE FROM public.orders",
            "WITH deleted AS (DELETE FROM public.orders RETURNING *) SELECT * FROM deleted",
        ):
            with self.subTest(query=query), self.assertRaises(Exception):
                executor.execute_query("postgres", self.credentials(), query)
        self.assertEqual(self.source_snapshot(), before)

    def test_read_only_transaction_blocks_writing_function_even_for_admin(self) -> None:
        credentials = self.credentials()
        connection_args = {key: value for key, value in credentials.items() if key != "schema"}
        with psycopg2.connect(**connection_args) as connection, connection.cursor() as cursor:
            cursor.execute("""CREATE FUNCTION public.try_write() RETURNS integer LANGUAGE plpgsql AS $$
                BEGIN INSERT INTO public.orders VALUES (99, 1, 999); RETURN 1; END $$""")
        before = self.source_snapshot()
        try:
            with self.assertRaises(psycopg2.errors.ReadOnlySqlTransaction):
                QueryExecutor().execute_query("postgres", credentials, "SELECT public.try_write()")
            self.assertEqual(self.source_snapshot(), before)
        finally:
            with psycopg2.connect(**connection_args) as connection, connection.cursor() as cursor:
                cursor.execute("DROP FUNCTION public.try_write()")

    def test_compilation_macro_cannot_create_source_relations(self) -> None:
        before = self.source_snapshot()
        compiler = DbtExecutor(self.project.name)
        compiler.configure_source("postgres", self.credentials())
        compiler.deploy_model_files([
            {"path": "dbt_project.yml", "content": "name: preview\nversion: '1.0.0'\nconfig-version: 2"},
            {"path": "models/marts/unsafe_macro.sql", "content":
             "{% if execute %}{% do run_query('CREATE TABLE public.must_not_exist (id integer)') %}{% endif %}\nSELECT 1"},
        ], "unsafe_macro")
        compiled = compiler.compile_model("unsafe_macro")
        self.assertFalse(compiled["success"])
        self.assertNotIn("sql", compiled)
        self.assertEqual(self.source_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
