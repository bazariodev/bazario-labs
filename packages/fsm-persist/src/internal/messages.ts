const PREFIX = 'fsm-persist';

export const MESSAGES = {
  invalidSource: `${PREFIX}: source must expose subscribe(listener)`,
  invalidToState: `${PREFIX}: toState must be a function`,
  invalidStorage: `${PREFIX}: storage must expose getItem, setItem, and removeItem`,
  invalidKey: `${PREFIX}: key must be a non-empty string`,
  invalidName: `${PREFIX}: name must be a non-empty string`,
  invalidFilter: `${PREFIX}: filter must be a function`,
  invalidSerialize: `${PREFIX}: serialize must be a function`,
  invalidDeserialize: `${PREFIX}: deserialize must be a function`,
  invalidNow: `${PREFIX}: now must be a function`,
  invalidMaxAge: `${PREFIX}: maxAgeMs must be a finite non-negative number`,
  writeFailed: `${PREFIX}: write failed`,
  clearFailed: `${PREFIX}: clear failed`,
  readFailed: `${PREFIX}: read failed`,
  noRecord: `${PREFIX}: no record found`,
  invalidRecord: `${PREFIX}: invalid record ignored`,
  staleRecord: `${PREFIX}: stale record ignored`,
  wrongKind: `${PREFIX}: record kind mismatch`,
  unknownState: `${PREFIX}: record state is not declared in config`,
  partialHierarchyRestore: `${PREFIX}: hierarchy record restored partially`,
} as const;
