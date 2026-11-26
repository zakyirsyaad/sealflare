import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(cleanup)

// A machine under load renders and queries slower than the one second the library waits by
// default, so a wait that would succeed on a quiet machine is not turned into a failure here.
configure({ asyncUtilTimeout: 5_000 })

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
