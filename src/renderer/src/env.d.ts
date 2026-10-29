import type { NeledPortApi } from '../../core/types'

declare global {
  interface Window {
    neledport: NeledPortApi
  }
}

export {}
