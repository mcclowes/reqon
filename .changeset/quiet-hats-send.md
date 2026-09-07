---
'reqon-dsl': patch
---

Send a source's `headers` block on every request. The block parsed but never reached the HTTP client, so declared headers were silently dropped. Values are evaluated once at source init, so `env()` works, and auth provider headers still win on collision.
