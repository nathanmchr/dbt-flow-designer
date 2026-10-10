import base64
import copy
import tempfile
import unittest
from pathlib import Path

from secret_vault import SecretVault, SecretVaultError


class SecretVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.key_path = Path(self.temp_directory.name) / "vault-master.key"
        self.vault = SecretVault(self.key_path)

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def test_round_trips_passwords_without_plaintext_in_the_envelope(self) -> None:
        passwords = {
            "database-source": "correct horse battery staple",
            "warehouse": "another secret",
        }

        envelope = self.vault.encrypt(
            "2dd13508-64a5-4217-ab05-ccb170530625", passwords
        )

        self.assertEqual(self.vault.decrypt(envelope), passwords)
        self.assertNotIn("correct horse battery staple", str(envelope))
        self.assertEqual(len(self.key_path.read_bytes()), 32)

    def test_keeps_one_key_per_project_while_rotating_payload_nonces(self) -> None:
        project_id = "2dd13508-64a5-4217-ab05-ccb170530625"

        first = self.vault.encrypt(project_id, {"database-source": "secret"})
        second = self.vault.encrypt(
            project_id,
            {"database-source": "updated secret"},
            first,
        )

        self.assertEqual(first["wrapped_key"], second["wrapped_key"])
        self.assertNotEqual(first["payload"], second["payload"])
        self.assertEqual(
            self.vault.decrypt(second),
            {"database-source": "updated secret"},
        )

    def test_rejects_tampered_or_foreign_envelopes(self) -> None:
        envelope = self.vault.encrypt(
            "2dd13508-64a5-4217-ab05-ccb170530625",
            {"database-source": "secret"},
        )
        tampered = copy.deepcopy(envelope)
        payload = tampered["payload"]
        self.assertIsInstance(payload, dict)
        ciphertext = bytearray(base64.b64decode(payload["ciphertext"]))
        ciphertext[0] ^= 1
        payload["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")

        with self.assertRaises(SecretVaultError):
            self.vault.decrypt(tampered)

        foreign_vault = SecretVault(
            Path(self.temp_directory.name) / "other-vault-master.key"
        )
        with self.assertRaises(SecretVaultError):
            foreign_vault.decrypt(envelope)


if __name__ == "__main__":
    unittest.main()
