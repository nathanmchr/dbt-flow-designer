"""
dbt Flow Designer - Backend API

FastAPI server that executes SQL queries against source databases
and returns results for display in the frontend.
"""

from contextlib import asynccontextmanager
from ipaddress import ip_address
import os
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from executor import QueryExecutor
from dbt_executor import DbtExecutor
from secret_vault import SecretVault, SecretVaultError


# -----------------------------------------------------------------------------
# Pydantic Models
# -----------------------------------------------------------------------------


class DatabaseCredentials(BaseModel):
    """Database connection credentials."""

    type: str  # postgres, snowflake, bigquery, etc.
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65_535)
    database: str | None = None
    schema_name: str | None = None  # 'schema' is reserved in Pydantic
    user: str | None = None
    password: str | None = None
    sslmode: str | None = None
    path: str | None = None  # Existing DuckDB file on the backend host
    driver: Literal["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"] | None = None
    encrypt: bool | None = None
    trust_cert: bool | None = None
    # For cloud databases
    account: str | None = None
    warehouse: str | None = None
    project: str | None = None
    dataset: str | None = None
    keyfile: str | None = None


class ExecuteRequest(BaseModel):
    """Request to execute a SQL query."""

    credentials: DatabaseCredentials
    sql: str
    limit: int = Field(default=100, ge=1, le=10_000)


class TestConnectionRequest(BaseModel):
    """Request to test database connection."""

    credentials: DatabaseCredentials


class GetTablesRequest(BaseModel):
    """Request to get tables from a database."""

    credentials: DatabaseCredentials
    schema_name: str | None = None


class GetColumnsRequest(BaseModel):
    """Request to get columns for a table."""

    credentials: DatabaseCredentials
    table: str
    schema_name: str | None = None


class QueryResult(BaseModel):
    """Result of a SQL query execution."""

    columns: list[str]
    data: list[dict[str, Any]]
    row_count: int


class PaginatedResult(BaseModel):
    """Paginated query result."""

    columns: list[str]
    data: list[dict[str, Any]]
    total_rows: int
    page: int
    page_size: int
    total_pages: int


class PageRequest(BaseModel):
    """Request for a page of results."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=250)
    sort_column: str | None = None
    sort_direction: str = "ASC"
    search: str | None = None


class ConnectionTestResult(BaseModel):
    """Result of a connection test."""

    success: bool
    error: str | None = None


class DbtModelFile(BaseModel):
    """A single dbt model file."""

    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=1_000_000)


class RunDbtRequest(BaseModel):
    """Request to deploy and run dbt models."""

    files: list[DbtModelFile] = Field(min_length=1, max_length=500)
    model_name: str | None = None
    source_credentials: DatabaseCredentials | None = None


class DbtRunResult(BaseModel):
    """Result of a dbt run."""

    success: bool
    output: str | None = None
    error: str | None = None
    columns: list[str] = Field(default_factory=list)
    data: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0


class EncryptedBlob(BaseModel):
    """A base64-encoded AES-GCM value and its nonce."""

    model_config = ConfigDict(extra="forbid")

    nonce: str = Field(min_length=16, max_length=24)
    ciphertext: str = Field(min_length=24, max_length=1_000_000)


class ProjectSecretEnvelope(BaseModel):
    """Portable encrypted secrets and their wrapped per-project key."""

    model_config = ConfigDict(extra="forbid")

    version: Literal["1.0"]
    algorithm: Literal["AES-256-GCM"]
    project_id: UUID
    wrapped_key: EncryptedBlob
    payload: EncryptedBlob


class EncryptProjectSecretsRequest(BaseModel):
    """Plaintext project secrets accepted only for immediate encryption."""

    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    passwords: dict[str, str]
    existing_envelope: ProjectSecretEnvelope | None = None

    @field_validator("passwords")
    @classmethod
    def validate_passwords(cls, passwords: dict[str, str]) -> dict[str, str]:
        if not passwords or len(passwords) > 100:
            raise ValueError("Between 1 and 100 database passwords are required")
        if any(
            not node_id
            or len(node_id) > 500
            or not password
            or len(password) > 10_000
            for node_id, password in passwords.items()
        ):
            raise ValueError("Invalid database password payload")
        return passwords


class DecryptProjectSecretsRequest(BaseModel):
    """Encrypted project secrets to unlock with this installation's key."""

    model_config = ConfigDict(extra="forbid")

    envelope: ProjectSecretEnvelope


class ProjectSecretsResult(BaseModel):
    """Decrypted passwords returned only to the local editor."""

    passwords: dict[str, str]


# -----------------------------------------------------------------------------
# Application Setup
# -----------------------------------------------------------------------------

# Global executor instances
executor: QueryExecutor | None = None
dbt_executor: DbtExecutor | None = None
secret_vault: SecretVault | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global executor, dbt_executor, secret_vault
    executor = QueryExecutor()
    dbt_executor = DbtExecutor()
    secret_vault = SecretVault.from_environment()
    yield
    if executor:
        executor.close()
    if dbt_executor:
        dbt_executor.close()


app = FastAPI(
    title="dbt Flow Designer API",
    description="Execute SQL queries against source databases",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        *([os.environ["DBT_FLOW_FRONTEND_ORIGIN"]] if os.environ.get("DBT_FLOW_FRONTEND_ORIGIN") else []),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "dbt-flow-designer"}


def require_local_vault_client(request: Request) -> None:
    """Keep plaintext vault operations on the machine running the app."""
    client_host = request.client.host if request.client else ""
    try:
        is_loopback = ip_address(client_host).is_loopback
    except ValueError:
        is_loopback = False
    if not is_loopback:
        raise HTTPException(status_code=403, detail="Vault access is local only")


@app.post("/api/project-secrets/encrypt", response_model=ProjectSecretEnvelope)
async def encrypt_project_secrets(
    payload: EncryptProjectSecretsRequest, request: Request
):
    """Encrypt passwords with a fresh key dedicated to this project."""
    if not secret_vault:
        raise HTTPException(status_code=503, detail="Secret vault not initialized")

    require_local_vault_client(request)
    envelope = secret_vault.encrypt(
        str(payload.project_id),
        payload.passwords,
        payload.existing_envelope.model_dump(mode="json")
        if payload.existing_envelope
        else None,
    )
    return ProjectSecretEnvelope.model_validate(envelope)


@app.post("/api/project-secrets/decrypt", response_model=ProjectSecretsResult)
async def decrypt_project_secrets(
    payload: DecryptProjectSecretsRequest, request: Request
):
    """Decrypt a project envelope using this installation's local vault key."""
    if not secret_vault:
        raise HTTPException(status_code=503, detail="Secret vault not initialized")

    require_local_vault_client(request)
    try:
        passwords = secret_vault.decrypt(
            payload.envelope.model_dump(mode="json")
        )
    except SecretVaultError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return ProjectSecretsResult(passwords=passwords)


@app.post("/api/execute", response_model=QueryResult)
async def execute_query(request: ExecuteRequest):
    """
    Execute a SQL query against a source database.

    Returns the query results with columns and data.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        # Convert credentials to dict
        creds = request.credentials.model_dump(exclude_none=True)
        adapter_type = creds.pop("type")

        # Rename schema_name to schema for connectors
        if "schema_name" in creds:
            creds["schema"] = creds.pop("schema_name")

        result = executor.execute_query(
            adapter_type=adapter_type,
            credentials=creds,
            sql=request.sql,
            limit=request.limit,
        )

        return QueryResult(**result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@app.post("/api/results-page", response_model=PaginatedResult)
def get_results_page(request: PageRequest):
    """
    Page the last preview query on its source database in read-only mode.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        result = executor.get_results_page(
            page=request.page, page_size=request.page_size,
            sort_column=request.sort_column, sort_direction=request.sort_direction,
            search=request.search,
        )
        return PaginatedResult(**result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get page: {str(e)}")


@app.get("/api/column-stats")
def get_column_stats():
    """
    Get statistics for numeric columns in the cached query results.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        return executor.get_column_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@app.post("/api/test-connection", response_model=ConnectionTestResult)
async def test_connection(request: TestConnectionRequest):
    """
    Test database connection with provided credentials.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        creds = request.credentials.model_dump(exclude_none=True)
        adapter_type = creds.pop("type")

        if "schema_name" in creds:
            creds["schema"] = creds.pop("schema_name")

        result = executor.test_connection(
            adapter_type=adapter_type,
            credentials=creds,
        )

        return ConnectionTestResult(**result)

    except ValueError as e:
        return ConnectionTestResult(success=False, error=str(e))
    except Exception as e:
        return ConnectionTestResult(success=False, error=f"Unexpected error: {str(e)}")


@app.post("/api/tables")
async def get_tables(request: GetTablesRequest):
    """
    Get list of tables from the database.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        creds = request.credentials.model_dump(exclude_none=True)
        adapter_type = creds.pop("type")

        if "schema_name" in creds:
            creds["schema"] = creds.pop("schema_name")

        tables = executor.get_tables(
            adapter_type=adapter_type,
            credentials=creds,
            schema=request.schema_name,
        )

        return {"tables": tables}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/columns")
async def get_columns(request: GetColumnsRequest):
    """
    Get columns for a specific table.
    """
    if not executor:
        raise HTTPException(status_code=500, detail="Executor not initialized")

    try:
        creds = request.credentials.model_dump(exclude_none=True)
        adapter_type = creds.pop("type")

        if "schema_name" in creds:
            creds["schema"] = creds.pop("schema_name")

        columns = executor.get_columns(
            adapter_type=adapter_type,
            credentials=creds,
            table=request.table,
            schema=request.schema_name,
        )

        return {"columns": columns}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run-dbt", response_model=DbtRunResult)
def run_dbt_model(request: RunDbtRequest):
    """
    Compile the exported model and preview its SQL natively on the source.
    Dependencies are ephemeral; no model relations are created on the source.
    """
    if not dbt_executor or not executor:
        raise HTTPException(status_code=500, detail="dbt executor not initialized")

    try:
        # Convert Pydantic models to dicts
        files = [{"path": f.path, "content": f.content} for f in request.files]

        # Configure source database if credentials provided
        if not request.source_credentials:
            raise ValueError("Source credentials are required for a live test")
        creds = request.source_credentials.model_dump(exclude_none=True)
        adapter_type = creds.pop("type", "postgres")
        if "schema_name" in creds:
            creds["schema"] = creds.pop("schema_name")

        # Determine model name to query results
        # Look for the mart/output model (usually the main one)
        model_name = request.model_name
        if not model_name:
            # Try to find the main model from file paths
            for f in files:
                if "marts" in f["path"] and f["path"].endswith(".sql"):
                    # Extract model name from path like models/marts/domain/model.sql
                    model_name = f["path"].split("/")[-1].replace(".sql", "")
                    break

            if not model_name:
                # Fallback: use first .sql file
                for f in files:
                    if f["path"].endswith(".sql"):
                        model_name = f["path"].split("/")[-1].replace(".sql", "")
                        break

        if not model_name:
            return DbtRunResult(
                success=False,
                error="Could not determine model name to run",
            )

        with dbt_executor.execution_session():
            executor.clear_preview()
            dbt_executor.configure_source(adapter_type, creds)
            dbt_executor.deploy_model_files(files, model_name)
            run_result = dbt_executor.compile_model(model_name)

            if not run_result["success"]:
                return DbtRunResult(
                    success=False,
                    output=run_result.get("output"),
                    error=run_result.get("error"),
                )

            query_result = executor.execute_query(
                adapter_type, creds, run_result["sql"], limit=25
            )

        if "error" in query_result and query_result["error"]:
            return DbtRunResult(
                success=False,
                output=run_result.get("output"),
                error=f"Query error: {query_result['error']}",
            )

        return DbtRunResult(
            success=True,
            output=run_result.get("output"),
            columns=query_result.get("columns", []),
            data=query_result.get("data", []),
            row_count=query_result.get("row_count", 0),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        message = str(e)
        if request.source_credentials and request.source_credentials.password:
            message = message.replace(request.source_credentials.password, "[REDACTED]")
        raise HTTPException(status_code=500, detail=f"dbt preview failed: {message}") from e


# -----------------------------------------------------------------------------
# Run Server
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
