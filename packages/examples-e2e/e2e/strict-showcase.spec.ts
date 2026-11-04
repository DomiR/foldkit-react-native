import { type Page as PlaywrightPage, expect, test } from '@playwright/test'

import * as Page from '../page'

const openAnimations = async (page: PlaywrightPage): Promise<void> => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Animations', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Add item', exact: true }),
  ).toBeVisible()
}

const itemLabels = (page: PlaywrightPage) => page.locator('li > p')

const addItems = async (page: PlaywrightPage): Promise<void> => {
  const addItem = page.getByRole('button', { name: 'Add item', exact: true })
  await addItem.click()
  await addItem.click()
  await expect(itemLabels(page)).toHaveCount(3)
}

test.describe('strict-showcase example', () => {
  test('loads cleanly', async ({ page }) => {
    await Page.assertLoadedCleanly(page)
  })

  test('keeps a removed item until its exit animation ends', async ({
    page,
  }) => {
    await openAnimations(page)
    await addItems(page)

    const item = page.locator('li', { hasText: 'Item 2' })
    await page
      .getByRole('button', { name: 'Remove item 2', exact: true })
      .click()

    await expect(item).toBeAttached()
    await expect
      .poll(
        () => item.evaluate(element => element.closest('[inert]') !== null),
        { timeout: 200 },
      )
      .toBe(true)
    await expect
      .poll(
        () => item.evaluate(element => getComputedStyle(element).animationName),
        { timeout: 200 },
      )
      .toBe('foldkit-strict-FadeOut')

    await expect(item).toHaveCount(0, { timeout: 2_000 })
    await expect(itemLabels(page)).toHaveText(['Item 1', 'Item 3'])
  })

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' })

    test('removes immediately with reduced motion', async ({ page }) => {
      await openAnimations(page)
      await addItems(page)

      const item = page.locator('li', { hasText: 'Item 2' })
      await page
        .getByRole('button', { name: 'Remove item 2', exact: true })
        .click()

      await expect(item).toHaveCount(0, { timeout: 100 })
      await expect(itemLabels(page)).toHaveText(['Item 1', 'Item 3'])
    })
  })
})
