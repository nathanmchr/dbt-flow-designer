"""
dbt Flow Designer - Backend API

FastAPI server that executes SQL queries against source databases
and returns results for display in the frontend.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from executor import QueryExecutor


# -----------------------------------------------------------------------------
# Pydantic Models
# -----------------------------------------------------------------------------


class DatabaseCredentials(BaseModel):
    """Database connection credentials."""

    type: str  # postgres, snowflake, bigquery, etc.
    host: str | None = None
    port: int | None = None
    database: str | None = None
    schema_name: str | None = None  # 'schema' is reserved in Pydantic
    user: str | None = None
    password: str | None = None
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
    limit: int = 100


class TestConnectionRequest(BaseModel):
    """Request to test database connection."""

    credentials: DatabaseCredentials


class GetTablesRequest(BaseModel):
    """Request to get tables from a database."""

    credentials: DatabaseCredentials
    schema_name: str = "public"


class GetColumnsRequest(BaseModel):
    """Request to get columns for a table."""

    credentials: DatabaseCredentials
    table: str
    schema_name: str = "public"


class QueryResult(BaseModel):
    """Result of a SQL query execution."""

    columns: list[str]
    data: list[dict[str, Any]]
    row_count: int


class ConnectionTestResult(BaseModel):
    """Result of a connection test."""

    success: bool
    error: str | None = None


# -----------------------------------------------------------------------------
# Application Setup
# -----------------------------------------------------------------------------

# Global executor instance
executor: QueryExecutor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global executor
    executor = QueryExecutor()
    yield
    if executor:
        executor.close()


app = FastAPI(
    title="dbt Flow Designer API",
    description="Execute SQL queries against source databases",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
    return {"status": "healthy"}


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


# -----------------------------------------------------------------------------
# Run Server
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
