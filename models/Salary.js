const mongoose = require('mongoose');

const salarySchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },
    year: {
        type: Number,
        required: true
    },
    basicSalary: {
        type: Number,
        required: true
    },
    presentDays: {
        type: Number,
        default: 0
    },
    absentDays: {
        type: Number,
        default: 0
    },
    halfDays: {
        type: Number,
        default: 0
    },
    totalWorkingDays: {
        type: Number,
        default: 30
    },
    calculatedSalary: {
        type: Number,
        required: true
    },
    advanceDeductions: {
        type: Number,
        default: 0
    },
    netSalary: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'paid'],
        default: 'pending'
    },
    paidDate: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Ensure one salary record per employee per month
salarySchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Salary', salarySchema);
