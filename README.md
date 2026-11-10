# Ovozli AI operator MVP

Node.js, Express va MongoDB asosidagi boshlang‘ich backend. U mahsulotlarni saqlaydi, buyurtmalarni qayd etadi va Vapi Function tool chaqiruvlariga javob beradi.

## Ishga tushirish

1. Node.js 20 yoki undan yangisini o‘rnating.
2. MongoDB'ni lokalda ishga tushiring yoki MongoDB Atlas'da baza yarating.
3. Loyihaning asosiy papkasida `.env.example` nusxasini `.env` nomi bilan yarating. `MONGO_URI` ni o‘zingizning bazangizga moslang. `WEBHOOK_SECRET` va `ADMIN_API_KEY` uchun ikki xil tasodifiy, uzun qiymat kiriting. Bu kalitlarni hech kimga yubormang va repozitoriyga qo‘shmang.
4. PowerShell'da:

   ```powershell
   npm install
   npm start
   ```

5. Terminalda `MongoDB ulandi` va `Server 3000-portda ishlamoqda` xabarlarini kuting. Tekshirish:

   ```powershell
   Invoke-RestMethod http://localhost:3000/health
   ```

`SEED_DEMO_PRODUCT=true` bo‘lsa, faqat mahsulotlar kolleksiyasi bo‘sh paytda X-200 demo mahsuloti qo‘shiladi. Demo narx/zaxirani haqiqiy mijozlarga ko‘rsatishdan oldin o‘zgartiring yoki `.env` ichida `SEED_DEMO_PRODUCT=false` qiling.

## Mahsulot va buyurtmalar

Mahsulotlarni ko‘rish ochiq:

```powershell
Invoke-RestMethod http://localhost:3000/api/products
```

Yangi mahsulot qo‘shish (PowerShell'da misol):

```powershell
$headers = @{ "x-admin-key" = "YOUR_ADMIN_API_KEY" }
$body = @{
  name = "Simsiz quloqchin X-200"
  price = 250000
  description = "Bluetooth 5.3, zaryadi 8 soatgacha yetadi."
  stock = 10
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/products -Headers $headers -ContentType "application/json" -Body $body
```

Buyurtmalarni ko‘rish uchun xuddi shu `x-admin-key` bilan `GET /api/orders` so‘rovini yuboring. Holatni `PATCH /api/orders/<id>/status` manzilida `{ "status": "Yetkazilmoqda" }` kabi JSON bilan yangilash mumkin. Ruxsat etilgan holatlar: `Yangi`, `Yetkazilmoqda`, `Yakunlandi`, `Bekor qilindi`.

## Vapi'ni ulash

Vapi tool sxemalari va system prompt [Vapi sozlamalari](./vapi/assistant-setup.md) hujjatida. Mahalliy `localhost`'ni Vapi ko‘ra olmaydi: serverni HTTPS manzilli hostingga joylashtiring va hosting maxfiy sozlamalarida `MONGO_URI`, `WEBHOOK_SECRET` hamda `ADMIN_API_KEY` qiymatlarini kiriting. Vapi'dagi ikkala Function tool uchun `https://<server-domeningiz>/webhook/vapi` URL va `x-vapi-secret: <WEBHOOK_SECRET>` headerini sozlang.

## Test

```powershell
npm test
```

Testlar MongoDB servisiga ulanishni talab qilmaydi; bazaga bog‘liq endpointlar DB ulanmaganda `503` qaytaradi. Haqiqiy mahsulot qidiruvi va buyurtmani tekshirish uchun ishlayotgan MongoDB bilan ishga tushiring, Vapi Web Call orqali test buyurtma bering va zaxira kamaygani hamda buyurtma saqlanganini tekshiring.
