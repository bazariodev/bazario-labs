import { MESSAGES } from './internal/messages.js';
import {
  hasOwn,
  isObject,
  isRecord,
  WILDCARD_STATE,
} from './internal/predicates.js';
import type {
  DiagramTransitionDefinition,
  FsmDiagramConfig,
  HierarchyDiagramConfig,
  MermaidOptions,
} from './types.js';

type NormalizedTransition = Readonly<{
  source: string;
  eventType: string;
  target: string;
  guarded: boolean;
}>;

type RenderMode = 'flat' | 'hierarchy';

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HASH_PLACEHOLDER = '\u0000HASH\u0000';

export function mermaidFromFsmConfig(
  config: FsmDiagramConfig,
  options: MermaidOptions = {},
): string {
  validateMermaidOptions(options);
  const stateNames = validateDiagramConfig(config);
  const ids = new IdRegistry('s');
  for (const state of stateNames) {
    if (isSafeIdentifier(state)) ids.reserve(state);
  }
  const idFor = (state: string) => flatStateId(state, ids);
  const lines = ['stateDiagram-v2'];

  for (const state of stateNames) {
    lines.push(
      isSafeIdentifier(state)
        ? `  state ${idFor(state)}`
        : `  state "${escapeText(state)}" as ${idFor(state)}`,
    );
  }

  lines.push(`  [*] --> ${idFor(config.initial)}`);
  renderEdges(lines, config, '', stateNames, idFor, options, 'flat', 1);

  return `${lines.join('\n')}\n`;
}

export function mermaidFromHierarchyConfig(
  config: HierarchyDiagramConfig,
  options: MermaidOptions = {},
): string {
  validateMermaidOptions(options);
  const ids = new IdRegistry('h');
  const lines = ['stateDiagram-v2'];

  renderHierarchyLevel(lines, config, '', ids, options, 1);

  return `${lines.join('\n')}\n`;
}

function renderHierarchyLevel(
  lines: string[],
  config: HierarchyDiagramConfig,
  parentPath: string,
  ids: IdRegistry,
  options: MermaidOptions,
  depth: number,
): void {
  const stateNames = validateDiagramConfig(config);
  const indent = indentation(depth);
  const idFor = (state: string) => pathStateId(pathFor(parentPath, state), ids);

  for (const state of stateNames) {
    lines.push(`${indent}state "${escapeText(state)}" as ${idFor(state)}`);
  }

  lines.push(`${indent}[*] --> ${idFor(config.initial)}`);
  renderEdges(
    lines,
    config,
    parentPath,
    stateNames,
    idFor,
    options,
    'hierarchy',
    depth,
  );

  const children = config.children;
  if (children === undefined) return;
  if (!isRecord(children)) throw new Error(MESSAGES.invalidDiagramConfig);

  for (const state of Object.keys(children)) {
    if (!stateNames.includes(state))
      throw new Error(MESSAGES.invalidDiagramConfig);
    const child = children[state];
    if (child === undefined) continue;
    if (!isRecord(child)) throw new Error(MESSAGES.invalidDiagramConfig);

    lines.push(`${indent}state ${idFor(state)} {`);
    renderHierarchyLevel(
      lines,
      child as HierarchyDiagramConfig,
      pathFor(parentPath, state),
      ids,
      options,
      depth + 1,
    );
    lines.push(`${indent}}`);
  }
}

function renderEdges(
  lines: string[],
  config: FsmDiagramConfig,
  parentPath: string,
  stateNames: ReadonlyArray<string>,
  idFor: (state: string) => string,
  options: MermaidOptions,
  mode: RenderMode,
  depth: number,
): void {
  const wildcardTransitions: NormalizedTransition[] = [];
  const indent = indentation(depth);

  for (const [source, eventMap] of Object.entries(config.transitions)) {
    if (eventMap === undefined) continue;
    if (!isRecord(eventMap)) throw new Error(MESSAGES.invalidDiagramConfig);
    if (source !== WILDCARD_STATE && !stateNames.includes(source)) {
      throw new Error(MESSAGES.invalidDiagramConfig);
    }

    for (const [eventType, entry] of Object.entries(eventMap)) {
      const definitions = normalizeTransitionEntry(entry);
      for (const definition of definitions) {
        if (!stateNames.includes(definition.target)) {
          throw new Error(MESSAGES.invalidDiagramConfig);
        }

        const transition: NormalizedTransition = {
          source,
          eventType,
          target: definition.target,
          guarded:
            hasOwn(definition, 'guard') && definition.guard !== undefined,
        };

        if (source === WILDCARD_STATE) {
          wildcardTransitions.push(transition);
          continue;
        }

        lines.push(
          `${indent}${idFor(source)} --> ${idFor(definition.target)}: ${edgeLabel(
            eventType,
            transition.guarded,
          )}`,
        );
      }
    }
  }

  if (!wildcardTransitions.length) return;

  if (options.wildcard === 'expand') {
    for (const transition of wildcardTransitions) {
      for (const source of stateNames) {
        lines.push(
          `${indent}${idFor(source)} --> ${idFor(
            transition.target,
          )}: ${edgeLabel(transition.eventType, transition.guarded)}`,
        );
      }
    }
    return;
  }

  const anchor = idFor(config.initial);
  lines.push(`${indent}note right of ${anchor}`);
  for (const transition of wildcardTransitions) {
    const sourceLabel =
      mode === 'hierarchy' && parentPath
        ? `${parentPath}.${WILDCARD_STATE}`
        : WILDCARD_STATE;
    lines.push(
      `${indent}  ${escapeText(sourceLabel)} -- ${edgeLabel(
        transition.eventType,
        transition.guarded,
      )} --> ${escapeText(pathFor(parentPath, transition.target))}`,
    );
  }
  lines.push(`${indent}end note`);
}

function normalizeTransitionEntry(
  value: unknown,
): ReadonlyArray<DiagramTransitionDefinition> {
  const definitions = Array.isArray(value) ? value : [value];
  if (!definitions.length) throw new Error(MESSAGES.invalidTransitionEntry);

  return definitions.map((definition) => {
    if (!isObject(definition) || typeof definition.target !== 'string') {
      throw new Error(MESSAGES.invalidTransitionEntry);
    }

    return definition as DiagramTransitionDefinition;
  });
}

function validateDiagramConfig(config: FsmDiagramConfig): string[] {
  if (
    !isRecord(config) ||
    typeof config.initial !== 'string' ||
    !isRecord(config.states) ||
    !isRecord(config.transitions)
  ) {
    throw new Error(MESSAGES.invalidDiagramConfig);
  }

  const stateNames = Object.keys(config.states);
  if (!stateNames.includes(config.initial)) {
    throw new Error(MESSAGES.invalidDiagramConfig);
  }

  return stateNames;
}

function validateMermaidOptions(options: MermaidOptions): void {
  if (
    !isRecord(options) ||
    (options.wildcard !== undefined &&
      options.wildcard !== 'note' &&
      options.wildcard !== 'expand')
  ) {
    throw new Error(MESSAGES.invalidMermaidOptions);
  }
}

function flatStateId(state: string, ids: IdRegistry): string {
  return isSafeIdentifier(state) ? state : ids.forPath(state);
}

function pathStateId(path: string, ids: IdRegistry): string {
  return ids.forPath(path);
}

function pathFor(parentPath: string, state: string): string {
  return parentPath ? `${parentPath}.${state}` : state;
}

function edgeLabel(eventType: string, guarded: boolean): string {
  return `${escapeText(eventType)}${guarded ? ' [guarded]' : ''}`;
}

function escapeText(value: string): string {
  return value
    .replace(/#/g, HASH_PLACEHOLDER)
    .replace(/\r?\n|\r/g, ' ')
    .replace(/;/g, '#59;')
    .replace(/:/g, '#58;')
    .replace(/"/g, '#quot;')
    .replace(/`/g, '#96;')
    .replaceAll(HASH_PLACEHOLDER, '#35;');
}

function indentation(depth: number): string {
  return '  '.repeat(depth);
}

function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

class IdRegistry {
  readonly #prefix: string;
  readonly #pathIds = new Map<string, string>();
  readonly #used = new Set<string>();

  constructor(prefix: string) {
    this.#prefix = prefix;
  }

  reserve(id: string): void {
    this.#used.add(id);
  }

  forPath(path: string): string {
    const cached = this.#pathIds.get(path);
    if (cached) return cached;

    const base = this.#sanitize(path);
    let candidate = base;
    let suffix = 2;
    while (this.#used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }

    this.#used.add(candidate);
    this.#pathIds.set(path, candidate);
    return candidate;
  }

  #sanitize(path: string): string {
    const replaced = path.replace(/[^A-Za-z0-9_]/g, '_');
    const compacted = replaced.replace(/_+/g, '_').replace(/^_|_$/g, '');
    const base = compacted || this.#prefix;
    return isSafeIdentifier(base) ? base : `${this.#prefix}_${base}`;
  }
}
