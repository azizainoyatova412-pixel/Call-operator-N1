# Professional Ovozli AI Call Operator & CRM Tizimi

Internet-do‘konlar, yetkazib berish xizmatlari va savdo kompaniyalari uchun mo‘ljallangan, sotuvga to‘liq tayyor sun’iy intellektli ovozli operator backend tizimi.

U mijozlar bilan o‘zbek tilida tabiiy ovozda muloqot qiladi, mahsulotlarni tavsiya etadi, savollarga javob beradi, e’tirozlarni bartaraf etadi, buyurtmalarni avtomatik rasmiylashtiradi va qo‘ng‘iroqlar hisobotini Telegramga yuboradi.

---

## 🌟 Sotuvdagi Asosiy Afzalliklari (Mijozga taqdimot uchun)

1. **24/7 To‘xtovsiz Ish:** Operatorlar kechasi ham, dam olish kunlari ham barcha qo‘ng‘iroqlarga darhol javob beradi. Bir vaqtning o‘zida o‘nlab qo‘ng‘iroqlarni qabul qila oladi.
2. **Katalog & Narxlar Integratsiyasi:** Ombordagi zaxira va dolzarb narxlar bilan ishlaydi (`get_product_details`, `list_products`). O‘zidan yolg‘on narx to‘qimaydi.
3. **Avtomatik Buyurtma Olish:** Mijozning ismi, telefon raqami, manzili va dona sonini to‘liq tasdiqlatib, bazaga yozadi (`create_order`).
4. **Buyurtma Holatini Tekshirish:** Qayta qo‘ng‘iroq qilgan mijoz telefon raqami orqali o‘z buyurtmasi holatini bilib oladi (`check_order_status`).
5. **Telegram CRM Xabarnomalari:**
   - Yangi buyurtma tushishi bilan do‘kon egasi/menejeriga to‘liq ma’lumot boradi.
   - Har bir qo‘ng‘iroq tugaganda suhbat audiosi va AI xulosasi yuboriladi.
6. **Zamonaviy Admin Panel:** Mahsulotlarni boshqarish (qo‘shish, tahrirlash, o‘chirish) va tushgan buyurtmalar holatini real-vaqtda boshqarish uchun web-interfeys.

---

## 🚀 Ishga Tushirish va O‘rnatish

### 1. Talablar
- Node.js 20+
- MongoDB (Lokal yoki bepul MongoDB Atlas klasteri)

### 2. Sozlash
Loyiha papkasidagi `.env.example` faylidan nusxa olib `.env` yarating:

```env
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/<database>?retryWrites=true&w=majority
MONGODB_DNS_SERVERS=1.1.1.1
WEBHOOK_SECRET=maxfiy_webhook_kaliti_bu_yerga
ADMIN_API_KEY=maxfiy_admin_panel_kaliti_bu_yerga
SEED_DEMO_PRODUCT=true

# Telegram bildirishnomalar (Yangi buyurtma va Qo‘ng‘iroq yozuvlari)
TELEGRAM_BOT_TOKEN=bot_tokeni
TELEGRAM_CHAT_ID=chat_yoki_kanal_id
```

### 3. O‘rnatish va Start
```powershell
npm install
npm start
```

Server ishga tushgach:
- Admin panel: `http://localhost:3000/admin`
- Health check: `http://localhost:3000/health`

---

## 🎙 Vapi Sozlamalari (AI Operator)

To‘liq bosqichma-bosqich qo‘llanma: [vapi/assistant-setup.md](./vapi/assistant-setup.md)

1. Serverni internetga chiqadigan HTTPS hostingga (masalan: Railway, Render, VPS yoki test uchun ngrok/localtunnel) joylashtiring.
2. Vapi Dashboard'da 4 ta vosita (tool) qo‘shing:
   - `get_product_details`
   - `list_products`
   - `create_order`
   - `check_order_status`
3. Tayyor `vapi/vapi-assistant.json` faylidan foydalanib bir zumda to‘liq assistentni yarating.

---

## 📊 Admin Panel Imkoniyatlari

Brauzerda `http://localhost:3000/admin` manzilini oching:
- **Admin kalitini kiriting:** `.env` faylidagi `ADMIN_API_KEY` ni kiriting.
- **Mahsulotlar:** Yangi mahsulot qo‘shish, narx va zaxirasini yangilash, o‘chirish.
- **Buyurtmalar:** Barcha tushgan buyurtmalarni ko‘rish va ularning holatini (`Yangi` -> `Yetkazilmoqda` -> `Yakunlandi` / `Bekor qilindi`) o‘zgartirish.
