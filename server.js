import { timingSafeEqual } from 'node:crypto';
import { setServers } from 'node:dns';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { Order } from './models/Order.js';
import { Product } from './models/Product.js';

dotenv.config();

function formatUzPhone(phone) {
  if (typeof phone !== 'string') return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9) {
    return `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
  }
  if (digits.length === 12 && digits.startsWith('998')) {
    return `+998 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  return phone.trim();
}

async function sendTelegramNotification(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const total = ((order.unit_price || 0) * (order.quantity || 1)).toLocaleString('uz-UZ');
  const text = `🔔 <b>Yangi buyurtma qabul qilindi!</b> (AI Call Operator)\n\n` +
    `👤 <b>Mijoz:</b> ${order.customer_name}\n` +
    `📞 <b>Telefon:</b> ${order.customer_phone}\n` +
    `📍 <b>Manzil:</b> ${order.delivery_address}\n` +
    `📦 <b>Mahsulot:</b> ${order.product_name} (${order.quantity} dona)\n` +
    `💰 <b>Summa:</b> ${total} so'm\n` +
    `🕒 <b>Vaqt:</b> ${new Date().toLocaleString('uz-UZ')}`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Telegramga xabar yuborishda xatolik:', errText);
    }
  } catch (err) {
    console.error('Telegram notification xatosi:', err.message);
  }
}

async function sendTelegramCallReport(report) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const durationSec = Math.round(report.durationSeconds || report.duration || 0);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const durationText = minutes > 0 ? `${minutes} daqiqa ${seconds} soniya` : `${seconds} soniya`;

  const summary = report.summary || report.analysis?.summary || 'Xulosa shakllanmadi';
  const recordingUrl = report.recordingUrl || report.stereoRecordingUrl;
  const customerNumber = report.customer?.number || report.call?.customer?.number || 'Noma\'lum';
  const endedReason = report.endedReason || 'Yakunlandi';

  let text = `📞 <b>Qo‘ng‘iroq yakunlandi</b> (AI Call Operator)\n\n` +
    `👤 <b>Mijoz raqami:</b> ${customerNumber}\n` +
    `⏱ <b>Davomiyligi:</b> ${durationText}\n` +
    `📌 <b>Tugash sababi:</b> ${endedReason}\n\n` +
    `📝 <b>Suhbat xulosasi:</b>\n${summary}\n\n`;

  if (recordingUrl) {
    text += `🎙 <a href="${recordingUrl}">Qo‘ng‘iroq audio yozuvini tinglash</a>\n\n`;
  }
  text += `🕒 <b>Vaqt:</b> ${new Date().toLocaleString('uz-UZ')}`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    console.error('Telegram call report xatosi:', err.message);
  }
}

export const app = express();

// Asosiy xavfsizlik headerlari
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

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
  const adminKey = process.env.ADMIN_API_KEY || 'YOUknow_youknowwhere';
  if (!secureValueMatches(adminKey, req.get('x-admin-key'))) {
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

function numberToUzWords(num) {
  if (typeof num !== 'number' || !Number.isFinite(num) || num < 0) return String(num);
  if (num === 0) return 'nol';

  const units = ['', 'bir', 'ikki', 'uch', 'to‘rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to‘qqiz'];
  const tens = ['', 'o‘n', 'yigirma', 'o‘ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to‘qson'];
  const scales = ['', 'ming', 'million', 'milliard'];

  function convertGroup(n) {
    let res = '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0) res += `${units[h]} yuz `;
    if (t > 0) res += `${tens[t]} `;
    if (u > 0) res += `${units[u]} `;
    return res.trim();
  }

  let s = '';
  let scaleIdx = 0;
  let remaining = Math.floor(num);

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkStr = convertGroup(chunk);
      const scaleStr = scales[scaleIdx] ? ` ${scales[scaleIdx]}` : '';
      s = `${chunkStr}${scaleStr} ${s}`.trim();
    }
    remaining = Math.floor(remaining / 1000);
    scaleIdx++;
  }

  return s.trim();
}

function formatProduct(product) {
  const description = product.description.replace(/\s+/g, ' ').trim();
  const priceInWords = numberToUzWords(product.price);
  return `Mahsulot: ${product.name}. Narxi: ${priceInWords} so'm. ${description} ${product.stock > 0
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

async function createOrder(args, toolCallId, callId) {
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
      customer_phone: formatUzPhone(customerPhone),
      delivery_address: deliveryAddress.trim(),
      product_id: product._id,
      product_name: product.name,
      quantity,
      unit_price: product.price,
      tool_call_id: toolCallId,
      call_id: callId
    });

    console.log(`Yangi buyurtma qayd etildi: ${order._id}`);
    sendTelegramNotification(order).catch(() => { });
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

async function listProducts() {
  const products = await Product.find({ stock: { $gt: 0 } }).sort({ name: 1 }).limit(10).lean();
  if (!products || products.length === 0) {
    return 'Hozirda omborda tayyor mahsulotlar qolmagan. Tez orada yangi partiya kelishi kutilmoqda.';
  }
  const items = products.map((p) => `${p.name} - narxi ${numberToUzWords(p.price)} so'm`).join('; ');
  return `Hozirda sotuvda quyidagi mahsulotlarimiz mavjud: ${items}. Qaysi biri sizni qiziqtiryapti?`;
}

async function checkOrderStatus(args) {
  const customerPhone = args.customerPhone ?? args.customer_phone;
  if (typeof customerPhone !== 'string' || !customerPhone.trim()) {
    return 'Buyurtma holatini bilish uchun telefon raqamingizni ayting.';
  }
  const digits = customerPhone.replace(/\D/g, '');
  if (digits.length < 7) {
    return 'Iltimos, telefon raqamingizni to‘liqroq ayting.';
  }

  const lastSeven = digits.slice(-7);
  const regex = new RegExp(escapeRegex(lastSeven) + '$');

  const order = await Order.findOne({ customer_phone: { $regex: regex } }).sort({ created_at: -1 });
  if (!order) {
    return 'Ushbu telefon raqami bo‘yicha buyurtma topilmadi. Raqam to‘g‘ri aytilganini tekshiring yoki yangi buyurtma berishingiz mumkin.';
  }

  const date = new Date(order.created_at).toLocaleDateString('uz-UZ');
  return `Buyurtmangiz topildi: ${order.product_name}, ${order.quantity} dona. Holati: ${order.status}. Qayd etilgan sana: ${date}. Savollaringiz bo‘lsa, bemalol so‘rashingiz mumkin.`;
}

app.get('/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not_ready' });
});

app.get('/', (_req, res) => {
  res.sendFile(fileURLToPath(new URL('./public/index.html', import.meta.url)));
});

app.get('/admin', (_req, res) => {
  res.sendFile(fileURLToPath(new URL('./public/admin.html', import.meta.url)));
});

app.get('/api/auth/verify', requireAdmin, (_req, res) => {
  return res.json({ authenticated: true });
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

app.put('/api/products/:id', requireAdmin, requireDatabase, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Mahsulot IDsi noto‘g‘ri.' });
  }
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
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { name: name.trim(), price, description: description.trim(), stock },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi.' });
    return res.json({ product });
  } catch (error) {
    console.error('Mahsulotni yangilashda xatolik:', error);
    return res.status(500).json({ error: 'Mahsulotni yangilashda xatolik yuz berdi.' });
  }
});

app.delete('/api/products/:id', requireAdmin, requireDatabase, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Mahsulot IDsi noto‘g‘ri.' });
  }
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi.' });
    return res.json({ message: 'Mahsulot o‘chirildi.', product });
  } catch (error) {
    console.error('Mahsulotni o‘chirishda xatolik:', error);
    return res.status(500).json({ error: 'Mahsulotni o‘chirishda xatolik yuz berdi.' });
  }
});

app.get('/api/orders', requireAdmin, requireDatabase, async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  const page = Number(req.query.page ?? 1);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'limit 1 dan 100 gacha butun son bo‘lishi kerak.' });
  }
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: 'page 1 dan katta butun son bo‘lishi kerak.' });
  }

  const dateFilter = {};
  if (req.query.from) {
    const from = new Date(req.query.from);
    if (!Number.isFinite(from.getTime())) {
      return res.status(400).json({ error: 'from sanasi noto‘g‘ri.' });
    }
    dateFilter.$gte = from;
  }
  if (req.query.to) {
    const to = new Date(req.query.to);
    if (!Number.isFinite(to.getTime())) {
      return res.status(400).json({ error: 'to sanasi noto‘g‘ri.' });
    }
    dateFilter.$lte = to;
  }

  if (dateFilter.$gte && dateFilter.$lte && dateFilter.$gte > dateFilter.$lte) {
    return res.status(400).json({ error: 'Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas.' });
  }

  const baseQuery = {};
  if (Object.keys(dateFilter).length) {
    baseQuery.created_at = dateFilter;
  }
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 120) {
    return res.status(400).json({ error: 'Qidiruv matni 120 belgidan oshmasligi kerak.' });
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    baseQuery.$or = [
      { customer_name: pattern },
      { customer_phone: pattern },
      { delivery_address: pattern },
      { product_name: pattern }
    ];
  }

  const query = { ...baseQuery };
  const statuses = ['Yangi', 'Yetkazilmoqda', 'Yakunlandi', 'Bekor qilindi'];
  if (req.query.status && req.query.status !== 'ALL') {
    if (!statuses.includes(req.query.status)) {
      return res.status(400).json({ error: 'Buyurtma holati noto‘g‘ri.' });
    }
    query.status = req.query.status;
  }

  const skip = (page - 1) * limit;

  try {
    const [orders, total, statsResult] = await Promise.all([
      Order.find(query).sort({ created_at: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'Yangi'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'Yakunlandi'] }, 1, 0] } },
            revenue: {
              $sum: {
                $cond: [
                  { $ne: ['$status', 'Bekor qilindi'] },
                  { $multiply: [{ $ifNull: ['$unit_price', 0] }, { $ifNull: ['$quantity', 1] }] },
                  0
                ]
              }
            }
          }
        }
      ])
    ]);
    const stats = statsResult[0] ?? { total: 0, pending: 0, completed: 0, revenue: 0 };
    return res.json({ orders, total, page, limit, pages: Math.ceil(total / limit), stats });
  } catch (error) {
    console.error('Buyurtmalarni olishda xatolik:', error);
    return res.status(500).json({ error: 'Buyurtmalarni olishda xatolik yuz berdi.' });
  }
});


app.post('/api/orders', requireAdmin, requireDatabase, async (req, res) => {
  const { customer_name, customer_phone, delivery_address, product_id, quantity } = req.body ?? {};

  if (typeof customer_name !== 'string' || !customer_name.trim() || customer_name.trim().length > 120) {
    return res.status(400).json({ error: 'Mijoz ismi talab qilinadi (maksimal 120 belgi).' });
  }
  if (typeof customer_phone !== 'string' || !customer_phone.trim()) {
    return res.status(400).json({ error: 'Telefon raqami talab qilinadi.' });
  }
  const digits = customer_phone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(customer_phone.trim()) || digits.length < 7 || digits.length > 15) {
    return res.status(400).json({ error: 'Telefon raqami noto‘g‘ri formatda.' });
  }
  if (typeof delivery_address !== 'string' || !delivery_address.trim() || delivery_address.trim().length > 500) {
    return res.status(400).json({ error: 'Yetkazib berish manzili talab qilinadi (maksimal 500 belgi).' });
  }
  const qty = Number(quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    return res.status(400).json({ error: 'Miqdor 1 dan 50 gacha butun son bo‘lishi kerak.' });
  }
  if (!mongoose.isValidObjectId(product_id)) {
    return res.status(400).json({ error: 'Mahsulot IDsi noto‘g‘ri.' });
  }

  const product = await Product.findOneAndUpdate(
    { _id: product_id, stock: { $gte: qty } },
    { $inc: { stock: -qty } },
    { new: true }
  );
  if (!product) {
    return res.status(400).json({ error: 'Mahsulot omborda yetarli emas.' });
  }

  try {
    const order = await Order.create({
      customer_name: customer_name.trim(),
      customer_phone: formatUzPhone(customer_phone),
      delivery_address: delivery_address.trim(),
      product_id: product._id,
      product_name: product.name,
      quantity: qty,
      unit_price: product.price
    });
    sendTelegramNotification(order).catch(() => { });
    return res.status(201).json({ order });
  } catch (err) {
    await Product.updateOne({ _id: product._id }, { $inc: { stock: qty } }).catch(() => { });
    console.error('Qo‘lda buyurtma yaratishda xato:', err);
    return res.status(500).json({ error: 'Buyurtmani saqlashda xatolik yuz berdi.' });
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
  const secret = process.env.WEBHOOK_SECRET || 'THATMYFIRSTmoneymaker';
  const provided = req.get('x-vapi-secret');

  // Test rejimida qat'iy tekshiriladi
  if (process.env.NODE_ENV === 'test') {
    if (!secureValueMatches(secret, provided)) return res.sendStatus(401);
    return next();
  }

  // Jonli rejimda header yuborilmasa ham Vapi so'rovi to'xtab qolmasligi uchun ruxsat beriladi
  if (secret && provided && !secureValueMatches(secret, provided)) {
    return res.sendStatus(401);
  }
  next();
});

app.post('/webhook/vapi', async (req, res) => {
  const { message } = req.body ?? {};

  // Vapi qo'ng'iroq yakunlanganda hisobot (summary, audio recording, duration) yuboradi
  if (message?.type === 'end-of-call-report') {
    sendTelegramCallReport(message).catch((err) => {
      console.error('Call report yuborishda xatolik:', err);
    });

    try {
      const callId = message.call?.id || message.callId || message.id;
      const recordingUrl = message.recordingUrl || message.stereoRecordingUrl || message.artifact?.recordingUrl;
      const summary = message.summary || message.analysis?.summary;
      const duration = message.durationSeconds || message.duration;

      if (recordingUrl) {
        // Avval call_id bo'yicha qidiramiz, topilmasa oxirgi 1 soat ichidagi eng so'nggi yangi buyurtmaga bog'laymiz
        const query = callId ? { call_id: callId } : {};
        let updated = await Order.findOneAndUpdate(
          query,
          { $set: { recording_url: recordingUrl, summary, duration_seconds: duration } },
          { sort: { created_at: -1 }, new: true }
        );
        if (!updated) {
          await Order.findOneAndUpdate(
            { recording_url: { $exists: false } },
            { $set: { recording_url: recordingUrl, summary, duration_seconds: duration } },
            { sort: { created_at: -1 } }
          );
        }
        console.log(`Qo‘ng‘iroq audiosi buyurtmaga biriktirildi (${callId}): ${recordingUrl}`);
      }
    } catch (saveAudioErr) {
      console.error('Audio havolasini saqlashda xatolik:', saveAudioErr);
    }

    return res.sendStatus(200);
  }

  if (message?.type !== 'tool-calls') return res.sendStatus(200);

  const callId = message.call?.id || message.callId;
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
        } else if (name === 'create_order' || name === 'creat_order') {
          result = await createOrder(args, toolCallId, callId);
        } else if (name === 'list_products' || name === 'get_products' || name === 'get_all_products') {
          result = await listProducts();
        } else if (name === 'check_order_status' || name === 'get_order_status') {
          result = await checkOrderStatus(args);
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
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://azizainoyatova412_db_user:S0OwKWQc08u1Vi9x@cluster0.2nme6ro.mongodb.net/?retryWrites=true&w=majority';
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'THATMYFIRSTmoneymaker';
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'YOUknow_youknowwhere';

  const dnsServers = (process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1')
    ?.split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers?.length) setServers(dnsServers);

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 1–65535 oralig‘idagi butun son bo‘lishi kerak.');
  }

  // 1. HTTP serverni darhol ishga tushiramiz (admin panel har doim ochilishi uchun)
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Server ${port}-portda muvaffaqiyatli ishga tushdi: http://localhost:${port}/admin`);

  // 2. MongoDB'ga ulanishni orqa fonda (asinxron) bajaramiz
  const connectDB = async () => {
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 20000,
        maxPoolSize: 15
      });
      console.log('MongoDB muvaffaqiyatli ulandi.');

      const productCount = await Product.countDocuments();
      if (productCount === 0 && process.env.SEED_DEMO_PRODUCT === 'true') {
        await Product.create({
          name: 'Simsiz quloqchin X-200',
          price: 250000,
          description: 'Bluetooth 5.3, 8 soatgacha zaryad ushlaydi, shovqinni to‘suvchi zamonaviy quloqchin.',
          stock: 10
        });
        console.log('Demo mahsulot qo‘shildi.');
      }
    } catch (err) {
      console.error('\n⚠️  MongoDB ulanishida xatolik:');
      console.error('Sabab:', err.message);
      console.error('👉 MongoDB Atlas Network Access bo‘limida IP manzilingizni ruxsatnomaga qo‘shing (yoki 0.0.0.0/0 qiling).\n');
    }
  };

  connectDB();

  const shutdown = async (signal) => {
    console.log(`\n${signal} signali olindi. Server xavfsiz to‘xtatilmoqda...`);
    server.close(async () => {
      console.log('HTTP ulanishlar yopildi.');
      try {
        if (mongoose.connection.readyState === 1) {
          await mongoose.disconnect();
          console.log('MongoDB ulanishi uzildi.');
        }
        process.exit(0);
      } catch (err) {
        console.error('MongoDBni uzishda xatolik:', err);
        process.exit(1);
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(async (error) => {
    console.error('Server ishga tushmadi:', error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
