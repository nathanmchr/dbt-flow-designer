import subprocess
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dbt_executor import DbtExecutor


class DbtExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_directory.name)
        self.executor = DbtExecutor(str(self.project_path))

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def configure_source(self) -> None:
        self.executor.configure_source(
            "postgres",
            {
                "host": "db.example.test",
                "port": 5433,
                "database": "warehouse",
                "user": "readonly_user",
                "password": "p@ss word",
                "sslmode": "require",
            },
        )

    def test_profile_uses_native_postgres_and_read_only_environment(self) -> None:
        self.configure_source()

        profile = (self.project_path / "profiles.yml").read_text(encoding="utf-8")
        environment = self.executor._source_environment

        self.assertNotIn("p@ss word", profile)
        self.assertIn("type: postgres", profile)
        self.assertNotIn("duckdb", profile)
        self.assertIn("env_var('PGPASSWORD')", profile)
        self.assertIn("default_transaction_read_only=on", environment["PGOPTIONS"])
        self.assertEqual(environment["PGHOST"], "db.example.test")
        self.assertEqual(environment["PGDATABASE"], "warehouse")
        self.assertEqual(environment["PGPASSWORD"], "p@ss word")
        self.assertEqual(environment["PGSSLMODE"], "require")

    def test_unvalidated_adapters_are_rejected_for_live_dbt_testing(self) -> None:
        with self.assertRaisesRegex(ValueError, "not validated yet"):
            self.executor.configure_source("mysql", {})

    def test_deploy_preserves_sources_and_only_inlines_upstream_models(self) -> None:
        self.executor.deploy_model_files(
            [
                {
                    "path": "dbt_project.yml",
                    "content": "name: 'preview'\nversion: '1.0.0'\nconfig-version: 2\n",
                },
                {
                    "path": "models/staging/postgres/sources.yml",
                    "content": "version: 2\nsources: [{name: postgres, schema: analytics}]\n",
                },
                {
                    "path": "models/staging/postgres/stg_orders.sql",
                    "content": "SELECT * FROM {{ source('postgres', 'orders') }}",
                },
                {
                    "path": "models/marts/fct_orders.sql",
                    "content": "SELECT * FROM {{ ref('stg_orders') }}",
                },
            ],
            model_name="fct_orders",
        )

        sql = (
            self.project_path
            / "models/staging/postgres/stg_orders.sql"
        ).read_text(encoding="utf-8")
        source_yaml = (
            self.project_path / "models/staging/postgres/sources.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("source('postgres', 'orders')", sql)
        self.assertIn("materialized='ephemeral'", sql)
        self.assertIn("schema: analytics", source_yaml)
        self.assertNotIn("materialized='ephemeral'",
            (self.project_path / "models/marts/fct_orders.sql").read_text()
        )
        self.assertIn("profile: flow_designer_preview",
            (self.project_path / "dbt_project.yml").read_text())

    def test_invalid_deploy_does_not_replace_existing_preview(self) -> None:
        existing = self.project_path / "models/staging/existing.sql"
        existing.write_text("SELECT 1", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "Invalid generated file path"):
            self.executor.deploy_model_files(
                [{"path": "../outside.sql", "content": "SELECT 2"}], "fct_orders"
            )

        self.assertEqual(existing.read_text(encoding="utf-8"), "SELECT 1")

    def test_compile_never_runs_models_and_redacts_failures(self) -> None:
        self.configure_source()
        password = self.executor._source_environment["PGPASSWORD"]
        completed = subprocess.CompletedProcess(
            args=[], returncode=1, stdout=f"connection failed: {password}", stderr=""
        )

        with patch("dbt_executor.subprocess.run", return_value=completed) as run:
            result = self.executor.compile_model("fct_orders")

        command = run.call_args.args[0]
        environment = run.call_args.kwargs["env"]
        self.assertEqual(command[1], "-c")
        self.assertEqual(command[3], "compile")
        self.assertNotIn("build", command)
        self.assertNotIn("run", command)
        self.assertIn("--no-introspect", command)
        self.assertIn("fct_orders", command)
        self.assertEqual(environment["PGPASSWORD"], password)
        self.assertFalse(result["success"])
        self.assertNotIn(password, result["output"])
        self.assertNotIn(password, result["error"])
        self.assertIn("[REDACTED]", result["error"])

    def test_compile_returns_selected_manifest_sql(self) -> None:
        self.configure_source()
        target = self.project_path / "target"
        target.mkdir()
        sql = "WITH x AS (SELECT 1 / 2 AS division) SELECT * FROM x"
        (target / "manifest.json").write_text(json.dumps({"nodes": {
            "model.preview.fct_orders": {"resource_type": "model", "name": "fct_orders", "compiled_code": sql}
        }}))
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="compiled", stderr="")
        with patch("dbt_executor.subprocess.run", return_value=completed):
            result = self.executor.compile_model("fct_orders")
        self.assertTrue(result["success"])
        self.assertEqual(result["sql"], sql)

    def test_compile_timeout_and_missing_artifacts_are_failures(self) -> None:
        self.configure_source()
        with patch("dbt_executor.subprocess.run", side_effect=subprocess.TimeoutExpired([], 120)):
            result = self.executor.compile_model("fct_orders")
        self.assertFalse(result["success"])
        self.assertIn("timed out", result["error"])
        with patch("dbt_executor.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            self.assertFalse(self.executor.compile_model("fct_orders")["success"])


if __name__ == "__main__":
    unittest.main()
