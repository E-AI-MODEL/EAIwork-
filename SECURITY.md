# Security

The highest-priority class of bug is **any way for a model, user or untrusted client to raise evidence status beyond what the trusted evidence path allows**.

Do not publish exploit details in a public issue. Use GitHub private vulnerability reporting for this repository when available. If it is not available, contact the repository owner through GitHub and ask for a private reporting channel.

Confirmed bypass sequences are added to `conformance/vectors/` as rejection cases.

## Trust boundaries

- Actor identity comes from the server-side token map, never from the request body.
- Public `/events` requests cannot create `check.passed` events.
- Person/system evidence lineage is derived by the server from actor identity. Client-supplied lineage is ignored.
- `proven` can only be reached through a deterministic check registered inside the server process.
- The server refuses to start when its event log fails integrity verification.
- Direct server startup requires an explicit token file and binds to `127.0.0.1` unless `EAI_HOST` is set deliberately.

Other sensitive areas: token handling, evidence provenance, log integrity, request-size limits and injection through evidence text.
