const mongoose = require('mongoose');

// Raw signal schema - stored in MongoDB (the data lake / audit log)
const signalSchema = new mongoose.Schema({
  signal_id:    { type: String, required: true, unique: true },
  component_id: { type: String, required: true, index: true },
  component_type: { type: String, required: true },  // API | CACHE | RDBMS | QUEUE | MCP | NOSQL
  error_code:   { type: String },
  message:      { type: String, required: true },
  severity:     { type: String, enum: ['P0', 'P1', 'P2', 'P3'], required: true },
  metadata:     { type: mongoose.Schema.Types.Mixed, default: {} },
  work_item_id: { type: String, index: true },        // linked after debounce
  received_at:  { type: Date, default: Date.now }
}, { collection: 'signals' });

// TTL index: auto-expire raw signals after 30 days (data lake retention)
signalSchema.index({ received_at: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Signal', signalSchema);
