import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { InventoryPage } from '../../pages/InventoryPage';
import { CheckoutPage } from '../../pages/CheckoutPage';

test.beforeEach(async ({ page }) => {
  const login = new LoginPage(page);
  await login.open();
  await login.login('standard_user', 'secret_sauce');
  await new InventoryPage(page).expectLoaded();
});

test('sorting by price is actually ordered', async ({ page }) => {
  const inventory = new InventoryPage(page);
  await inventory.sortBy('lohi');
  const asc = await inventory.prices();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));

  await inventory.sortBy('hilo');
  const desc = await inventory.prices();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
});

test('checkout totals reconcile: item total + tax = total', async ({ page }) => {
  const inventory = new InventoryPage(page);
  const picks = ['Sauce Labs Backpack', 'Sauce Labs Bike Light'];
  for (const name of picks) await inventory.addToCart(name);
  await expect(inventory.cartBadge).toHaveText(String(picks.length));

  // Capture the list prices so the overview can be checked against them.
  const listed: number[] = [];
  for (const name of picks) {
    const text = await inventory.item(name).getByTestId('inventory-item-price').textContent();
    listed.push(CheckoutPage.amount(text));
  }

  await inventory.openCart();
  const checkout = new CheckoutPage(page);
  await expect(checkout.cartItems).toHaveCount(picks.length);
  await checkout.start();
  await checkout.fillDetails('Test', 'User', '1000');

  const subtotal = CheckoutPage.amount(await checkout.subtotal.textContent());
  const tax = CheckoutPage.amount(await checkout.tax.textContent());
  const total = CheckoutPage.amount(await checkout.total.textContent());

  const cents = (n: number) => Math.round(n * 100);
  expect(cents(subtotal)).toBe(cents(listed.reduce((a, b) => a + b, 0)));
  expect(cents(subtotal + tax)).toBe(cents(total));

  await checkout.finish();
  await expect(checkout.complete).toHaveText('Thank you for your order!');
});

test('checkout refuses missing customer details', async ({ page }) => {
  const inventory = new InventoryPage(page);
  await inventory.addToCart('Sauce Labs Onesie');
  await inventory.openCart();
  const checkout = new CheckoutPage(page);
  await checkout.start();
  await checkout.fillDetails('', 'User', '1000');
  await expect(checkout.error).toContainText('First Name is required');
});
