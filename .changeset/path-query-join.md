---
'reqon-dsl': patch
---

Append pagination, `since` and auth query parameters with `&` when the fetch path already has a query string. They were joined with a second `?`, so a path like `"/items?fields=a"` sent a broken URL as soon as it paginated.
