export type StepStatus = 'done' | 'resolved' | 'deferred' | 'blocked' | 'decision'

export type StepAttempt = { action: string; reason: string }

export type StepOption = { option: string; note: string }

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
  // deferred: why moving on is safe
  okReason?: string
  // blocked: each piece of work that could not be done because of it
  notDone?: string[]
  // deferred / blocked with options: the user's pick (0-based); the node is then no longer open
  chosen?: { choice: number; ts: number }
  // set when `resolve` turned a deferred / blocked node into resolved
  resolvedAt?: number
  // decision, or deferred / blocked: the choices; decision only: what Claude does meanwhile and the pick (0-based)
  options?: StepOption[]
  interim?: string
  decided?: { choice: number; ts: number }
}

// `ask`: a question was just asked and the person has not scrolled since; show it at the top if its exchange is taller than the window.
export type ViewWindow = { offset: number; follow: boolean; ask?: boolean }

export type BtwEntry = {
  id: string
  q: string
  a?: string
  error?: string
  pending: boolean
  // the person closed the exchange (✕ on its question row, or /flow-clear): it is no longer shown
  closed?: true
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
      btwInput: number
      rowBg: string
      themePicker: boolean
      // Decision node ids whose pane choice is being sent.
      deciding: string[]
      // Top row of the window over the list view / detail view, and whether it keeps to the end.
      listView: ViewWindow
      detailView: ViewWindow
    }
  }
}
