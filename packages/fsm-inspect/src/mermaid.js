import { MESSAGES } from './internal/messages.js';

const WILDCARD_STATE = '*';

// A flat config renders as a hierarchy without children. The fields are read
// by name, so a config exposing them through getters renders too.
export function mermaidFromFsmConfig(config, options) {
  const { initial, states, transitions } = config;
  return mermaidFromHierarchyConfig({ initial, states, transitions }, options);
}

// Mermaid ids are global across composite blocks and the same state name may
// appear at several levels, so every id derives from the state's dotted path.
export function mermaidFromHierarchyConfig(config, options = {}) {
  const lines = ['stateDiagram-v2'];
  const allocate = createIdAllocator();

  const renderLevel = (level, parentPath, indent) => {
    const states = new Set(Object.keys(level.states));
    // Mermaid would draw a reference to an undeclared state as a new state, so
    // every state the diagram references is checked as it gets its id.
    const id = (state) => {
      if (!states.has(state)) {
        throw new Error(MESSAGES.undeclaredState(state));
      }
      return allocate(pathFor(parentPath, state));
    };
    const emit = (line) => lines.push(`${indent}${line}`);

    const initial = id(level.initial);
    for (const state of states) {
      emit(`state "${escapeText(state)}" as ${id(state)}`);
    }
    emit(`[*] --> ${initial}`);

    // One edge per definition in declaration order; wildcards afterwards.
    const wildcards = [];
    for (const [source, events] of Object.entries(level.transitions)) {
      const from = source === WILDCARD_STATE ? null : id(source);
      // As in the core, a missing or null event map means no transitions.
      for (const [eventType, entry] of Object.entries(events ?? {})) {
        const definitions = Array.isArray(entry) ? entry : [entry];
        for (const { target, guard } of definitions) {
          // The core runs a guard only when it is truthy.
          const label = edgeLabel(eventType, Boolean(guard));
          const to = id(target);
          if (from === null) wildcards.push({ eventType, target, to, label });
          else emit(`${from} --> ${to}: ${label}`);
        }
      }
    }

    if (options.wildcard === 'expand') {
      for (const { eventType, to, label } of wildcards) {
        for (const source of states) {
          // A state's own entry for the event wins, as in the core, which
          // reads only own keys.
          const own = Object.hasOwn(level.transitions, source)
            ? level.transitions[source]
            : null;
          if (Object.hasOwn(own ?? {}, eventType)) continue;
          emit(`${id(source)} --> ${to}: ${label}`);
        }
      }
    } else if (wildcards.length > 0) {
      emit(`note right of ${initial}`);
      const source = escapeText(pathFor(parentPath, WILDCARD_STATE));
      for (const { target, label } of wildcards) {
        emit(
          `  ${source} -- ${label} --> ${escapeText(pathFor(parentPath, target))}`,
        );
      }
      emit('end note');
    }

    for (const [state, child] of Object.entries(level.children ?? {})) {
      const childId = id(state);
      if (child === undefined) continue;
      emit(`state ${childId} {`);
      renderLevel(child, pathFor(parentPath, state), `${indent}  `);
      emit('}');
    }
  };

  renderLevel(config, '', '  ');
  return `${lines.join('\n')}\n`;
}

// One stable id per path. A sanitized id that is already taken gets the next
// free ordinal suffix.
function createIdAllocator() {
  const used = new Set();
  const ids = new Map();

  return (path) => {
    let id = ids.get(path);
    if (id !== undefined) return id;

    const base = sanitizeId(path);
    id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}_${suffix}`;
    used.add(id);
    ids.set(path, id);
    return id;
  };
}

function sanitizeId(path) {
  const base = path
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (base === '') return 's';
  return /^[0-9]/.test(base) ? `s_${base}` : base;
}

function pathFor(parentPath, state) {
  return parentPath ? `${parentPath}.${state}` : state;
}

function edgeLabel(eventType, guarded) {
  return `${escapeText(eventType)}${guarded ? ' [guarded]' : ''}`;
}

// Newlines collapse to spaces; the characters that could end or restructure a
// Mermaid label become numeric entity codes. One pass, so the `#` of an
// inserted code is never escaped again.
function escapeText(value) {
  return value
    .replace(/\r?\n|\r/g, ' ')
    .replace(/[#;:"`]/g, (char) => `#${char.charCodeAt(0)};`);
}
