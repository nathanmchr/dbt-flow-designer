"""Compile exported dbt models for native, read-only source previews."""

from contextlib import contextmanager
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment, nodes as jinja_nodes


class DbtExecutor:
    PROFILE_NAME = "flow_designer_preview"
    MODEL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")

    def __init__(self, project_path: str | None = None):
        self.project_path = (
            Path(project_path) if project_path else Path(__file__).parent / "dbt_project"
        )
        self._source_environment: dict[str, str] = {}
        self._sensitive_values: set[str] = set()
        self._execution_lock = threading.Lock()
        self._sqlserver_credentials: dict[str, Any] | None = None
        self._ensure_project_structure()

    @contextmanager
    def execution_session(self):
        """Serialize deployment and compilation of the shared preview project."""
        with self._execution_lock:
            yield

    def _ensure_project_structure(self) -> None:
        for directory in ("models/staging", "models/intermediate", "models/marts"):
            (self.project_path / directory).mkdir(parents=True, exist_ok=True)

    def configure_source(self, adapter_type: str, credentials: dict[str, Any]) -> None:
        self.close()
        if adapter_type.strip().lower() == "duckdb":
            self._configure_duckdb_source(credentials)
            return
        if adapter_type.strip().lower() == "sqlserver":
            self._configure_sqlserver_source(credentials)
            return
        if adapter_type.strip().lower() != "postgres":
            raise ValueError("Live dbt testing supports PostgreSQL, DuckDB and SQL Server; other adapters are not validated yet")
        missing = [field for field in ("host", "database", "user") if not credentials.get(field)]
        if missing:
            raise ValueError(f"Missing PostgreSQL credential(s): {', '.join(missing)}")

        self._source_environment = {
            "PGHOST": str(credentials["host"]),
            "PGPORT": str(int(credentials.get("port", 5432))),
            "PGDATABASE": str(credentials["database"]),
            "PGUSER": str(credentials["user"]),
            "PGPASSWORD": str(credentials.get("password", "")),
            "PGSSLMODE": str(credentials.get("sslmode", "prefer")),
            "DBT_FLOW_SOURCE_SCHEMA": str(credentials.get("schema", "public")),
            "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=30000",
            "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
        }
        self._sensitive_values = {str(credentials["password"])} if credentials.get("password") else set()
        profile = f"""{self.PROFILE_NAME}:
  target: preview
  outputs:
    preview:
      type: postgres
      host: "{{{{ env_var('PGHOST') }}}}"
      port: "{{{{ env_var('PGPORT') | int }}}}"
      dbname: "{{{{ env_var('PGDATABASE') }}}}"
      user: "{{{{ env_var('PGUSER') }}}}"
      password: "{{{{ env_var('PGPASSWORD') }}}}"
      schema: "{{{{ env_var('DBT_FLOW_SOURCE_SCHEMA') }}}}"
      sslmode: "{{{{ env_var('PGSSLMODE') }}}}"
      connect_timeout: 10
      threads: 1
"""
        (self.project_path / "profiles.yml").write_text(profile, encoding="utf-8")

    def _configure_duckdb_source(self, credentials: dict[str, Any]) -> None:
        from connectors.duckdb_connector import DuckDBConnector

        path = DuckDBConnector.source_path(credentials)
        self._source_environment = {
            "DBT_FLOW_DUCKDB_PATH": str(path),
            "DBT_FLOW_SOURCE_SCHEMA": str(credentials.get("schema") or "main"),
            "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
        }
        profile = {
            self.PROFILE_NAME: {
                "target": "preview",
                "outputs": {"preview": {
                    "type": "duckdb",
                    "path": "{{ env_var('DBT_FLOW_DUCKDB_PATH') }}",
                    "schema": "{{ env_var('DBT_FLOW_SOURCE_SCHEMA') }}",
                    "threads": 1,
                    "config_options": dict(DuckDBConnector.PREVIEW_CONFIG),
                }},
            }
        }
        (self.project_path / "profiles.yml").write_text(
            yaml.safe_dump(profile, sort_keys=False), encoding="utf-8"
        )

    def _configure_sqlserver_source(self, credentials: dict[str, Any]) -> None:
        from connectors.sqlserver import SQLServerConnector

        options = SQLServerConnector(credentials).connection_options()
        self._sqlserver_credentials = dict(credentials)
        self._source_environment = {
            "DBT_FLOW_SQLSERVER_HOST": str(credentials["host"]),
            "DBT_FLOW_SQLSERVER_DATABASE": str(credentials["database"]),
            "DBT_FLOW_SQLSERVER_USER": str(credentials["user"]),
            "DBT_ENV_SECRET_SQLSERVER_PASSWORD": str(credentials["password"]),
            "DBT_FLOW_SOURCE_SCHEMA": str(credentials.get("schema") or "dbo"),
            "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
        }
        self._sensitive_values = {str(credentials["password"])}
        profile = {self.PROFILE_NAME: {
            "target": "preview", "outputs": {"preview": {
                "type": "sqlserver", "driver": options["driver"],
                "server": "{{ env_var('DBT_FLOW_SQLSERVER_HOST') }}",
                "database": "{{ env_var('DBT_FLOW_SQLSERVER_DATABASE') }}",
                "user": "{{ env_var('DBT_FLOW_SQLSERVER_USER') }}",
                "password": "{{ env_var('DBT_ENV_SECRET_SQLSERVER_PASSWORD') }}",
                "schema": "{{ env_var('DBT_FLOW_SOURCE_SCHEMA') }}",
                "port": options["port"], "encrypt": options["encrypt"],
                "trust_cert": options["trust_cert"], "authentication": "sql",
                "login_timeout": 10, "query_timeout": 30, "threads": 1,
            }},
        }}
        (self.project_path / "profiles.yml").write_text(
            yaml.safe_dump(profile, sort_keys=False), encoding="utf-8"
        )

    def deploy_model_files(self, files: list[dict[str, str]], model_name: str) -> None:
        """Preserve exported SQL/sources; inline upstream models only in the preview."""
        if not self.MODEL_NAME_PATTERN.fullmatch(model_name):
            raise ValueError(f"Invalid dbt model name: {model_name}")
        prepared: list[tuple[Path, str]] = []
        seen: set[Path] = set()
        project_found = False
        model_found = False
        for file_info in files:
            file_path = self._resolve_project_file(file_info["path"])
            if file_path in seen:
                raise ValueError(f"Duplicate generated file path: {file_info['path']}")
            seen.add(file_path)
            content = file_info["content"]
            if self._sqlserver_credentials is not None:
                self._validate_sqlserver_template(content)
            if len(content.encode("utf-8")) > 1_000_000:
                raise ValueError(f"Generated file is too large: {file_info['path']}")
            if file_path.name == "dbt_project.yml":
                project = yaml.safe_load(content)
                if not isinstance(project, dict) or not isinstance(project.get("name"), str):
                    raise ValueError("Invalid dbt project configuration")
                project["profile"] = self.PROFILE_NAME
                content = yaml.safe_dump(project, sort_keys=False)
                project_found = True
            elif file_path.suffix == ".sql":
                is_output = file_path.stem == model_name
                model_found |= is_output
                if not is_output:
                    content += "\n{{ config(materialized='ephemeral') }}\n"
            prepared.append((file_path, content))
        if not project_found or not model_found:
            raise ValueError("The dbt project and selected output model are required")

        self._clean_models()
        for file_path, content in prepared:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")

    @staticmethod
    def _validate_sqlserver_template(content: str) -> None:
        """Generated refs/config are allowed; preview templates must not execute macros."""
        template = Environment().parse(content)
        allowed_nodes = (jinja_nodes.Template, jinja_nodes.Output, jinja_nodes.TemplateData,
                         jinja_nodes.Call, jinja_nodes.Name, jinja_nodes.Const, jinja_nodes.Keyword,
                         jinja_nodes.Dict, jinja_nodes.Pair, jinja_nodes.List, jinja_nodes.Tuple)
        def is_literal(value) -> bool:
            if isinstance(value, jinja_nodes.Const):
                return True
            if isinstance(value, (jinja_nodes.List, jinja_nodes.Tuple)):
                return all(is_literal(item) for item in value.items)
            if isinstance(value, jinja_nodes.Dict):
                return all(is_literal(item.key) and is_literal(item.value) for item in value.items)
            return False
        for node in template.find_all(jinja_nodes.Node):
            if not isinstance(node, allowed_nodes):
                raise ValueError("SQL Server preview templates only support generated ref/source/config calls, not executable macros")
            if isinstance(node, jinja_nodes.Call):
                if not isinstance(node.node, jinja_nodes.Name) or node.node.name not in {"ref", "source", "config"}:
                    raise ValueError("SQL Server preview templates cannot execute macros")
                if node.dyn_args or node.dyn_kwargs:
                    raise ValueError("SQL Server preview templates require literal arguments")
                if not all(is_literal(argument) for argument in node.args) or not all(is_literal(keyword.value) for keyword in node.kwargs):
                    raise ValueError("SQL Server preview templates require literal arguments")
            if isinstance(node, jinja_nodes.Name) and node.name not in {"ref", "source", "config"}:
                raise ValueError("SQL Server preview templates require literal arguments")

    def _resolve_project_file(self, relative_path: str) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError(f"Invalid generated file path: {relative_path}")
        allowed = relative_path == "dbt_project.yml" or (
            candidate.parts and candidate.parts[0] == "models"
            and candidate.suffix in {".sql", ".yml", ".yaml"}
        )
        if not allowed:
            raise ValueError(f"Unsupported generated file path: {relative_path}")
        resolved = (self.project_path / candidate).resolve()
        if not resolved.is_relative_to(self.project_path.resolve()):
            raise ValueError(f"Invalid generated file path: {relative_path}")
        return resolved

    def _clean_models(self) -> None:
        for file_path in (self.project_path / "models").rglob("*"):
            if file_path.is_file() and file_path.suffix in {".sql", ".yml", ".yaml"}:
                file_path.unlink()

    def compile_model(self, model_name: str) -> dict[str, Any]:
        """Compile with the source adapter without executing run/build or hooks."""
        if not self._source_environment:
            return {"success": False, "error": "Source is not configured", "output": ""}
        if not self.MODEL_NAME_PATTERN.fullmatch(model_name):
            return {"success": False, "error": "Invalid dbt model name", "output": ""}
        command = [
            sys.executable, "-c", "from dbt.cli.main import cli; cli()", "compile",
            "--project-dir", str(self.project_path),
            "--profiles-dir", str(self.project_path),
            "--profile", self.PROFILE_NAME, "--target", "preview",
            "--select", model_name, "--no-introspect", "--no-populate-cache",
            "--no-partial-parse", "--no-use-colors",
        ]
        try:
            if self._sqlserver_credentials is not None:
                # Compilation macros can query the database: verify privileges before dbt starts.
                from connectors.sqlserver import SQLServerConnector

                SQLServerConnector(self._sqlserver_credentials).test_connection()
            completed = subprocess.run(
                command, capture_output=True, text=True,
                cwd=str(self.project_path), timeout=120,
                env={**os.environ, **self._source_environment},
            )
            output = self._redact(completed.stdout)
            if completed.returncode != 0:
                return {
                    "success": False, "output": output,
                    "error": self._redact("\n".join((completed.stderr, completed.stdout)).strip()),
                }
            manifest = json.loads((self.project_path / "target/manifest.json").read_text(encoding="utf-8"))
            models = [node for node in manifest["nodes"].values()
                      if node.get("resource_type") == "model" and node.get("name") == model_name]
            if len(models) != 1 or not models[0].get("compiled_code"):
                raise ValueError("dbt did not produce the selected model's compiled SQL")
            return {"success": True, "output": output, "sql": models[0]["compiled_code"]}
        except subprocess.TimeoutExpired:
            return {"success": False, "output": "", "error": "dbt compilation timed out after 120 seconds"}
        except Exception as error:
            return {"success": False, "output": "", "error": self._redact(str(error))}

    def _redact(self, value: str) -> str:
        for secret in self._sensitive_values:
            value = value.replace(secret, "[REDACTED]")
        return value

    def close(self) -> None:
        self._sqlserver_credentials = None
        self._source_environment.clear()
        self._sensitive_values.clear()
