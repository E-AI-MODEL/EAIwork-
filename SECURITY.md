# Security

Most important class of bug: **any way for a model to raise a status** that the validator accepts.
Report it privately to the maintainers (set a contact address before publishing).
We add every confirmed sequence to `conformance/vectors/` as a rejection case.

Other areas: token handling in `packages/server`, log integrity (`store.ts`), injection through evidence text.
