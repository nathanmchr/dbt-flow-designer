import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from dbt_executor import DbtExecutor
from connectors.sqlserver import SQLServerConnector


class SQLServerDbtTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.compiler = DbtExecutor(self.directory.name)
        self.compiler.configure_source("sqlserver", {
            "host": "offline.invalid", "database": "warehouse", "user": "reader", "password": "secret; } "})

    def tearDown(self):
        self.compiler.close()
        self.directory.cleanup()

    def test_profile_is_native_secure_and_contains_no_plaintext_password(self):
        content = (self.compiler.project_path / "profiles.yml").read_text()
        output = yaml.safe_load(content)[self.compiler.PROFILE_NAME]["outputs"]["preview"]
        self.assertEqual(output["type"], "sqlserver")
        self.assertEqual(output["port"], 1433)
        self.assertEqual(output["schema"], "{{ env_var('DBT_FLOW_SOURCE_SCHEMA') }}")
        self.assertTrue(output["encrypt"])
        self.assertFalse(output["trust_cert"])
        self.assertIn("DBT_ENV_SECRET_SQLSERVER_PASSWORD", content)
        self.assertNotIn("secret; } ", content)
        self.assertEqual(self.compiler._source_environment["DBT_FLOW_SOURCE_SCHEMA"], "dbo")

    def test_privileges_are_checked_before_any_dbt_subprocess(self):
        with patch.object(SQLServerConnector, "test_connection", side_effect=RuntimeError("SELECT-only account")), \
                patch("dbt_executor.subprocess.run") as process:
            result = self.compiler.compile_model("fct_orders_with_users")
        self.assertFalse(result["success"])
        self.assertIn("SELECT-only", result["error"])
        process.assert_not_called()

    def test_sqlserver_preview_rejects_executable_jinja_macros_before_deploy(self):
        for template in ("{% if execute %}{{ run_query('DELETE FROM dbo.orders') }}{% endif %} SELECT 1",
                         "{{ adapter.execute('CREATE TABLE x (id int)') }}", "{{ config(x=run_query('SELECT 1')) }}",
                         "{{ config(x=ref) }}"):
            with self.subTest(template=template):
                with self.assertRaises(ValueError):
                    self.compiler._validate_sqlserver_template(template)

    def test_real_adapter_compiles_generated_join_filter_sort_aggregate_and_custom_sql_offline(self):
        root = Path(__file__).resolve().parents[2]
        for flag in (None, "--aggregate", "--custom-sql"):
            command = ["node", "--experimental-strip-types", "frontend/tests/generateLivePostgresFixture.ts", "--sqlserver"]
            if flag:
                command.append(flag)
            # Live suites set these variables for a real server. The offline
            # fixture must stay aligned with its own synthetic compiler profile.
            environment = {**os.environ, "DBT_FLOW_SQLSERVER_DATABASE": "warehouse",
                           "DBT_FLOW_SQLSERVER_SCHEMA": "dbo"}
            files = json.loads(subprocess.run(command, cwd=root, env=environment,
                                              capture_output=True, text=True, check=True).stdout)
            self.compiler.deploy_model_files(files, "fct_orders_with_users")
            # ONLY the live privilege preflight is mocked. dbt-sqlserver really compiles.
            with self.subTest(flag=flag), patch.object(SQLServerConnector, "test_connection", return_value=True):
                compiled = self.compiler.compile_model("fct_orders_with_users")
                self.assertTrue(compiled["success"], compiled.get("error"))
                self.assertIn('"warehouse"."dbo"."orders"', compiled["sql"])
                SQLServerConnector({"database": "warehouse"})._preview_source(compiled["sql"])
                if flag is None:
                    self.assertIn('ORDER BY "amount" DESC', compiled["sql"])
                    self.assertIn("OFFSET 0 ROWS", compiled["sql"])
                self.assertFalse((self.compiler.project_path / "preview.duckdb").exists())


if __name__ == "__main__":
    unittest.main()
