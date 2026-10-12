import unittest
from asyncio import run

from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from main import app, health_check, require_local_vault_client


def request_from(client_host: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/project-secrets/decrypt",
            "headers": [],
            "client": (client_host, 50_000),
            "server": ("127.0.0.1", 8_765),
            "scheme": "http",
            "query_string": b"",
        }
    )


class SecretVaultApiTests(unittest.TestCase):
    def test_health_check_identifies_the_service(self) -> None:
        self.assertEqual(
            run(health_check()),
            {"status": "healthy", "service": "dbt-flow-designer"},
        )

    def test_accepts_loopback_clients(self) -> None:
        require_local_vault_client(request_from("127.0.0.1"))
        require_local_vault_client(request_from("::1"))

    def test_rejects_remote_clients(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            require_local_vault_client(request_from("192.0.2.10"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_allows_vault_requests_from_ipv4_loopback_frontend(self) -> None:
        cors = next(
            middleware
            for middleware in app.user_middleware
            if middleware.cls is CORSMiddleware
        )
        self.assertIn(
            "http://127.0.0.1:5173", cors.kwargs["allow_origins"]
        )


if __name__ == "__main__":
    unittest.main()
