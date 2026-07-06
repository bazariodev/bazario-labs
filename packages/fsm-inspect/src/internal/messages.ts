const PREFIX = 'fsm-inspect';

export const MESSAGES = {
  invalidLimit: `${PREFIX}: limit must be a finite integer >= 1`,
  invalidNow: `${PREFIX}: now must be a function`,
  invalidMapContext: `${PREFIX}: mapContext must be a function`,
  invalidMapSnapshot: `${PREFIX}: mapSnapshot must be a function`,
  invalidMapEvent: `${PREFIX}: mapEvent must be a function`,
  invalidMapMeta: `${PREFIX}: mapMeta must be a function`,
  invalidOnEntry: `${PREFIX}: onEntry must be a function`,
  invalidConfig: `${PREFIX}: config must be an object`,
  invalidRecorder: `${PREFIX}: recorder must be an InspectRecorder`,
  invalidSource: `${PREFIX}: source must expose subscribe(listener)`,
  invalidName: `${PREFIX}: name must be a non-empty string`,
  invalidMermaidOptions: `${PREFIX}: wildcard must be "note" or "expand"`,
  invalidDiagramConfig: `${PREFIX}: diagram config is malformed`,
  invalidTransitionEntry: `${PREFIX}: diagram transition entry is malformed`,
} as const;
