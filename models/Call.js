import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
  call_id: { type: String, required: true, unique: true, index: true },
  customer_phone: { type: String, default: '', trim: true },
  customer_name: { type: String, default: '', trim: true },
  started_at: { type: Date },
  ended_at: { type: Date },
  duration_seconds: { type: Number, default: 0 },
  ended_reason: { type: String, default: '' },
  transcript: { type: String, default: '' },
  messages: { type: Array, default: [] },
  summary: { type: String, default: '' },
  cost: { type: Number, default: 0 },
  recording_url: { type: String, default: '' },
  recording_file: { type: String, default: '' },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', sparse: true },
  created_at: { type: Date, default: Date.now, index: true }
});

export const Call = mongoose.model('Call', callSchema);
