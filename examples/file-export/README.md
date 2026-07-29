# File Export Example

Demonstrates the `file()` store for generating exports, reports, and backups.
`file()` writes each store to JSON under `.reqon-data/` (git-ignored), so it needs
no external services and runs anywhere.

## What it does

1. `FetchData` — pulls orders and products from an API into memory stores.
2. `ExportOrders` — flattens each order into an export row.
3. `ExportCustomers` — writes one row per order, attributed to its customer.
4. `GenerateInventoryReport` — emits a per-product row per category, and flags
   out-of-stock items.
5. `GenerateDailySummary` — records each order into a dated bucket.
6. `CreateBackup` — copies every record from the `orders` and `products` stores
   into a `backup` store, carrying all fields through with the spread operator.

It runs the exports in parallel, then the summary and backup, and is scheduled
daily at 2 AM (`schedule: cron "0 2 * * *"`).

## Run

```bash
node dist/cli.js examples/file-export/export.vague --verbose
```

Outputs land in `.reqon-data/`, one JSON file per `file()` store (e.g.
`exports/orders.json`, `backups/full-backup.json`).

## Features demonstrated

- `file("path")` store for JSON exports, reports, and backups
- `...spread` to copy a record's fields into a new object (used by the backup)
- Filtered iteration with `for ... in <store> where ...`
- `schedule: cron` for recurring exports

## Notes

- A store isn't a value in an expression, so store-wide aggregates aren't
  expressible inline — `length(orders)` returns `0` and `sum(orders.total)`
  throws. Totals and counts are therefore left to whatever reads the exported
  rows (or computed as you iterate). The metadata rows here record only what can
  be produced without aggregating a whole store.
- To back up a store you must iterate it and copy row by row; embedding a store
  as a single field (`data: orders`) yields an empty object.
