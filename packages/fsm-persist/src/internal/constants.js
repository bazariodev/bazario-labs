export const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

// Real hierarchies are shallow. The cap bounds a hand-rolled source whose
// `child` getter keeps returning fresh nodes, which the cycle check never sees.
export const MAX_SPINE_DEPTH = 1_000;
