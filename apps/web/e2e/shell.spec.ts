import { expect, test } from '@playwright/test'
for (const width of [375, 1280]) {
  test(`application shell at ${width}px supports both themes without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/app')
    await expect(page.getByRole('heading', { name: 'Scan', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'App' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeDisabled()
    for (const theme of ['dark', 'light']) {
      await page.getByRole('checkbox', { name: 'Light theme' }).setChecked(theme === 'light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/shell-${width}-${theme}.png`, fullPage: true })
    }
    await page.getByRole('link', { name: 'Guardians', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('checkbox', { name: 'Light theme' })).toBeFocused()
    expect(await page.getByRole('checkbox').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
    expect(errors).toEqual([])
  })
}
