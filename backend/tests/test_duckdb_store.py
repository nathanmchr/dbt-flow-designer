import unittest
import importlib.util

from connectors.base import DuckDBStore


@unittest.skipUnless(importlib.util.find_spec("duckdb"), "optional DuckDB connector is not installed")
class DuckDBStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = DuckDBStore()
        self.store.store_results(
            "query_result",
            [
                {"order": 1, "customer name": "O'Reilly"},
                {"order": 2, "customer name": "Other"},
            ],
        )

    def tearDown(self) -> None:
        self.store.close()

    def test_quotes_columns_and_binds_search_pagination(self) -> None:
        page = self.store.get_table_page(
            "query_result",
            page=5,
            page_size=500,
            sort_column="order",
            sort_direction="DESC",
            search="O'Reilly",
        )

        self.assertEqual(page["columns"], ["order", "customer name"])
        self.assertEqual(page["total_rows"], 1)
        self.assertEqual(page["page"], 1)
        self.assertEqual(page["page_size"], 250)
        self.assertEqual(page["data"][0]["customer name"], "O'Reilly")

    def test_numeric_statistics_support_quoted_column_names(self) -> None:
        stats = self.store.get_column_stats("query_result")

        self.assertEqual(stats["order"]["min"], 1)
        self.assertEqual(stats["order"]["max"], 2)

    def test_clear_results_removes_stale_preview(self) -> None:
        self.store.clear_results("query_result")

        self.assertFalse(self.store.table_exists("query_result"))


if __name__ == "__main__":
    unittest.main()
