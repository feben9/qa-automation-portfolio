import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { InventoryPage } from '../../pages/InventoryPage';

const PASSWORD = 'secret_sauce'; // public demo credential published on the site

test.describe('Login', () => {
  test('a standard user reaches the product list', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.login('standard_user', PASSWORD);
    await new InventoryPage(page).expectLoaded();
  });

  test('a locked-out user is refused with a clear message', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.login('locked_out_user', PASSWORD);
    await expect(login.error).toContainText('this user has been locked out');
    await expect(page).toHaveURL(/saucedemo\.com\/$/);
  });

  for (const [label, user, pass, message] of [
    ['empty username', '', PASSWORD, 'Username is required'],
    ['empty password', 'standard_user', '', 'Password is required'],
    ['wrong password', 'standard_user', 'nope', 'do not match any user'],
  ]) {
    test(`validation: ${label}`, async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();
      await login.login(user, pass);
      await expect(login.error).toContainText(message);
    });
  }

  test('protected pages redirect to login when signed out', async ({ page }) => {
    await page.goto('/inventory.html');
    await expect(new LoginPage(page).error).toContainText('only access');
  });
});
