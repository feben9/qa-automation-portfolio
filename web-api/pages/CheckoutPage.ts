import { Page, Locator } from '@playwright/test';

// Covers the cart, the customer-details step and the order overview.
export class CheckoutPage {
  readonly cartItems: Locator;
  readonly error: Locator;
  readonly subtotal: Locator;
  readonly tax: Locator;
  readonly total: Locator;
  readonly complete: Locator;

  constructor(private readonly page: Page) {
    this.cartItems = page.getByTestId('inventory-item');
    this.error = page.getByTestId('error');
    this.subtotal = page.getByTestId('subtotal-label');
    this.tax = page.getByTestId('tax-label');
    this.total = page.getByTestId('total-label');
    this.complete = page.getByTestId('complete-header');
  }

  async start() {
    await this.page.getByTestId('checkout').click();
  }

  async fillDetails(first: string, last: string, postcode: string) {
    await this.page.getByTestId('firstName').fill(first);
    await this.page.getByTestId('lastName').fill(last);
    await this.page.getByTestId('postalCode').fill(postcode);
    await this.page.getByTestId('continue').click();
  }

  async finish() {
    await this.page.getByTestId('finish').click();
  }

  /** Reads a money label such as "Item total: $39.98" as a number. */
  static amount(text: string | null): number {
    const match = text?.match(/\$([\d.]+)/);
    if (!match) throw new Error(`No amount in "${text}"`);
    return Number(match[1]);
  }
}
