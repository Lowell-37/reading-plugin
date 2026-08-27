import { defineStore } from 'pinia'
import type { MigrationPreflightResult } from '../../../src/core/migration-preflight'

type MigrationFailure = Extract<MigrationPreflightResult, { ok: false }>['error']

export const useMigrationStore = defineStore('migration', {
  state: () => ({
    status: 'checking' as 'checking' | 'ready' | 'failed',
    error: null as MigrationFailure | null,
    recoveryStatus: '',
  }),
  actions: {
    ready() {
      this.status = 'ready'
      this.error = null
    },
    fail(error: MigrationFailure) {
      this.status = 'failed'
      this.error = error
    },
    setRecoveryStatus(message: string) {
      this.recoveryStatus = message
    },
  },
})
