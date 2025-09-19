const mongoose = require('mongoose');

const advanceSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    reason: {
        type: String,
        trim: true
    },
    isDeducted: {
        type: Boolean,
        default: false
    },
    deductedDate: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Advance', advanceSchema);
