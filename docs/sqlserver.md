# SQL Server connector

Implemented: SQL authentication, TLS, connection/live status, schema-scoped tables
and views, column selection, native previews, pagination/search/sort/numeric stats,
dbt-sqlserver compilation and ordinary dbt exports. The existing encrypted password
vault and saved-model/undo history are reused.

Validation status: offline contracts, real dbt adapter compilation and actual
execution on SQL Server 2022 CU16 Developer (16.0.4165.4) are covered. Native previews,
source write rejection and builds of the unchanged exported SQL pass for join/filter/sort,
aggregation and custom SQL models, with exhaustive result comparisons and source
integrity checks. PostgreSQL and DuckDB non-regressions pass independently. Other
SQL Server versions, managed/Azure variants and production authentication/deployment
configurations have not been separately certified.

## Prerequisites and connection

The local fixture also provides a `qa` schema with 100 customers, 30 products,
1,000 orders and 3,000 order items. `scripts/local-sqlserver.py setup` adds these
tables without replacing existing `dbo`/`qa` data. Select Schema `qa` to use this
richer dataset. See [the model validation report](sqlserver-validation.md) for
the eight generated flows, exhaustive preview/export comparisons and checks.

Install the backend requirements, then install [Microsoft ODBC Driver 18](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)
on the **backend machine**. Python's `pyodbc` package does not include the native driver
or its system driver manager. macOS also needs unixODBC; follow
[Microsoft's macOS installation guide](https://learn.microsoft.com/en-us/sql/connect/odbc/linux-mac/install-microsoft-odbc-driver-sql-server-macos).
Restart the backend after installing requirements.

If Homebrew's default OpenSSL is 4, ODBC 18 still needs OpenSSL 3. Install/retain
`openssl@3` and launch the backend with a **process-local** library path (Apple
Silicon example), rather than relinking the system's libraries:

```bash
DYLD_LIBRARY_PATH=/opt/homebrew/opt/openssl@3/lib \
  backend/venv/bin/python -m uvicorn main:app --reload --app-dir backend --host 127.0.0.1 --port 8765
```

For Intel Homebrew use `/usr/local/opt/openssl@3/lib`. The local SQL Server test
script detects this existing library path for its subprocesses. Linux/Windows use
their normal Microsoft driver prerequisites. `DYLD_FALLBACK_LIBRARY_PATH` alone
did not resolve this driver's OpenSSL loading error on this Mac.

In Database, select SQL Server and enter:

| Field | Value |
| --- | --- |
| Host | Hostname or IP, without a port or connection-string options |
| Port | 1433 by default; specify the instance's TCP port |
| User/password | Dedicated SQL Server login restricted to reading the source |
| Database | Actual source database name |
| Schema | dbo by default |
| ODBC Driver | ODBC Driver 18 for SQL Server (17 is also accepted) |
| Encrypt Connection | true by default |
| Trust Server Certificate | false by default |

For a disposable development server with a self-signed certificate, explicitly
select `trust_cert=true`. This disables certificate verification; do not use it as
a production default. Missing drivers, certificates, credentials, or excessive
permissions produce an error rather than a green live status.

This first implementation covers SQL authentication over TCP. Windows integrated
authentication, Entra ID, linked servers, cross-engine joins, Fabric and Synapse
are not implemented/certified. Azure SQL is not separately validated. Use SQL Server
2017+ for the planned validation matrix.

## Read-only boundary

SQL Server's `ApplicationIntent=ReadOnly` is a routing hint, not an authorization
boundary. The application additionally verifies effective permissions and refuses
write, DDL, EXECUTE and elevated accounts. Give the dedicated login only `CONNECT`
and `SELECT` on the source schema/tables; do not reuse a db_owner or sysadmin login.
Keep that login free of elevated rights on other databases as well.

Native queries must be a single SELECT/UNION/INTERSECT/EXCEPT, validated with a T-SQL
syntax tree. SELECT INTO, multiple statements, DML, sequence increments, linked/
foreign databases and external/table-valued source functions are rejected. Native
sessions have a 10-second login timeout, 30-second query timeout, a 10-second lock
timeout and repeatable-read transactions that are rolled back and closed after use.
Transactions do not replace permission enforcement.

Before compiling a model the same account preflight runs. Generated `ref`, `source`
and literal `config` calls are accepted; executable Jinja/control-flow/macros such
as `run_query` are refused in SQL Server previews. Compilation uses `--no-introspect`
and never executes `dbt run/build`. Upstream models are ephemeral **only for previews**.

Passwords are environment variables (`DBT_ENV_SECRET_SQLSERVER_PASSWORD`) and never
plaintext in profiles or exports. Driver errors and compilation output are redacted.

## SQL semantics

- Unicode filters use `N'…'`; BIT/boolean filters use `1` and `0`.
- Generated sorts have `OFFSET 0 ROWS`, valid inside SQL Server CTEs/views.
  Sorting reaching the output through projection/filter nodes is also emitted on
  the output. Persisted tables never promise a physical row order.
- AVG uses a FLOAT cast so averaging integers preserves fractional values; it is
  approximate numeric arithmetic, not a decimal-exact calculation.
- IEEE NaN operators are explicitly unsupported, not silently mapped to NULL.
- Custom SQL must be valid T-SQL in a dbt model. An inner ORDER BY requires TOP or
  OFFSET; add `OFFSET 0 ROWS` where appropriate. An invalid inner sort is not fixed
  only for preview, because the unchanged export would then fail.
- dbt CTEs are hoisted before wrapping the final query: SQL Server cannot nest a
  WITH inside a derived table. The original model expressions are not translated
  to PostgreSQL/DuckDB for testing.
- Use unique projected column names/aliases. Paging is limited to 250 rows. Search
  is parameterized, case-insensitive and escapes LIKE wildcard characters. Page/stats
  requests reread the source; use an explicit unique sort key for repeatable paging.
- The optional homemade pipeline grouping is bypassed for SQL Server; regular dbt
  ephemeral inlining is used, preserving one exported file per step.

## Reproducible live verification

An owned local Docker fixture is available:

```bash
backend/venv/bin/python scripts/local-sqlserver.py setup
backend/venv/bin/python scripts/local-sqlserver.py status
backend/venv/bin/python scripts/local-sqlserver.py test
backend/venv/bin/python scripts/local-sqlserver.py test --all
backend/venv/bin/python scripts/local-sqlserver.py stop
backend/venv/bin/python scripts/local-sqlserver.py start
```

It owns only `dbt-flow-sqlserver-test` and `dbt-flow-sqlserver-test-data`, verifies
ownership labels before changes and binds port 1433 to loopback only. Random reader,
builder and administrator passwords are stored with mode 0600 under the ignored
`.local/sqlserver/credentials.json` and `server.env`. Use the **reader**, not the
administrator/builder, in the app. The local self-signed certificate uses TLS with
`trust_cert=true`; data remains in the named volume when stopped. `setup` does not
replace existing fixture rows. `test` opts into both source preview and isolated
export builds with the separate builder.
`test --all` includes every backend test plus the isolated PostgreSQL integration
(local PostgreSQL server binaries are required).

The pinned image is SQL Server 2022 Developer CU16 for x86-64, intended only for
disposable local testing, not production. On Apple Silicon, Docker emulation may
fail; [Microsoft does not support SQL Server in emulation environments](https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-deployment).
Reserve several GB of Docker storage and 3 GB RAM before startup. A supported
x86-64 server remains the reference for production certification.
On this Mac ARM, CU16 rejected its system-directory initialization as non-root
even with correct volume ownership; the fixture uses container user root on
macOS ARM only. It is **not privileged**, does not mount a host directory/socket,
and the application's SQL login remains SELECT-only. Do not copy this local
emulation exception into a production deployment.

Provision an **empty, dedicated test database**, then run
`backend/sql/sqlserver_test_seed.sql` as its administrator. The script refuses
system databases and existing fixture tables. It creates `dbo.users`, `dbo.orders`
and `dbo.order_summary`, without creating any server/login or replacing data.
Create a dedicated login/user separately and grant `SELECT ON SCHEMA::dbo` only.

Set these variables locally; do not commit them or paste passwords into chat:

```bash
export DBT_FLOW_SQLSERVER_HOST='your-test-host'
export DBT_FLOW_SQLSERVER_DATABASE='your-isolated-test-database'
export DBT_FLOW_SQLSERVER_USER='dbt_flow_reader'
read -s DBT_FLOW_SQLSERVER_PASSWORD
export DBT_FLOW_SQLSERVER_PASSWORD
RUN_LIVE_SQLSERVER_TEST=1 PYTHONPATH=backend \
  backend/venv/bin/python -m unittest discover -s backend/tests -p test_live_sqlserver.py -v
```

Optional variables: `DBT_FLOW_SQLSERVER_PORT`, `DBT_FLOW_SQLSERVER_DRIVER`,
`DBT_FLOW_SQLSERVER_ENCRYPT`, `DBT_FLOW_SQLSERVER_TRUST_CERT`. Fixtures use `dbo`.
Tests check catalog/views, real compiled models, results, Unicode/BIT, paging,
search/stats, empty results, direct server write rejection, and unchanged source data.

To validate the **unchanged exported dbt SQL** with actual materializations, additionally
set `RUN_SQLSERVER_EXPORT_BUILD=1`, `DBT_FLOW_SQLSERVER_BUILD_USER` and
`DBT_FLOW_SQLSERVER_BUILD_PASSWORD`. This is a separate writer, not the application
reader. Give it SELECT on the fixtures and the ability to create/drop schemas,
tables and views **in the isolated test database only**.
The dbt adapter also needs `VIEW DEFINITION` and SELECT on the system catalog
`sys.sql_expression_dependencies` in that test database; the local fixture grants
these metadata rights only to the builder, not DDL/EXECUTE rights to the app reader.
The harness writes to a
fresh `dbt_flow_validation_<uuid>` schema, compares all projected rows/values, checks
source integrity and removes only that schema's own tables/views. This opt-in is
an explicit authorization to create and remove those test outputs.

For a manual ZIP build, install `dbt-sqlserver==1.10.1`, unzip the project, provide
a profile matching its `dbt_project.yml` and use a writable **output** schema with
source SELECT rights. Never configure a production source schema as the build target.

## References

- [dbt SQL Server configuration](https://docs.getdbt.com/docs/local/connect-data-platform/mssql-setup)
- [Pinned adapter dependency contract](https://github.com/dbt-msft/dbt-sqlserver/blob/v1.10.1/pyproject.toml)
- [Microsoft ORDER BY/CTE restrictions and paging](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql)
- [ApplicationIntent and read-only routing](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/listeners-client-connectivity-application-failover)
