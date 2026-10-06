# Security

The highest-priority class of bug is **any way for a model, user or untrusted client to raise evidence status beyond what the trusted evidence path allows**.

Do not publish exploit details in a public issue. Use GitHub private vulnerability reporting for this repository when available. If it is not available, contact the repository owner through GitHub and ask for a private reporting channel.

Confirmed bypass sequences are added to `conformance/vectors/` as rejection cases.

## Trust boundaries

- Actor identity and authorization come from the server-side principal map, never from the request body.
- Read/write/check/audit permissions are explicit and default-deny. Write scope must stay inside read scope.
- State and derived metadata are filtered before being returned, so hidden atoms do not leak through dependencies, rule output, checksums or audit counters.
- Deterministic checks declare their input atoms. The caller must be allowed to read all inputs and the check receives only that scoped state, preventing check results from becoming an oracle over hidden atoms.
- Public `/events` requests cannot create `check.passed` events.
- Person/system evidence lineage is derived by the server from actor identity. Client-supplied lineage is ignored.
- `proven` can only be reached through a deterministic check registered inside the server process.
- The server refuses to start when its event log fails integrity verification.
- Event and rejection heads are signed with Ed25519 and appended to cryptographically chained witness journals outside the datastore. Rewriting both a log and its local head is not sufficient to hide rollback while the witness store itself is not rolled back.
- Normal request writes use cached verified heads plus file fingerprints. Full log and witness scans are reserved for startup/audit or triggered automatically after external file changes, preventing rejection traffic from making verification work grow quadratically.
- The signing private key must not live in the datastore or witness directory. The witness store should be on separate, rollback-resistant storage. A host-level attacker with the signing key or control of both rollback domains remains outside this threat model.
- Direct server startup requires an explicit token file and binds to `127.0.0.1` unless `EAI_HOST` is set deliberately.

Other sensitive areas: token handling, evidence provenance, log integrity, request-size limits and injection through evidence text.
