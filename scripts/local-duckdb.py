"""Create a deterministic local DuckDB fixture; never overwrite an existing file."""

import argparse
from pathlib import Path

import duckdb


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=str(Path(__file__).resolve().parents[1] / ".local/duckdb/dbt_flow_test.duckdb"))
    path = Path(parser.parse_args().path).expanduser().resolve()
    if path.exists():
        raise SystemExit(f"Existing file preserved: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(path)) as connection:
        connection.execute("CREATE TABLE customers AS SELECT i AS customer_id, 'Customer ' || i AS full_name, "
                           "CASE WHEN i % 2 = 0 THEN 'FR' ELSE 'DE' END AS country_code FROM range(1, 101) r(i)")
        connection.execute("CREATE TABLE orders AS SELECT i AS order_id, (i - 1) % 100 + 1 AS customer_id, "
                           "CAST(i * 1.25 AS DECIMAL(12,2)) AS total_amount FROM range(1, 1001) r(i)")
        connection.execute("CREATE VIEW order_summary AS SELECT o.*, c.full_name, c.country_code "
                           "FROM orders o LEFT JOIN customers c USING (customer_id)")
    print(f"DuckDB fixture created: {path}\nSchema: main; customers: 100; orders: 1000; view: order_summary")


if __name__ == "__main__":
    main()
