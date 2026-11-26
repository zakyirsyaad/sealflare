import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
afterEach(cleanup)

// A machine under load renders and queries slower than the one second the library waits by
// default, so a wait that would succeed on a quiet machine is not turned into a failure here.
configure({ asyncUtilTimeout: 5_000 })

// The testing library only knows that the timers are faked when there is a global `jest`, and it
// moves them itself. Vitest has no `jest`, so this shim gives it one and a test that fakes the
// timers can wait for the screen without the wait hanging for ever.
;(globalThis as { jest?: { advanceTimersByTime: (ms: number) => void } }).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
}

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
