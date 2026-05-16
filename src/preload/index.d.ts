import type { ClipdockApi } from '../shared/clipdock'

declare global {
  interface Window {
    clipdock: ClipdockApi
  }
}

export {}
