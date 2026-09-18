// Compatibility alias: re-exports the canonical @orbit/protocol.
// Exists only because parallel tracks scaffolded against different scopes
// (@orbit/* vs @orbitpc/*). Canonical implementation + tests live in
// packages/protocol. Do not fork: add new schemas there.
export * from '@orbit/protocol';
