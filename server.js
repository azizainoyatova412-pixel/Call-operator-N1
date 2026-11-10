import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { Order } from './models/Order.js';
import { Product } from './models/Product.js';

dotenv.config();

export const app = express();
app.use(express.json({ limit: '1mb' }));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function secureValueMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Ma’lumotlar bazasi hozircha mavjud emas.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!secureValueMatches(process.env.ADMIN_API_KEY, req.get('x-admin-key'))) {
    return res.status(401).json({ error: 'Admin kaliti noto‘g‘ri yoki sozlanmagan.' });
  }
  next();
}

async function findProduct({ productId, productName }) {
  if (typeof productId === 'string' && productId.trim()) {
    if (!mongoose.isValidObjectId(productId)) return { invalidId: true };
    return { product: await Product.findById(productId) };
  }

  if (typeof productName !== 'string' || !productName.trim()) {
    return { missingName: true };
  }

  const name = productName.trim();
  const exact = await Product.findOne({
    name: new RegExp(`^${escapeRegex(name)}$`, 'i')
  });
  if (exact) return { product: exact };

  const matches = await Product.find({
    name: new RegExp(escapeRegex(name), 'i')
  }).limit(2);

  if (matches.length > 1) return { ambiguous: true };
  return { product: matches[0] ?? null };
}

function formatProduct(product) {
  const description = product.description.replace(/\s+/g, ' ').trim();
  return `Mahsulot: ${product.name}. Narxi: ${product.price.toLocaleString('uz-UZ')} so'm. ${description} ${
    product.stock > 0
      ? `Omborda ${product.stock} dona bor.`
      : 'Hozirda omborda mavjud emas.'
  }`;
}

function getToolArguments(call) {
  let args = call.function?.arguments ?? call.arguments ?? {};
  if (typeof args === 'string') args = JSON.parse(args);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new SyntaxError('Tool argumentlari obyekt bo‘lishi kerak.');
  }
  return args;
}

async function getProductDetails(args) {
  const lookup = await findProduct({
    productId: args.productId ?? args.product_id,
    productName: args.productName ?? args.product_name
  });

  if (lookup.invalidId) return 'Mahsulot IDsi noto‘g‘ri.';
  if (lookup.missingName) return 'Mahsulot nomi yoki IDsi ko‘rsatilmagan.';
  if (lookup.ambiguous) {
    return 'Bir nechta mos mahsulot topildi. Mijozdan mahsulotning to‘liq nomini aniqlashtiring.';
  }
  if (!lookup.product) return 'Kechirasiz, bunday mahsulot topilmadi.';
  return formatProduct(lookup.product);
}

async function createOrder(args, toolCallId) {
  const existingOrder = await Order.findOne({ tool_call_id: toolCallId });
  if (existingOrder) {
    return `Bu buyurtma avval qayd etilgan. ${existingOrder.product_name}, ${existingOrder.quantity} dona. Mijozga tez orada operator bog‘lanishini ayting.`;
  }

  const customerName = args.customerName ?? args.customer_name;
  const customerPhone = args.customerPhone ?? args.customer_phone;
  const deliveryAddress = args.deliveryAddress ?? args.delivery_address;
  const quantity = args.quantity ?? 1;

  if (typeof customerName !== 'string' || !customerName.trim() || customerName.trim().length > 120) {
    return 'Buyurtma uchun mijozning to‘liq ismi kerak.';
  }
  if (typeof customerPhone !== 'string' || !customerPhone.trim()) {
    return 'Buyurtma uchun telefon raqami kerak.';
  }
  const digits = customerPhone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(customerPhone.trim()) || digits.length < 7 || digits.length > 15) {
    return 'Telefon raqami noto‘g‘ri ko‘rinishda. Iltimos, raqamni tekshiring.';
  }
  if (typeof deliveryAddress !== 'string' || !deliveryAddress.trim() || deliveryAddress.trim().length > 500) {
    return 'Buyurtma uchun yetkazib berish manzili kerak.';
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return 'Mahsulot miqdori 1 dan 50 gacha butun son bo‘lishi kerak.';
  }

  const lookup = await findProduct({
    productId: args.productId ?? args.product_id,
    productName: args.productName ?? args.product_name
  });
  if (lookup.invalidId) return 'Mahsulot IDsi noto‘g‘ri.';
  if (lookup.missingName) return 'Buyurtma uchun mahsulot nomi yoki IDsi kerak.';
  if (lookup.ambiguous) {
    return 'Bir nechta mos mahsulot topildi. Buyurtmadan oldin mahsulotning to‘liq nomini aniqlashtiring.';
  }
  if (!lookup.product) return 'Mahsulot topilmadi, buyurtma yaratilmadi.';

  const product = await Product.findOneAndUpdate(
    { _id: lookup.product._id, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { new: true }
  );
  if (!product) return 'Mahsulot omborda yetarli emas, buyurtma yaratilmadi.';

  try {
    const order = await Order.create({
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      delivery_address: deliveryAddress.trim(),
      product_id: product._id,
      product_name: product.name,
      quantity,
      unit_price: product.price,
      tool_call_id: toolCallId
    });

    console.log(`Yangi buyurtma qayd etildi: ${order._id}`);
    return `Buyurtma qabul qilindi. ${product.name}, ${quantity} dona. Mijozga tez orada operator bog‘lanishini ayting.`;
  } catch (error) {
    try {
      await Product.updateOne({ _id: product._id }, { $inc: { stock: quantity } });
    } catch (rollbackError) {
      console.error('Buyurtma saqlanmadi va zaxirani tiklashda xatolik yuz berdi:', rollbackError);
    }
    if (error?.code === 11000) {
      const duplicateOrder = await Order.findOne({ tool_call_id: toolCallId });
      if (duplicateOrder) {
        return `Bu buyurtma avval qayd etilgan. ${duplicateOrder.product_name}, ${duplicateOrder.quantity} dona. Mijozga tez orada operator bog‘lanishini ayting.`;
      }
    }
    throw error;
  }
}

app.get('/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not_ready' });
});

app.get('/admin', (_req, res) => {
  res.sendFile(fileURLToPath(new URL('./public/admin.html', import.meta.url)));
});

app.get('/api/products', requireDatabase, async (_req, res) => {
  try {
    const products = await Product.find().sort({ name: 1 }).lean();
    return res.json({ products });
  } catch (error) {
    console.error('Mahsulotlarni olishda xatolik:', error);
    return res.status(500).json({ error: 'Mahsulotlarni olishda xatolik yuz berdi.' });
  }
});

app.post('/api/products', requireAdmin, requireDatabase, async (req, res) => {
  const { name, price, description, stock } = req.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 160 ||
    typeof description !== 'string' || !description.trim() || description.trim().length > 2000 ||
    typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
    !Number.isInteger(stock) || stock < 0
  ) {
    return res.status(400).json({
      error: 'name, description, manfiy bo‘lmagan price va butun stock qiymatlari talab qilinadi.'
    });
  }

  try {
    const product = await Product.create({
      name: name.trim(),
      price,
      description: description.trim(),
      stock
    });
    return res.status(201).json({ product });
  } catch (error) {
    console.error('Mahsulot yaratishda xatolik:', error);
    return res.status(500).json({ error: 'Mahsulotni saqlashda xatolik yuz berdi.' });
  }
});

app.get('/api/orders', requireAdmin, requireDatabase, async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'limit 1 dan 100 gacha butun son bo‘lishi kerak.' });
  }

  try {
    const orders = await Order.find().sort({ created_at: -1 }).limit(limit).lean();
    return res.json({ orders });
  } catch (error) {
    console.error('Buyurtmalarni olishda xatolik:', error);
    return res.status(500).json({ error: 'Buyurtmalarni olishda xatolik yuz berdi.' });
  }
});

app.patch('/api/orders/:id/status', requireAdmin, requireDatabase, async (req, res) => {
  const statuses = ['Yangi', 'Yetkazilmoqda', 'Yakunlandi', 'Bekor qilindi'];
  const { status } = req.body ?? {};
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Buyurtma IDsi noto‘g‘ri.' });
  }
  if (!statuses.includes(status)) {
    return res.status(400).json({ error: `status quyidagilardan biri bo‘lishi kerak: ${statuses.join(', ')}.` });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi.' });
    return res.json({ order });
  } catch (error) {
    console.error('Buyurtma holatini yangilashda xatolik:', error);
    return res.status(500).json({ error: 'Buyurtma holatini yangilashda xatolik yuz berdi.' });
  }
});

app.use('/webhook', (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  const provided = req.get('x-vapi-secret');
  if (!secureValueMatches(secret, provided)) return res.sendStatus(401);
  next();
});

app.post('/webhook/vapi', async (req, res) => {
  const { message } = req.body ?? {};
  if (message?.type !== 'tool-calls') return res.sendStatus(200);

  const calls = message.toolCallList ?? message.toolCalls;
  if (!Array.isArray(calls) || calls.length === 0) {
    return res.status(400).json({ error: 'Tool chaqiruvlari topilmadi.' });
  }

  if (mongoose.connection.readyState !== 1) {
    const results = [];
    for (const call of calls) {
      const toolCallId = call.id ?? call.toolCallId;
      if (typeof toolCallId !== 'string' || !toolCallId) {
        return res.status(400).json({ error: 'Tool chaqiruvida ID ko‘rsatilmagan.' });
      }
      results.push({
        toolCallId,
        error: 'Ma’lumotlar bazasi hozircha mavjud emas. Iltimos, birozdan keyin qayta urinib ko‘ring.'
      });
    }
    return res.json({ results });
  }

  try {
    const results = [];
    for (const call of calls) {
      const toolCallId = call.id ?? call.toolCallId;
      if (typeof toolCallId !== 'string' || !toolCallId) {
        return res.status(400).json({ error: 'Tool chaqiruvida ID ko‘rsatilmagan.' });
      }

      let result;
      try {
        const args = getToolArguments(call);
        const name = call.function?.name ?? call.name;
        if (name === 'get_product_details') {
          result = await getProductDetails(args);
        } else if (name === 'create_order') {
          result = await createOrder(args, toolCallId);
        } else {
          result = `Noma'lum funksiya: ${String(name ?? 'ko‘rsatilmagan')}.`;
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          results.push({
            toolCallId,
            error: 'Tool argumentlarini o‘qib bo‘lmadi. Iltimos, ma’lumotlarni qayta tekshiring.'
          });
          continue;
        } else {
          console.error(`Vapi tool bajarilmadi (${toolCallId}):`, error);
          results.push({
            toolCallId,
            error: 'Xizmatda vaqtinchalik xatolik yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.'
          });
          continue;
        }
      }

      results.push({ toolCallId, result: result.replace(/\s+/g, ' ').trim() });
    }

    return res.json({ results });
  } catch (error) {
    console.error('Vapi webhook xatosi:', error);
    return res.status(500).json({ error: 'Ichki server xatoligi.' });
  }
});

export async function startServer() {
  const { MONGO_URI, WEBHOOK_SECRET, ADMIN_API_KEY } = process.env;
  if (!MONGO_URI) throw new Error('MONGO_URI muhit o‘zgaruvchisi sozlanmagan.');
  if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET muhit o‘zgaruvchisi sozlanmagan.');
  if (!ADMIN_API_KEY) throw new Error('ADMIN_API_KEY muhit o‘zgaruvchisi sozlanmagan.');

  await mongoose.connect(MONGO_URI);
  console.log('MongoDB ulandi.');

  const productCount = await Product.countDocuments();
  if (productCount === 0 && process.env.SEED_DEMO_PRODUCT === 'true') {
    await Product.create({
      name: 'Simsiz quloqchin X-200',
      price: 250000,
      description: 'Bluetooth 5.3, 8 soatgacha zaryad ushlaydi, shovqinni to‘suvchi zamonaviy quloqchin.',
      stock: 10
    });
    console.log('Demo mahsulot qo‘shildi.');
  } else if (productCount === 0) {
    console.warn('Bazada mahsulot yo‘q. Savdo boshlashdan oldin mahsulotlarni qo‘shing.');
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 1–65535 oralig‘idagi butun son bo‘lishi kerak.');
  }

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Server ${port}-portda ishlamoqda.`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(async (error) => {
    console.error('Server ishga tushmadi:', error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
