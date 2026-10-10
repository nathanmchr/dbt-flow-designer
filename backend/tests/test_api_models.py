import unittest

from main import PageRequest


class ApiModelDefaultsTests(unittest.TestCase):
    def test_results_page_defaults_to_twenty_five_rows(self) -> None:
        self.assertEqual(PageRequest().page_size, 25)


if __name__ == "__main__":
    unittest.main()
