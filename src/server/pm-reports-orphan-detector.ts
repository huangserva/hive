import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  extractPmDocDate,
  findPairedResearchNote,
  listPmResearchCandidates,
  shouldIgnoreReportResearchPairing,
  suggestedResearchFilename,
} from './pm-report-research-pairing.js'

export interface OrphanReport {
  reportDate: string
  reportPath: string
  suggestedResearchPath: string
}

export const detectOrphanReports = (hiveDir: string): OrphanReport[] => {
  const reportsDir = join(hiveDir, 'reports')
  const researchDir = join(hiveDir, 'research')
  if (!existsSync(reportsDir)) return []

  const researchFiles = listPmResearchCandidates(researchDir)

  return readdirSync(reportsDir)
    .filter((filename) => filename.endsWith('.html') && !filename.startsWith('.'))
    .filter((filename) => !shouldIgnoreReportResearchPairing(filename))
    .flatMap((filename) => {
      const reportDate = extractPmDocDate(filename)
      const reportPath = join(reportsDir, filename)
      if (
        !reportDate ||
        findPairedResearchNote(
          { content: readFileSync(reportPath, 'utf8'), filename, path: reportPath },
          researchFiles
        )
      ) {
        return []
      }
      return [
        {
          reportDate,
          reportPath,
          suggestedResearchPath: join(
            researchDir,
            suggestedResearchFilename(basename(filename), reportDate)
          ),
        },
      ]
    })
}
