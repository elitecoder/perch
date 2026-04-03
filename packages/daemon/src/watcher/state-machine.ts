import type { ToolState } from '../plugins/interface.js'

export interface Transition {
  from: ToolState
  to: ToolState
}

export class StateMachine {
  private _state: ToolState

  constructor(initial: ToolState = 'idle') {
    this._state = initial
  }

  get current(): ToolState {
    return this._state
  }

  /**
   * Feed a new observed state. Returns a Transition if the state changed,
   * or null if it stayed the same.
   */
  update(newState: ToolState): Transition | null {
    if (newState === this._state) return null
    const transition: Transition = { from: this._state, to: newState }
    this._state = newState
    return transition
  }

  /**
   * Returns true if this transition pair should trigger a Slack notification
   * according to the plugin's notifyOnTransitions list.
   */
  static shouldNotify(
    transition: Transition,
    notifyOnTransitions: Array<[ToolState, ToolState]>
  ): boolean {
    return notifyOnTransitions.some(
      ([from, to]) => from === transition.from && to === transition.to
    )
  }
}
