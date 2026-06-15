import type { WorkerRole } from '../../../src/shared/types.js'

export interface RolePresentation {
  badgeClass: string
  label: string
}

export const getRolePresentation = (
  role: WorkerRole,
  input: { workflowAllowed?: boolean } = {}
): RolePresentation => {
  if (input.workflowAllowed === true) {
    return { badgeClass: 'role-badge--workflow', label: 'Workflow' }
  }
  switch (role) {
    case 'coder':
      return { badgeClass: 'role-badge--coder', label: 'Coder' }
    case 'tester':
      return { badgeClass: 'role-badge--tester', label: 'Tester' }
    case 'reviewer':
      return { badgeClass: 'role-badge--reviewer', label: 'Reviewer' }
    case 'custom':
      return { badgeClass: 'role-badge--custom', label: 'Custom' }
    case 'sentinel':
      return { badgeClass: 'role-badge--custom', label: 'Sentinel' }
    default:
      return { badgeClass: 'role-badge--custom', label: String(role) }
  }
}
