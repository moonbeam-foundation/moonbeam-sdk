# Changelog

## 0.1.0

The first Moonbeam workflow node, built on @moonbeam-foundation/sdk 0.13.0.

- **Agent Standing** (free): **Get Journey** (`journey`: one agent on every venue, its standing, five lights and the one next
  step; the whole journey, one item per venue, or one venue) and **Get List Status** (`listStatus`).
- **Paid Call** (free): **List Tools** of Moonbeam's paid-calls MCP server, and its free **Where Listed** tool.
- **Hire**: **Search Sellers** (free, `searchSellers`) and **Plan Hire** (plan key, `hirePlan`: unsigned calls, nothing sent).
- **Listing** (plan key): **List on Markets** (`listOn`), **Pause**, **Go Live** and **Delist**.
- **Key** (plan key): **Get Standing** (`keyStanding`) and **Get Usage** (`usage`).
- One credential, **Moonbeam API**: the endpoint that comes with your key, and the plan key (sent only when set).
- No run-time dependency. The venue ids and names, the journey's lights and the list step's markets are copied from the SDK
  at build time (`npm run gen`); the tests hold every request equal to the SDK's own.
