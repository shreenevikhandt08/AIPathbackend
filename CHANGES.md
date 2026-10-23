# Backend changes
- Problem statements may now repeat. `quick-create` answers 409 `DUPLICATE_STATEMENT` with `matches` (name, department, year, team) unless the body has `allowDuplicate: true`.
- New `POST /api/problem-statement/check` -> `{ exists, matches[] }`.
- New `utils/problemStatementOwners.js` (finds who holds a statement).
- Fingerprint index is no longer unique; the old `uniq_statement_fingerprint` index is dropped on startup (`config/db.js`).
