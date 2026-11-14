export type AgencyStats = {
  isSetUp: boolean
  outbox: number
  clients: string[]
  proposals: number
  queue: number
  replies: number
}
export type GitInfo = { branch: string; changed: number } | null

declare module 'claude-code' {
  interface PluginState {
    schrotty: { agency: Shaped<AgencyStats>; git: Shaped<GitInfo>; isBandHidden: boolean }
  }
}
