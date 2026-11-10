import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  price: { type: Number, required: true, min: 0 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  stock: { type: Number, default: 10, min: 0, validate: Number.isInteger }
});

export const Product = mongoose.model('Product', productSchema);