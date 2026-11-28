import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';

process.env.WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.ADMIN_API_KEY ??= 'test-admin-key';
mongoose.set('bufferTimeoutMS', 100);

const [{ app }, { Product }, { Order }, { Call }] = await Promise.all([
  import('../server.js'),
  import('../models/Product.js'),
  import('../models/Order.js'),
  import('../models/Call.js')
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

test('ping endpoint returns lightweight OK for cron jobs', async () => {
  const response = await fetch(`${baseUrl}/ping`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'OK');
});

test('health endpoint reports database readiness', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready' });
});

test('admin page is served by the application', async () => {
  const response = await fetch(`${baseUrl}/admin`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /Ovozli operator boshqaruv paneli/);
  assert.match(html, /ADMIN_API_KEY/);
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
  const originalReadyState = mongoose.connection.readyState;
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
  const savedOrders = new Map();
  const reservedQuantities = [];

  mongoose.connection.readyState = 1;
  Product.findOne = async () => product;
  Product.findOneAndUpdate = async (_filter, update) => {
    const quantity = -update.$inc.stock;
    reservedQuantities.push(quantity);
    return { ...product, stock: product.stock - reservedQuantities.reduce((sum, item) => sum + item, 0) };
  };
  Order.findOne = async ({ tool_call_id: toolCallId }) => savedOrders.get(toolCallId) ?? null;
  Order.create = async (data) => {
    const order = { ...data, _id: new mongoose.Types.ObjectId() };
    savedOrders.set(data.tool_call_id, order);
    return order;
  };
  context.after(() => {
    mongoose.connection.readyState = originalReadyState;
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
          },
          {
            id: 'legacy-order-call',
            function: {
              name: 'creat_order',
              arguments: {
                customerName: 'Vali Aliyev',
                customerPhone: '+998 90 111 22 33',
                deliveryAddress: 'Toshkent, Yunusobod',
                productName: 'X-200',
                quantity: 1
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
  assert.equal(body.results[2].toolCallId, 'legacy-order-call');
  assert.match(body.results[2].result, /Buyurtma qabul qilindi/);
  assert.equal(savedOrders.get('order-call').product_id, product._id);
  assert.equal(savedOrders.get('order-call').quantity, 2);
  assert.equal(savedOrders.get('legacy-order-call').quantity, 1);
  assert.deepEqual(reservedQuantities, [2, 1]);
});

test('admin endpoints reject requests without the admin key', async () => {
  const response = await fetch(`${baseUrl}/api/orders`);
  assert.equal(response.status, 401);
});

test('auth verify endpoint validates admin key', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/auth/verify`);
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${baseUrl}/api/auth/verify`, {
    headers: { 'x-admin-key': process.env.ADMIN_API_KEY }
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { authenticated: true });
});

test('admin endpoints report unavailable database after authentication', async () => {
  const response = await fetch(`${baseUrl}/api/orders`, {
    headers: { 'x-admin-key': process.env.ADMIN_API_KEY }
  });
  assert.equal(response.status, 503);
});

test('orders API filters, paginates and returns period statistics', async (context) => {
  const originalReadyState = mongoose.connection.readyState;
  const originalFind = Order.find;
  const originalCountDocuments = Order.countDocuments;
  const originalAggregate = Order.aggregate;
  const requested = {};

  mongoose.connection.readyState = 1;
  Order.find = (query) => {
    requested.query = query;
    return {
      sort() { return this; },
      skip(value) { requested.skip = value; return this; },
      limit(value) { requested.limit = value; return this; },
      lean: async () => [{ _id: 'latest-order' }]
    };
  };
  Order.countDocuments = async () => 45;
  Order.aggregate = async (pipeline) => {
    requested.statsQuery = pipeline[0].$match;
    return [{ total: 45, pending: 4, completed: 30, revenue: 1250000 }];
  };
  context.after(() => {
    mongoose.connection.readyState = originalReadyState;
    Order.find = originalFind;
    Order.countDocuments = originalCountDocuments;
    Order.aggregate = originalAggregate;
  });

  const response = await fetch(
    `${baseUrl}/api/orders?page=3&limit=10&search=Ali.*&status=Yangi&from=2026-11-22T00%3A00%3A00.000Z&to=2026-11-22T23%3A59%3A59.999Z`,
    { headers: { 'x-admin-key': process.env.ADMIN_API_KEY } }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requested.skip, 20);
  assert.equal(requested.limit, 10);
  assert.equal(requested.query.status, 'Yangi');
  assert.equal(requested.query.$or.length, 4);
  assert.equal(requested.query.$or[0].customer_name.source, 'Ali\\.\\*');
  assert.equal(requested.query.created_at.$gte.toISOString(), '2026-11-22T00:00:00.000Z');
  assert.deepEqual(requested.statsQuery.created_at, requested.query.created_at);
  assert.equal(body.total, 45);
  assert.equal(body.pages, 5);
  assert.deepEqual(body.stats, { total: 45, pending: 4, completed: 30, revenue: 1250000 });
});

test('orders API rejects invalid dates and reversed date ranges', async () => {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  try {
    const headers = { 'x-admin-key': process.env.ADMIN_API_KEY };
    for (const url of [
      '/api/orders?from=not-a-date',
      '/api/orders?from=2026-11-23T00%3A00%3A00.000Z&to=2026-11-22T00%3A00%3A00.000Z'
    ]) {
      const response = await fetch(`${baseUrl}${url}`, { headers });
      assert.equal(response.status, 400);
    }
  } finally {
    mongoose.connection.readyState = originalReadyState;
  }
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

test('end-of-call-report stores call in Call collection and links with order', async (context) => {
  const originalReadyState = mongoose.connection.readyState;
  const originalCallFindOneAndUpdate = Call.findOneAndUpdate;
  const originalOrderFindOne = Order.findOne;

  mongoose.connection.readyState = 1;
  let savedCallFilter = null;
  let savedCallUpdate = null;

  Call.findOneAndUpdate = async (filter, update) => {
    savedCallFilter = filter;
    savedCallUpdate = update;
    return { ...update.$set, _id: new mongoose.Types.ObjectId() };
  };

  const mockOrder = {
    _id: new mongoose.Types.ObjectId(),
    call_id: 'call_test_123',
    save: async () => mockOrder
  };
  Order.findOne = async () => mockOrder;

  context.after(() => {
    mongoose.connection.readyState = originalReadyState;
    Call.findOneAndUpdate = originalCallFindOneAndUpdate;
    Order.findOne = originalOrderFindOne;
  });

  const response = await fetch(`${baseUrl}/webhook/vapi`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vapi-secret': process.env.WEBHOOK_SECRET
    },
    body: JSON.stringify({
      message: {
        type: 'end-of-call-report',
        call: { id: 'call_test_123', cost: 0.025 },
        customer: { number: '+998901234567', name: 'Nodir' },
        durationSeconds: 75,
        endedReason: 'customer-ended-call',
        transcript: 'Salom, quloqchin olmoqchiman',
        summary: 'Mijoz quloqchin so‘radi va buyurtma berdi.'
      }
    })
  });

  assert.equal(response.status, 200);
  assert.equal(savedCallFilter.call_id, 'call_test_123');
  assert.equal(savedCallUpdate.$set.duration_seconds, 75);
  assert.equal(savedCallUpdate.$set.ended_reason, 'customer-ended-call');
  assert.equal(savedCallUpdate.$set.summary, 'Mijoz quloqchin so‘radi va buyurtma berdi.');
  assert.equal(savedCallUpdate.$set.order_id, mockOrder._id);
});

test('calls API returns paginated calls and storage endpoints work', async (context) => {
  const originalReadyState = mongoose.connection.readyState;
  const originalCallFind = Call.find;
  const originalCallCount = Call.countDocuments;

  mongoose.connection.readyState = 1;

  Call.find = () => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    lean: async () => [{ call_id: 'call_test_123', summary: 'Mijoz buyurtma berdi' }]
  });
  Call.countDocuments = async () => 1;

  context.after(() => {
    mongoose.connection.readyState = originalReadyState;
    Call.find = originalCallFind;
    Call.countDocuments = originalCallCount;
  });

  const headers = { 'x-admin-key': process.env.ADMIN_API_KEY };
  const callsRes = await fetch(`${baseUrl}/api/calls?page=1&limit=10`, { headers });
  assert.equal(callsRes.status, 200);
  const callsBody = await callsRes.json();
  assert.equal(callsBody.total, 1);
  assert.equal(callsBody.calls[0].call_id, 'call_test_123');

  const storageRes = await fetch(`${baseUrl}/api/recordings/storage`, { headers });
  assert.equal(storageRes.status, 200);
  const storageBody = await storageRes.json();
  assert.equal(typeof storageBody.count, 'number');
  assert.equal(storageBody.retentionDays, 60);

  const cleanupRes = await fetch(`${baseUrl}/api/recordings/cleanup`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ retentionDays: 60 })
  });
  assert.equal(cleanupRes.status, 200);
  const cleanupBody = await cleanupRes.json();
  assert.equal(typeof cleanupBody.deletedCount, 'number');
});
