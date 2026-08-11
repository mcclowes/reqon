import { describe, expect, it } from 'vitest';
import { fromFile } from 'vague-lang';

describe('Vague OpenAPI integration', () => {
  it('generates mock-server data from imported OpenAPI constraints', async () => {
    const data = await fromFile<Record<string, unknown[]>>(
      './examples/mock-server-demo/mock-data.vague',
      { seed: 42 }
    );

    expect(data.products).toHaveLength(20);
    expect(data.orders).toHaveLength(20);
    expect(data.inventory).toHaveLength(20);

    const product = data.products[0] as Record<string, unknown>;
    expect(product.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(product.category).toEqual(expect.stringMatching(/^(electronics|clothing|home|sports)$/));
    expect(product.price as number).toBeGreaterThanOrEqual(0.01);
    expect(product.price as number).toBeLessThanOrEqual(999.99);

    const order = data.orders[0] as Record<string, unknown>;
    expect(order.status).toEqual(expect.stringMatching(/^(pending|processing|shipped|delivered)$/));
    expect(order.createdAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    const inventoryItem = data.inventory[0] as Record<string, unknown>;
    expect(inventoryItem.quantity as number).toBeGreaterThanOrEqual(0);
  });
});
