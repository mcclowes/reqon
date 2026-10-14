---
'reqon-dsl': minor
---

Add `blockPrivateNetworks` to `ExecutorConfig`. When on, every request and redirect hop must resolve to a public address; loopback, private, link-local, metadata and reserved ranges throw `EgressBlockedError` without retrying. Off by default.
