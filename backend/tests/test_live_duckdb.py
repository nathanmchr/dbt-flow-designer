import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import duckdb
import yaml

from dbt_executor import DbtExecutor
from executor import QueryExecutor


class LiveDuckDBTests(unittest.TestCase):
    def test_generated_dbt_compiles_and_previews_without_source_writes(self) -> None:
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.duckdb"
            with duckdb.connect(str(path)) as connection:
                connection.execute("CREATE TABLE users (id INTEGER, email VARCHAR)")
                connection.execute("INSERT INTO users VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')")
                connection.execute("CREATE TABLE orders (order_id INTEGER, user_id INTEGER, amount DECIMAL(10,2))")
                connection.execute("INSERT INTO orders VALUES (1,1,10), (2,2,20), (3,3,30)")
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            files = json.loads(subprocess.run(
                ["node", "--experimental-strip-types", "frontend/tests/generateLivePostgresFixture.ts", "--duckdb"],
                cwd=root, capture_output=True, text=True, check=True,
            ).stdout)
            dbt = DbtExecutor(str(Path(directory) / "project"))
            credentials = {"path": str(path)}
            dbt.configure_source("duckdb", credentials)
            profile = yaml.safe_load((dbt.project_path / "profiles.yml").read_text())
            output = profile[dbt.PROFILE_NAME]["outputs"]["preview"]
            self.assertEqual(output["config_options"]["access_mode"], "READ_ONLY")
            self.assertEqual(output["config_options"]["enable_external_access"], "false")
            dbt.deploy_model_files(files, "fct_orders_with_users")
            compiled = dbt.compile_model("fct_orders_with_users")
            self.assertTrue(compiled["success"], compiled.get("error"))
            executor = QueryExecutor()
            preview = executor.execute_query("duckdb", credentials, compiled["sql"])
            self.assertEqual([row["amount"] for row in preview["data"]], [30, 20])
            self.assertEqual([row["email"] for row in preview["data"]], ["gamma", "beta"])
            self.assertEqual(preview["row_count"], 2)
            self.assertIsNone(executor.result_store)
            for flag in ("--aggregate", "--custom-sql"):
                transformed_files = json.loads(subprocess.run(
                    ["node", "--experimental-strip-types", "frontend/tests/generateLivePostgresFixture.ts", "--duckdb", flag],
                    cwd=root, capture_output=True, text=True, check=True,
                ).stdout)
                dbt.deploy_model_files(transformed_files, "fct_orders_with_users")
                transformed = dbt.compile_model("fct_orders_with_users")
                self.assertTrue(transformed["success"], transformed.get("error"))
                result = executor.execute_query("duckdb", credentials, transformed["sql"])
                if flag == "--aggregate":
                    self.assertEqual(sorted((row["email"], row["total_amount"], row["order_count"]) for row in result["data"]),
                                     [("beta", 20, 1), ("gamma", 30, 1)])
                else:
                    self.assertEqual(result["row_count"], 1)
                    self.assertEqual(result["data"][0]["email"], "gamma")
            # Force a compile-time macro to attempt a write, independently of the SELECT validator.
            attack_files = [dict(file) for file in files]
            for file in attack_files:
                if file["path"].endswith("fct_orders_with_users.sql"):
                    file["content"] = "{% if execute %}{% do run_query('CREATE TABLE forbidden (id INTEGER)') %}{% endif %}\nSELECT 1"
            dbt.deploy_model_files(attack_files, "fct_orders_with_users")
            attack = dbt.compile_model("fct_orders_with_users")
            self.assertFalse(attack["success"])
            executor.close()
            dbt.close()
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)


if __name__ == "__main__":
    unittest.main()
