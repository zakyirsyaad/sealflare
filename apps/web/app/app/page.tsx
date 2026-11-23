import { Frame } from '../../components/ui/Frame'
import { copy } from '../../lib/copy'
// Task 8 supplies the scan field, service and live states. No sample result is presented as real.
export default function ScanShell() {
  return <><h1>{copy.scan.title}</h1><p className="sf-lead">{copy.scan.intro}</p><Frame><p className="sf-shell-note">{copy.scan.notReady}</p></Frame></>
}
