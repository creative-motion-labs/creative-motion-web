/**
 * Pure guards for catalog assignment panel lifecycle (patient scope / generation).
 */

export function shouldIgnoreCatalogAssignmentResult(options: {
  scopeAtStart: number;
  currentScope: number;
  generationAtStart: number;
  currentGeneration: number;
  aborted: boolean;
}): boolean {
  if (options.aborted) return true;
  if (options.scopeAtStart !== options.currentScope) return true;
  if (options.generationAtStart !== options.currentGeneration) return true;
  return false;
}

export type CatalogAssignPanelUiSnapshot = {
  selectedProgramId: string | null;
  sessionDrafts: unknown[];
  saveError: string;
  saving: boolean;
};

export function createEmptyCatalogAssignPanelUi(): CatalogAssignPanelUiSnapshot {
  return {
    selectedProgramId: null,
    sessionDrafts: [],
    saveError: "",
    saving: false,
  };
}

export function resetCatalogAssignPanelUiForPatientChange(): CatalogAssignPanelUiSnapshot {
  return {
    selectedProgramId: null,
    sessionDrafts: [],
    saveError: "",
    saving: false,
  };
}
