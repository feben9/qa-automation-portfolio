import { Page, Locator, expect } from '@playwright/test';

export class InventoryPage {
  readonly title: Locator;
  readonly items: Locator;
  readonly cartBadge: Locator;
  readonly sort: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId('title');
    this.items = page.getByTestId('inventory-item');
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.sort = page.getByTestId('product-sort-container');
  }

  async expectLoaded() {
    await expect(this.title).toHaveText('Products');
  }

  item(name: string): Locator {
    return this.items.filter({ hasText: name });
  }

  async addToCart(name: string) {
    await this.item(name).getByRole('button', { name: 'Add to cart' }).click();
  }

  async prices(): Promise<number[]> {
    const texts = await this.page.getByTestId('inventory-item-price').allTextContents();
    return texts.map((t) => Number(t.replace('$', '')));
  }

  async sortBy(option: 'lohi' | 'hilo' | 'az' | 'za') {
    await this.sort.selectOption(option);
  }

  async openCart() {
    await this.page.getByTestId('shopping-cart-link').click();
  }
}
