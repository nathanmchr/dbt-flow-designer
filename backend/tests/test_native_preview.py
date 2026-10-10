import unittest
from unittest.mock import MagicMock, patch

from executor import QueryExecutor


class NativePreviewTests(unittest.TestCase):
    def test_postgres_preview_never_initializes_a_duckdb_store(self) -> None:
        connector = MagicMock()
        connector.__enter__.return_value = connector
        connector.get_results_page.return_value = {
            "columns": ["id"], "data": [{"id": 1}], "total_rows": 300,
        }
        with patch("executor.get_connector", return_value=connector), patch("executor.DuckDBStore") as store:
            executor = QueryExecutor()
            preview = executor.execute_query("postgres", {}, "SELECT id FROM public.orders", 25)
            self.assertEqual(preview["row_count"], 300)
            executor.get_results_page(page=2, page_size=25)
            executor.get_column_stats()
            store.assert_not_called()
            connector.get_results_page.assert_any_call("SELECT id FROM public.orders", page_size=25)

    def test_clear_and_failed_new_preview_do_not_keep_previous_results(self) -> None:
        connector = MagicMock()
        connector.__enter__.return_value = connector
        connector.get_results_page.return_value = {
            "columns": ["id"], "data": [{"id": 1}], "total_rows": 1,
        }
        executor = QueryExecutor()
        with patch("executor.get_connector", return_value=connector):
            executor.execute_query("postgres", {}, "SELECT 1", 25)
            connector.get_results_page.side_effect = RuntimeError("source unavailable")
            with self.assertRaises(RuntimeError):
                executor.execute_query("postgres", {}, "SELECT 2", 25)
        self.assertEqual(executor.get_results_page()["total_rows"], 0)
        self.assertEqual(executor.get_column_stats(), {})
