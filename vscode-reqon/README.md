# Reqon Language Support for VS Code

Adds Reqon-specific syntax highlighting to `.vague` files. This extension injects Reqon keywords into the base Vague language grammar.

## Requirements

This extension requires the [Vague Language](https://marketplace.visualstudio.com/items?itemName=mcclowes.vague-language) extension to be installed.

## Features

Adds highlighting for Reqon-specific keywords:

- **Mission keywords**: `mission`, `action`, `source`, `store`, `run`, `then`
- **HTTP methods**: `get`, `post`, `put`, `patch`, `delete`, `call`
- **Store types**: `memory`, `file`, `sql`, `nosql`, `postgrest`
- **Auth types**: `oauth2`, `bearer`, `basic`, `api_key`, `none`
- **Control flow**: `for`, `each`, `map`, `apply`, `to`, `as`, `transform`, `try`
- **Flow directives**: `continue`, `skip`, `abort`, `queue`, `jump`, `retry`
- **Pagination**: `paginate`, `offset`, `cursor`, `page`, `until`
- **Sync**: `since`, `lastSync`
- **Scheduling**: `schedule`, `cron`, `every`, `at`, `hours`, `minutes`, `seconds`, `days`, `weeks`
- **Webhook**: `wait`, `timeout`, `path`, `expectedEvents`, `eventFilter`, `storage`
- **Options**: `key`, `partial`, `upsert`, `auth`, `base`, `headers`, `validateResponses`, etc.
- **Special variables**: `response`

## Installation

### From VSIX (Local Install)

1. Package the extension:
   ```bash
   cd vscode-reqon
   npx @vscode/vsce package
   ```

2. Install in VS Code:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Install from VSIX"
   - Select the generated `.vsix` file

### Development Mode

1. Open the `vscode-reqon` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open any `.vague` file to see Reqon syntax highlighting

## Example

```vague
mission SyncInvoices {
  source Xero from "./xero-openapi.yaml" {
    auth: oauth2,
    validateResponses: true
  }

  store invoices: file("invoices")

  action FetchInvoices {
    call Xero.getInvoices {
      paginate: offset,
      since: lastSync
    }

    store response.Invoices -> invoices {
      key: .InvoiceID,
      upsert: true
    }
  }

  run FetchInvoices
}
```

## Related

- [Vague Language](https://marketplace.visualstudio.com/items?itemName=mcclowes.vague-language) - Base language support (required)
- [Reqon](https://github.com/mcclowes/reqon) - The runtime for Vague pipelines
- [Vague](https://github.com/mcclowes/vague) - The base DSL
