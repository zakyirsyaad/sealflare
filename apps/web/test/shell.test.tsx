import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from '../components/AppHeader'
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }))
test('header exposes specified routes, active navigation and wallet placeholder', () => {
  render(<AppHeader />)
  expect(screen.getByRole('navigation', { name: 'App' })).toBeVisible()
  for (const [name, href] of [['Scan', '/app'], ['Explore', '/app/explore'], ['Disputes', '/app/disputes'], ['Bounties', '/app/bounties'], ['Guardians', '/app/guardians']]) expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
  expect(screen.getByRole('link', { name: 'Scan' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeDisabled()
})
test('theme switch changes both the checked state and document theme', async () => {
  render(<AppHeader />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Light theme' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Light theme' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})
