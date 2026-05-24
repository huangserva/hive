export function evaluateStagedPmGovernance(
  files: string[],
  committedResearchFiles?: string[]
): {
  errors: string[]
  warnings: string[]
}

export function readCommittedResearchFiles(): string[]

export function readStagedFiles(): string[]
