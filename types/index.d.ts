export type StepStatus = 'done' | 'resolved' | 'workaround' | 'unresolved'

export type StepAttempt = { action: string; reason: string }

export type StepNode = {
  id: string
  at: string
  ts: number
  title: string
  status: StepStatus
  cause?: string
  attempts?: StepAttempt[]
  fix?: string
  detail?: string
}

export type BtwEntry = {
  id: string
  q: string
  a?: string
  error?: string
  pending: boolean
  // The step open in the detail view when it was asked.
  nodeId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'step-flow': {
      nodes: Shaped<StepNode[]>
      theme: number
      selected: string
      btw: BtwEntry[]
      locale: string
      btwInput: number
      rowBg: string
      themePicker: boolean
    }
  }
}
