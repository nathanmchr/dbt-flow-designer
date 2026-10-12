"""Portable encrypted storage primitives for project database secrets."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Mapping

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


VAULT_VERSION = "1.0"
VAULT_ALGORITHM = "AES-256-GCM"
MASTER_KEY_BYTES = 32
NONCE_BYTES = 12


class SecretVaultError(ValueError):
    """Raised when a project secret envelope cannot be safely processed."""


def _encode(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _decode(value: str, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as error:
        raise SecretVaultError(f"Invalid {field_name}") from error


def _associated_data(project_id: str, purpose: str) -> bytes:
    return f"dbt-flow-designer:{VAULT_VERSION}:{project_id}:{purpose}".encode(
        "utf-8"
    )


class SecretVault:
    """Encrypt project secrets with a per-project key wrapped by an app key."""

    def __init__(self, master_key_path: Path):
        self.master_key_path = master_key_path
        self._master_key = self._load_or_create_master_key()

    @classmethod
    def from_environment(cls) -> "SecretVault":
        configured_directory = os.environ.get("DBT_FLOW_DATA_DIR")
        data_directory = (
            Path(configured_directory).expanduser()
            if configured_directory
            else Path(__file__).resolve().parent / ".data"
        )
        return cls(data_directory / "vault-master.key")

    def _load_or_create_master_key(self) -> bytes:
        self.master_key_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            descriptor = os.open(
                self.master_key_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
        except FileExistsError:
            key = self.master_key_path.read_bytes()
        else:
            key = AESGCM.generate_key(bit_length=256)
            with os.fdopen(descriptor, "wb") as key_file:
                key_file.write(key)

        if len(key) != MASTER_KEY_BYTES:
            raise SecretVaultError("The application vault key is invalid")

        try:
            self.master_key_path.chmod(0o600)
        except OSError:
            # Permission bits are not consistently supported on every platform.
            pass

        return key

    def encrypt(
        self,
        project_id: str,
        passwords: Mapping[str, str],
        existing_envelope: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        if existing_envelope is None:
            project_key = AESGCM.generate_key(bit_length=256)
            wrapped_key_nonce = os.urandom(NONCE_BYTES)
            wrapped_key_ciphertext = AESGCM(self._master_key).encrypt(
                wrapped_key_nonce,
                project_key,
                _associated_data(project_id, "project-key"),
            )
            wrapped_key = {
                "nonce": _encode(wrapped_key_nonce),
                "ciphertext": _encode(wrapped_key_ciphertext),
            }
        else:
            if existing_envelope.get("project_id") != project_id:
                raise SecretVaultError("The project secret envelope does not match")
            project_key = self._unwrap_project_key(existing_envelope)
            existing_wrapped_key = existing_envelope.get("wrapped_key")
            if not isinstance(existing_wrapped_key, Mapping):
                raise SecretVaultError("Invalid wrapped project key")
            wrapped_key = dict(existing_wrapped_key)

        payload_nonce = os.urandom(NONCE_BYTES)

        serialized_passwords = json.dumps(
            dict(passwords),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        encrypted_payload = AESGCM(project_key).encrypt(
            payload_nonce,
            serialized_passwords,
            _associated_data(project_id, "database-passwords"),
        )

        return {
            "version": VAULT_VERSION,
            "algorithm": VAULT_ALGORITHM,
            "project_id": project_id,
            "wrapped_key": wrapped_key,
            "payload": {
                "nonce": _encode(payload_nonce),
                "ciphertext": _encode(encrypted_payload),
            },
        }

    def decrypt(self, envelope: Mapping[str, object]) -> dict[str, str]:
        try:
            version = envelope["version"]
            algorithm = envelope["algorithm"]
            project_id = envelope["project_id"]
            wrapped_key = envelope["wrapped_key"]
            payload = envelope["payload"]
        except KeyError as error:
            raise SecretVaultError("Incomplete project secret envelope") from error

        if version != VAULT_VERSION or algorithm != VAULT_ALGORITHM:
            raise SecretVaultError("Unsupported project secret envelope")
        if not isinstance(project_id, str) or not project_id:
            raise SecretVaultError("Invalid project identifier")
        if not isinstance(wrapped_key, Mapping) or not isinstance(payload, Mapping):
            raise SecretVaultError("Invalid project secret envelope")

        payload_nonce = _decode_value(payload, "nonce", "payload nonce")
        payload_ciphertext = _decode_value(payload, "ciphertext", "secret payload")

        if len(payload_nonce) != NONCE_BYTES:
            raise SecretVaultError("Invalid project secret nonce")

        try:
            project_key = self._unwrap_project_key(envelope)
            plaintext = AESGCM(project_key).decrypt(
                payload_nonce,
                payload_ciphertext,
                _associated_data(project_id, "database-passwords"),
            )
        except (InvalidTag, ValueError) as error:
            raise SecretVaultError(
                "The project secrets cannot be decrypted by this application"
            ) from error

        try:
            decoded = json.loads(plaintext.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SecretVaultError("Invalid decrypted secret payload") from error

        if not isinstance(decoded, dict) or not all(
            isinstance(node_id, str)
            and node_id
            and isinstance(password, str)
            and password
            for node_id, password in decoded.items()
        ):
            raise SecretVaultError("Invalid decrypted secret payload")

        return decoded

    def _unwrap_project_key(self, envelope: Mapping[str, object]) -> bytes:
        project_id = envelope.get("project_id")
        wrapped_key = envelope.get("wrapped_key")
        if not isinstance(project_id, str) or not isinstance(wrapped_key, Mapping):
            raise SecretVaultError("Invalid wrapped project key")

        wrapped_nonce = _decode_value(wrapped_key, "nonce", "wrapped key nonce")
        wrapped_ciphertext = _decode_value(
            wrapped_key, "ciphertext", "wrapped project key"
        )
        if len(wrapped_nonce) != NONCE_BYTES:
            raise SecretVaultError("Invalid project secret nonce")

        try:
            project_key = AESGCM(self._master_key).decrypt(
                wrapped_nonce,
                wrapped_ciphertext,
                _associated_data(project_id, "project-key"),
            )
        except (InvalidTag, ValueError) as error:
            raise SecretVaultError(
                "The project secrets cannot be decrypted by this application"
            ) from error

        if len(project_key) != MASTER_KEY_BYTES:
            raise SecretVaultError("Invalid project key")
        return project_key


def _decode_value(
    container: Mapping[str, object], key: str, field_name: str
) -> bytes:
    value = container.get(key)
    if not isinstance(value, str):
        raise SecretVaultError(f"Invalid {field_name}")
    return _decode(value, field_name)
