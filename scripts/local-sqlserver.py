#!/usr/bin/env python3
"""Own one isolated SQL Server Developer fixture; keep credentials/data locally."""

import argparse
import json
import os
import platform
from pathlib import Path
import secrets
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local/sqlserver"
CONTAINER = "dbt-flow-sqlserver-test"
VOLUME = "dbt-flow-sqlserver-test-data"
IMAGE = "mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04"
OWNER_KEY = "dbt-flow-designer.fixture"
OWNER = "sqlserver"


def docker(*arguments, **kwargs):
    return subprocess.run(["docker", *arguments], capture_output=True, text=True, **kwargs)


def config():
    path = LOCAL / "credentials.json"
    if not path.exists():
        LOCAL.mkdir(parents=True, exist_ok=True)
        values = {"type": "sqlserver", "host": "127.0.0.1", "port": 1433,
                  "database": "dbt_flow_test", "schema_name": "dbo", "user": "dbt_flow_reader",
                  "password": "Reader!9_" + secrets.token_urlsafe(24),
                  "driver": "ODBC Driver 18 for SQL Server", "encrypt": True, "trust_cert": True,
                  "build_user": "dbt_flow_builder", "build_password": "Build!9_" + secrets.token_urlsafe(24),
                  "admin_password": "Admin!9_" + secrets.token_urlsafe(24)}
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(values, stream, indent=2)
        environment = LOCAL / "server.env"
        descriptor = os.open(environment, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(f"ACCEPT_EULA=Y\nMSSQL_PID=Developer\nMSSQL_SA_PASSWORD={values['admin_password']}\nMSSQL_MEMORY_LIMIT_MB=2048\n")
    return json.loads(path.read_text())


def owned_container():
    result = docker("inspect", CONTAINER)
    if result.returncode:
        return None
    item = json.loads(result.stdout)[0]
    if item["Config"].get("Labels", {}).get(OWNER_KEY) != OWNER:
        raise RuntimeError(f"Refusing to modify unowned container {CONTAINER}")
    return item


def sql(statement):
    command = 'export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"; if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b; else exec /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -C -b; fi'
    return docker("exec", "-i", CONTAINER, "bash", "-lc", command, input=statement, timeout=40)


def start():
    config()
    item = owned_container()
    if item:
        if not item["State"]["Running"]:
            result = docker("start", CONTAINER)
            if result.returncode:
                raise RuntimeError(result.stderr)
        return
    volume = docker("volume", "inspect", VOLUME)
    if volume.returncode == 0:
        if json.loads(volume.stdout)[0].get("Labels", {}).get(OWNER_KEY) != OWNER:
            raise RuntimeError(f"Refusing to reuse unowned volume {VOLUME}")
    else:
        result = docker("volume", "create", "--label", f"{OWNER_KEY}={OWNER}", VOLUME)
        if result.returncode:
            raise RuntimeError(result.stderr)
    # The SQL Server PAL expects mssql to own its system directory, not merely
    # have group write access. Only the owned volume's root directory is changed.
    result = docker("run", "--rm", "--user", "0", "--platform", "linux/amd64",
                    "--label", f"{OWNER_KEY}={OWNER}", "--entrypoint", "/bin/chown",
                    "--mount", f"type=volume,source={VOLUME},target=/var/opt/mssql",
                    IMAGE, "10001:10001", "/var/opt/mssql")
    if result.returncode:
        raise RuntimeError(result.stderr)
    result = docker("run", "--detach", "--name", CONTAINER, "--platform", "linux/amd64",
                    "--label", f"{OWNER_KEY}={OWNER}", "--memory", "3g", "--cpus", "2",
                    # This local Developer fixture needs root under macOS ARM emulation.
                    # It is not privileged and mounts only its own Docker data volume.
                    *(["--user", "0"] if sys.platform == "darwin" and platform.machine() == "arm64" else []),
                    "--env", "HOME=/var/opt/mssql", "--workdir", "/var/opt/mssql",
                    "--env-file", str(LOCAL / "server.env"), "--publish", "127.0.0.1:1433:1433",
                    "--mount", f"type=volume,source={VOLUME},target=/var/opt/mssql", IMAGE)
    if result.returncode:
        raise RuntimeError(result.stderr)
    print(f"Started {CONTAINER} (data retained in {VOLUME}).", flush=True)


def setup():
    values = config()
    start()
    deadline = time.monotonic() + 240
    for attempt in range(90):
        if time.monotonic() >= deadline:
            raise RuntimeError("SQL Server did not become ready within four minutes; inspect its logs")
        item = owned_container()
        if not item["State"]["Running"]:
            raise RuntimeError("SQL Server exited during startup; inspect this container's logs")
        try:
            result = sql("SELECT 1;\nGO\n")
            if result.returncode == 0:
                break
        except subprocess.TimeoutExpired:
            pass
        if attempt % 5 == 0:
            print("Waiting for the dedicated SQL Server instance...", flush=True)
        time.sleep(2)
    else:
        raise RuntimeError("SQL Server did not become ready; inspect this container's logs")
    database = values["database"]
    def quote(value):
        return "N'" + value.replace("'", "''") + "'"
    statement = f"IF DB_ID({quote(database)}) IS NULL CREATE DATABASE [{database}];\nGO\n"
    for user, password in ((values["user"], values["password"]), (values["build_user"], values["build_password"])):
        statement += f"IF SUSER_ID({quote(user)}) IS NULL CREATE LOGIN [{user}] WITH PASSWORD={quote(password)}, CHECK_POLICY=OFF;\nGO\n"
    statement += f"USE [{database}];\nGO\n"
    # Check before seeding so setup is idempotent and never overwrites user data.
    result = sql(statement + "SELECT CASE WHEN OBJECT_ID('dbo.users') IS NULL AND OBJECT_ID('dbo.orders') IS NULL THEN 1 ELSE 0 END;\nGO\n")
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    if "\n1\n" in result.stdout.replace(" ", "").replace("\r", ""):
        seed = (ROOT / "backend/sql/sqlserver_test_seed.sql").read_text()
        result = sql(f"USE [{database}];\nGO\n{seed}\nGO\n")
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
    statement = f"USE [{database}];\nGO\n"
    result = sql(statement + (ROOT / "backend/sql/sqlserver_qa_seed.sql").read_text() + "\nGO\n")
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    for user in (values["user"], values["build_user"]):
        statement += f"IF USER_ID({quote(user)}) IS NULL CREATE USER [{user}] FOR LOGIN [{user}];\nGRANT SELECT ON SCHEMA::dbo TO [{user}];\n"
        statement += f"GRANT SELECT ON SCHEMA::qa TO [{user}];\n"
    statement += f"GRANT CREATE SCHEMA, CREATE TABLE, CREATE VIEW, VIEW DEFINITION TO [{values['build_user']}];\nGRANT SELECT ON OBJECT::sys.sql_expression_dependencies TO [{values['build_user']}];\nGO\nSELECT @@VERSION; SELECT COUNT(*) AS orders FROM dbo.orders;\nGO\n"
    result = sql(statement)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    print(result.stdout.strip())
    print(f"Reader configuration: {LOCAL / 'credentials.json'} (private, ignored by Git).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("setup", "start", "stop", "status", "test"))
    parser.add_argument("--all", action="store_true", help="With test, include all backend tests and local PostgreSQL integration")
    arguments = parser.parse_args()
    if arguments.action == "setup":
        setup()
    elif arguments.action == "start":
        start()
    elif arguments.action == "stop":
        if owned_container():
            result = docker("stop", CONTAINER)
            if result.returncode:
                raise RuntimeError(result.stderr)
            print("Stopped the SQL Server fixture; its data volume is retained.")
    elif arguments.action == "status":
        item = owned_container()
        print("Not created" if item is None else json.dumps({"container": CONTAINER, "status": item["State"]["Status"], "volume": VOLUME}))
    else:
        if not owned_container():
            raise RuntimeError("Run setup before live tests")
        values = config()
        environment = {**os.environ, "PYTHONPATH": str(ROOT / "backend"),
                       "RUN_LIVE_SQLSERVER_TEST": "1", "RUN_SQLSERVER_EXPORT_BUILD": "1",
                       "DBT_FLOW_SQLSERVER_HOST": values["host"], "DBT_FLOW_SQLSERVER_PORT": str(values["port"]),
                       "DBT_FLOW_SQLSERVER_DATABASE": values["database"], "DBT_FLOW_SQLSERVER_USER": values["user"],
                       "DBT_FLOW_SQLSERVER_PASSWORD": values["password"],
                       "DBT_FLOW_SQLSERVER_BUILD_USER": values["build_user"], "DBT_FLOW_SQLSERVER_BUILD_PASSWORD": values["build_password"],
                       "DBT_FLOW_SQLSERVER_ENCRYPT": "true", "DBT_FLOW_SQLSERVER_TRUST_CERT": "true"}
        if sys.platform == "darwin":
            ssl_directory = next((path for path in (Path("/opt/homebrew/opt/openssl@3/lib"), Path("/usr/local/opt/openssl@3/lib"))
                                  if (path / "libssl.3.dylib").exists()), None)
            if ssl_directory:
                environment["DYLD_LIBRARY_PATH"] = str(ssl_directory) + (
                    ":" + environment["DYLD_LIBRARY_PATH"] if environment.get("DYLD_LIBRARY_PATH") else "")
        command = [sys.executable, "-m", "unittest", "discover", "-s", "backend/tests", "-v"]
        if arguments.all:
            environment["RUN_LIVE_POSTGRES_TEST"] = "1"
        else:
            command.extend(["-p", "test_live_sqlserver.py"])
        raise SystemExit(subprocess.run(command, cwd=ROOT, env=environment).returncode)


if __name__ == "__main__":
    main()
