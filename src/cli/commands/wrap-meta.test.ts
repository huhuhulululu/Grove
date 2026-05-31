/**
 * wrap-meta.test.ts — guards the R-safety ISOLATION fix for `sq wrap`: the event
 * log must record only the TOOL NAME that ran, never the full command line (whose
 * args — test-filter patterns, feature names, internal flags — are work content).
 */
import { describe, it, expect } from 'vitest'
import { programName } from './share'

describe('programName — wrap stores the tool name, never the args (isolation)', () => {
  it('returns the program basename, dropping all arguments', () => {
    expect(programName(['pytest', '-k', 'test_pci_compliance'])).toBe('pytest')
    expect(programName(['npm', 'test', '--', '--grep', 'SSN validation'])).toBe('npm')
  })

  it('basenames an absolute program path (no install path leak)', () => {
    expect(programName(['/usr/local/bin/node', 'secret-internal-script.js'])).toBe('node')
  })

  it('is empty for an empty argv', () => {
    expect(programName([])).toBe('')
  })
})
