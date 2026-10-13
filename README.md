# dbt Flow Designer

A visual editor for designing, validating, testing, and exporting dbt models as an interactive DAG.

## Local setup

Requirements: Node.js 22+ and Python 3.11+.

```bash
python3 -m venv backend/venv
backend/venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend install
```

Start the API and the frontend in two terminals:

```bash
backend/venv/bin/python -m uvicorn main:app --reload --app-dir backend --host 127.0.0.1 --port 8765
npm --prefix frontend run dev
```

The frontend uses `http://localhost:8765` by default. Set `VITE_API_URL` before
starting Vite to use another API URL.

If port 5173 is already occupied, use an explicit frontend origin and another port:

```bash
DBT_FLOW_FRONTEND_ORIGIN=http://127.0.0.1:5174 backend/venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8765
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

## Local PostgreSQL test database

An isolated PostgreSQL 15 instance can be managed from the repository:

```bash
./scripts/local-postgres.sh setup
./scripts/local-postgres.sh start
./scripts/local-postgres.sh status
./scripts/local-postgres.sh stop
```

`setup` starts the instance and restores the deterministic seed dataset. It resets
the contents of the test tables, so use `start` when you want to preserve local
changes made after setup.

Use these values in the **Database** node:

- Type: `PostgreSQL`
- Host: `127.0.0.1`
- Port: `5432`
- Database: `dbt_flow_test`
- Schema: `raw`
- User: `dbt_flow_reader`
- Password: `dbt_flow_reader_local`
- SSL mode: `disable`

The role can connect, inspect, and select from the `raw` schema, but it cannot insert,
update, delete, or create objects. The server listens only on the local loopback
interface.

Available relations:

- `raw.customers`: 100 customers.
- `raw.products`: 30 products.
- `raw.orders`: 1,000 orders.
- `raw.order_items`: 3,000 order lines.
- `raw.events`: 5,000 product events with JSONB properties.
- `raw.order_summary`: ready-to-use joined and aggregated view.

## Testing a flow on PostgreSQL

1. Open the permanent **Database** node and select **PostgreSQL**.
2. Enter host, port, user, password, database, schema, and SSL mode.
3. Connect one or more **Table** nodes and define their actual table names and columns.
4. Complete the flow up to **Model Output**, then click **Test model**.

The API compiles the exported project with `dbt-postgres`. For the preview only,
upstream models become ephemeral CTEs. The compiled output query runs directly on
PostgreSQL inside a read-only transaction that is always rolled back. No tables,
views or source rows are created or modified, and DuckDB is not needed.
Source credentials are passed to dbt through environment variables and are not
written to `profiles.yml`.

Results start at 25 rows per page. Pagination, sorting, search and statistics execute
read-only queries on the source again; subsequent pages can reflect source changes
made since the previous page. Connections close after each request. Export still
downloads the original SQL models and YAML, with their normal materializations.

### Project secret vault

Database passwords are encrypted with AES-256-GCM before they are added to a saved
flow. Each project has its own random key; that key is itself encrypted by the local
application key stored in `backend/.data/vault-master.key`. Plaintext passwords are
not stored in the flow JSON, localStorage, sessionStorage, or dbt profiles.

The vault uses ordinary files and works the same way on macOS, Windows, and Linux.
Set `DBT_FLOW_DATA_DIR` to move the application key outside the repository. Back up
that key separately if encrypted projects must survive a reinstall or move to another
computer, and never commit or share it. Until a user master password is added, anyone
who obtains both the application key and a project JSON can decrypt its passwords.

Live dbt testing supports PostgreSQL, local DuckDB and the SQL Server connector.
SQL Server has been verified on a local SQL Server 2022 Developer fixture, including
native previews and dbt builds of exported models. Other adapter definitions are
retained but hidden from the Database dropdown.
See [the multi-database roadmap](docs/architecture/adr-001-multi-database.md) for
the enterprise SQL and data/BI coverage plan and its activation criteria.

## Testing a flow on DuckDB

Create a local fixture without overwriting any existing database:

```bash
backend/venv/bin/python scripts/local-duckdb.py
```

Select **DuckDB** in the Database node, enter the absolute file path printed by
the script, and leave Schema blank for `main`. The file must exist on the machine
running the backend, not merely on the browser's machine. The fixture has
100 customers, 1,000 orders, and the `order_summary` view.

Tables, columns, the live indicator, model preview, pagination, search, sorting
and statistics use the actual DuckDB file. The API compiles with `dbt-duckdb`;
previews and compilation connections open the file read-only. External file access
and automatic extension loading are disabled. Each native preview has a 30-second
interrupt timer and a 256 MB memory limit; compiled dbt still has a 120-second timeout.
Missing files and in-memory sources are rejected rather than silently creating a file.

The ZIP is an ordinary dbt project, not a saved preview. To build it, install
`dbt-duckdb` and supply a normal writable target profile. Do not build into a
production source file: use a separate output database with the source attached
read-only and explicitly qualified in `sources.yml`, or a disposable test copy.

DuckDB currently covers local database files only, not MotherDuck, cloud files,
attached databases or extensions. Cloud and enterprise adapters will be validated
separately; listed future engines are not claimed as already functional.

## Verification

SQL Server configuration, driver prerequisites and opt-in live/export tests are
documented in [the SQL Server connector guide](docs/sqlserver.md).

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run lint
PYTHONPATH=backend backend/venv/bin/python -m unittest discover -s backend/tests -v
```

The PostgreSQL integration test starts an isolated local PostgreSQL instance and
compiles files produced by the frontend generator and checks native query results
and unchanged source data/relations. It is opt-in and requires PostgreSQL
server binaries (`initdb`, `pg_ctl`, `createdb`, and `psql`):

```bash
RUN_LIVE_POSTGRES_TEST=1 PYTHONPATH=backend \
  backend/venv/bin/python -m unittest backend/tests/test_live_postgres.py -v
```

## Current execution safeguards

- PostgreSQL sessions default to read-only mode.
- DuckDB connections require existing local files and disable writes and external file access.
- SQL Server requires SQL authentication with a SELECT-only account. Effective server,
  database, schema and object write/DDL/EXECUTE permissions are rejected before testing.
- Native preview statements have a 30-second timeout and return at most 250 rows per page.
- dbt compilation has a 120-second timeout. SQL Server checks account permissions and
  refuses executable Jinja macros in previews; it has no PostgreSQL-style READ ONLY transaction.
- Generated file paths are constrained to the preview dbt project.
- SQL identifiers are quoted; SQL Server sessions enable QUOTED_IDENTIFIER for ANSI quotes.
- Custom SQL remains intentionally user-authored SQL; use a database role restricted
  to the schemas and tables needed for testing.
