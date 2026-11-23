import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TRUST_TIERS } from '@sealflare/shared/rules'
import { Button, Banner, SealMark, ErrorState, EmptyState, Chip, Frame, Skeleton, Tabs, Table, Panel } from '../components/ui'
import { copy } from '../lib/copy'
test('tokens define dark and light themes, primary, zero radius and visible focus', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  expect(css).toContain('--radius: 0;')
  expect(css).toContain(":root[data-theme='light']")
  expect(css).toContain('--primary:')
  expect(css).toContain(':focus-visible')
  expect(css).toContain('prefers-reduced-motion')
})
test('real button defaults to safe form behavior and does not click when disabled', async () => {
  const onClick = vi.fn()
  render(<Button disabled onClick={onClick}>Attest</Button>)
  expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  await userEvent.click(screen.getByRole('button'))
  expect(onClick).not.toHaveBeenCalled()
})
test('variants preserve button attributes and callbacks', async () => {
  const onClick = vi.fn()
  render(<><Button variant="primary" onClick={onClick}>Scan</Button><Button variant="ghost" type="submit">Submit</Button></>)
  await userEvent.click(screen.getByText('Scan'))
  expect(onClick).toHaveBeenCalledOnce()
  expect(screen.getByText('Scan')).toHaveClass('sf-btn--primary')
  expect(screen.getByText('Submit')).toHaveAttribute('type', 'submit')
})
test.each(TRUST_TIERS)('seal %s has full ring only when SAFE', tier => {
  const { container } = render(<SealMark tier={tier} size={48} />)
  const arc = container.querySelector('.sf-seal__arc')
  expect(arc).toHaveAttribute('data-closed', String(tier === 'COMMUNITY_SAFE' || tier === 'WARRANTY_BACKED_SAFE'))
  expect(arc?.getAttribute('stroke-dasharray') === null).toBe(tier === 'COMMUNITY_SAFE' || tier === 'WARRANTY_BACKED_SAFE')
  expect(screen.getByRole('img')).toHaveAccessibleName()
})
test.each(['danger', 'warning', 'info'] as const)('banner %s cannot be dismissed', tone => {
  render(<Banner tone={tone}>Under dispute</Banner>)
  expect(screen.getByText('Under dispute')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
test.each([true, false])('ErrorState states on-chain safety %s and retries', async onChainSafe => {
  const onRetry = vi.fn()
  render(<ErrorState what="The scan could not be loaded." onChainSafe={onChainSafe} onRetry={onRetry} />)
  expect(screen.getByRole('alert')).toHaveTextContent(onChainSafe ? 'Your on-chain data is unaffected.' : 'On-chain data could not be verified.')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
})
test('empty state, chip, crop frame and skeleton preserve content and semantics', () => {
  render(<Frame crop><Chip>Pending</Chip><EmptyState title="No disputes." action={<a href="/app">Scan</a>} /><Skeleton label="Loading target" /></Frame>)
  expect(screen.getByRole('link')).toHaveAttribute('href', '/app')
  expect(screen.getByRole('status')).toHaveAccessibleName('Loading target')
  expect(screen.getByText('Pending').closest('.sf-frame')).toHaveClass('sf-frame--crop')
})
test('tabs support keyboard navigation and expose the selected panel', async () => {
  render(<Tabs label="Target" items={[{ id: 'findings', label: 'Findings', content: 'Checks' }, { id: 'history', label: 'History', content: 'Events' }]} />)
  const tabs = screen.getAllByRole('tab')
  tabs[0]!.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(tabs[1]).toHaveFocus()
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Events')
  await userEvent.keyboard('{Home}')
  expect(tabs[0]).toHaveFocus()
  await userEvent.keyboard('{End}')
  expect(tabs[1]).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(tabs[0]).toHaveFocus()
  await userEvent.click(tabs[1]!)
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Events')
})
test('table keeps a caption, headings and cell labels for narrow cards', () => {
  render(<Table caption="Targets" columns={[{ key: 'name', label: 'Target' }]} rows={[{ id: '1', cells: { name: 'Example' } }]} />)
  expect(screen.getByRole('table')).toHaveAccessibleName('Targets')
  expect(screen.getByRole('columnheader')).toHaveTextContent('Target')
  expect(screen.getByRole('cell')).toHaveAttribute('data-label', 'Target')
})
test('panel has a named dialog and closes via close or cancellation', async () => {
  const onClose = vi.fn()
  render(<Panel title="Attest" onClose={onClose}>Review your vote</Panel>)
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Attest')
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
test('all UX copy is English UI text with no em dash', () => {
  const strings = JSON.stringify(copy)
  expect(strings).not.toContain('—')
  expect(strings).toContain('Evidence upload failed. Nothing was sent on-chain.')
  expect(strings).toContain('This vote is permanent. It cannot be changed or withdrawn.')
  expect(strings).toContain('Opens when the dispute and vault contracts go live.')
})
