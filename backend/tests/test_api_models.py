import unittest

from main import DatabaseCredentials, PageRequest


class ApiModelDefaultsTests(unittest.TestCase):
    def test_results_page_defaults_to_twenty_five_rows(self) -> None:
        self.assertEqual(PageRequest().page_size, 25)

    def test_sqlserver_tls_options_survive_api_validation(self):
        credentials = DatabaseCredentials(type="sqlserver", driver="ODBC Driver 18 for SQL Server", encrypt="true", trust_cert="false")
        self.assertEqual(credentials.model_dump(exclude_none=True), {
            "type": "sqlserver", "driver": "ODBC Driver 18 for SQL Server", "encrypt": True, "trust_cert": False})


if __name__ == "__main__":
    unittest.main()
