import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';

process.env.WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.ADMIN_API_KEY ??= 'test-admin-key';
mongoose.set('bufferTimeoutMS', 100);

const [{ app }, { Product }, { Order }] = await Promise.all([
  import('../server.js'),
  import('../models/Product.js'),
  import('../models/Order.js')
]);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('health endpoint reports database readiness', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready' });
});

test('Vapi webhook requires its configured secret', async () => {
  const response = await fetch(`${baseUrl}/webhook/vapi`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vapi-secret': 'incorrect'
    },
    body: JSON.stringify({ message: { type: 'status-update' } })
  });
  assert.equal(response.status, 401);
});

test('Vapi responds with its expected error result when database is unavailable', async () => {
  const response = await fetch(`${baseUrl}/webhook/vapi`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vapi-secret': process.env.WEBHOOK_SECRET
    },
    body: JSON.stringify({
      message: {
        type: 'tool-calls',
        toolCallList: [{
          id: 'test-call',
          function: {
            name: 'get_product_details',
            arguments: { productName: 'X-200' }
          }
        }]
      }
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].toolCallId, 'test-call');
  assert.equal(typeof body.results[0].error, 'string');
  assert.equal('result' in body.results[0], false);
});

test('Vapi product lookup and confirmed order call return working results', async (context) => {
  const originalProductFindOne = Product.findOne;
  const originalProductFindOneAndUpdate = Product.findOneAndUpdate;
  const originalOrderFindOne = Order.findOne;
  const originalOrderCreate = Order.create;
  const product = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Simsiz quloqchin X-200',
    price: 250000,
    description: 'Bluetooth 5.3',
    stock: 10
  };
  let savedOrder;
  let reservedQuantity;

  Product.findOne = async () => product;
  Product.findOneAndUpdate = async (_filter, update) => {
    reservedQuantity = -update.$inc.stock;
    return { ...product, stock: product.stock - reservedQuantity };
  };
  Order.findOne = async () => savedOrder ?? null;
  Order.create = async (data) => {
    savedOrder = { ...data, _id: new mongoose.Types.ObjectId() };
    return savedOrder;
  };
  context.after(() => {
    Product.findOne = originalProductFindOne;
    Product.findOneAndUpdate = originalProductFindOneAndUpdate;
    Order.findOne = originalOrderFindOne;
    Order.create = originalOrderCreate;
  });

  const response = await fetch(`${baseUrl}/webhook/vapi`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vapi-secret': process.env.WEBHOOK_SECRET
    },
    body: JSON.stringify({
      message: {
        type: 'tool-calls',
        toolCallList: [
          {
            id: 'product-call',
            function: {
              name: 'get_product_details',
              arguments: { productName: 'X-200' }
            }
          },
          {
            id: 'order-call',
            function: {
              name: 'create_order',
              arguments: {
                customerName: 'Ali Valiyev',
                customerPhone: '+998 90 123 45 67',
                deliveryAddress: 'Toshkent, Chilonzor',
                productName: 'X-200',
                quantity: 2
              }
            }
          }
        ]
      }
    })
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].toolCallId, 'product-call');
  assert.match(body.results[0].result, /Simsiz quloqchin X-200/);
  assert.equal(body.results[1].toolCallId, 'order-call');
  assert.match(body.results[1].result, /Buyurtma qabul qilindi/);
  assert.equal(savedOrder.product_id, product._id);
  assert.equal(savedOrder.quantity, 2);
  assert.equal(reservedQuantity, 2);
});

test('admin endpoints reject requests without the admin key', async () => {
  const response = await fetch(`${baseUrl}/api/orders`);
  assert.equal(response.status, 401);
});

test('admin endpoints report unavailable database after authentication', async () => {
  const response = await fetch(`${baseUrl}/api/orders`, {
    headers: { 'x-admin-key': process.env.ADMIN_API_KEY }
  });
  assert.equal(response.status, 503);
});

test('product and order schemas reject invalid values', async () => {
  const product = new Product({ name: '', price: -1, description: '', stock: 1.5 });
  await assert.rejects(product.validate());

  const order = new Order({
    customer_name: 'Test',
    customer_phone: '+998901234567',
    delivery_address: 'Test manzil',
    product_name: 'Test',
    quantity: 1.5,
    unit_price: 1
  });
  await assert.rejects(order.validate());
});
