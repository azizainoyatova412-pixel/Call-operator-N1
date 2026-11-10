import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  customer_name: { type: String, required: true, trim: true, maxlength: 120 },
  customer_phone: { type: String, required: true, trim: true, maxlength: 30 },
  delivery_address: { type: String, required: true, trim: true, maxlength: 500 },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  product_name: { type: String, required: true, trim: true },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
    validate: Number.isInteger
  },
  unit_price: { type: Number, required: true, min: 0 },
  tool_call_id: { type: String, unique: true, sparse: true },
  status: {
    type: String,
    enum: ['Yangi', 'Yetkazilmoqda', 'Yakunlandi', 'Bekor qilindi'],
    default: 'Yangi'
  },
  created_at: { type: Date, default: Date.now }
});

export const Order = mongoose.model('Order', orderSchema);