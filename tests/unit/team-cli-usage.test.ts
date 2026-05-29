import { describe, expect, test, vi } from 'vitest'

import { runTeamCommand, TEAM_USAGE } from '../../src/cli/team.js'

describe('TEAM_USAGE', () => {
  test('lists the explicit Mobile App reply command next to remote reply commands', () => {
    expect(TEAM_USAGE).toContain('team mobile-reply "<text>"')
    expect(TEAM_USAGE).toContain('team feishu reply "<text>"')
  })

  test('team --help prints the explicit Mobile App reply command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runTeamCommand(['--help'])

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('team mobile-reply "<text>"'))
    logSpy.mockRestore()
  })
})
