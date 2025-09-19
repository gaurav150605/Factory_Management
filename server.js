const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const moment = require('moment');

// Import models
const Employee = require('./models/Employee');
const Attendance = require('./models/Attendance');
const Advance = require('./models/Advance');
const Salary = require('./models/Salary');
const Sale = require('./models/Sale');
const SimpleSale = require('./models/SimpleSale');

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/ramlila-pedhewale', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.log('MongoDB connection error:', err);
    console.log('Continuing with JSON file storage...');
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Set view engine to handlebars
const hbs = require('express-handlebars');
app.engine('hbs', hbs.engine({
    extname: '.hbs',
    defaultLayout: 'layout',
    runtimeOptions: {
        allowProtoPropertiesByDefault: true,
        allowProtoMethodsByDefault: true
    },
    helpers: {
        eq: function(a, b) { return a === b; },
        lt: function(a, b) { return a < b; },
        formatDate: function(dateString, format) {
            if (!dateString) return '';
            if (format === 'YYYY-MM-DD') {
                return moment(dateString).format('YYYY-MM-DD');
            }
            return moment(dateString).format('MMM DD, YYYY');
        }
    }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Data storage files
const DATA_DIR = 'data';
const STOCK_FILE = path.join(DATA_DIR, 'stock.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Initialize data files if they don't exist
const initializeDataFile = (filePath, defaultData) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    }
};

initializeDataFile(STOCK_FILE, [
    { id: 'sugar', name: 'Sugar', quantity: 100, unit: 'kg', lastUpdated: new Date().toISOString() },
    { id: 'milk', name: 'Milk', quantity: 50, unit: 'liters', lastUpdated: new Date().toISOString() }
]);
initializeDataFile(PRODUCTS_FILE, [
    { id: 'pedha-1', name: 'Kesar Pedha', price: 200, unit: 'kg', description: 'Premium Kesar Pedha' },
    { id: 'pedha-2', name: 'Chocolate Pedha', price: 250, unit: 'kg', description: 'Delicious Chocolate Pedha' },
    { id: 'pedha-3', name: 'Plain Pedha', price: 180, unit: 'kg', description: 'Traditional Plain Pedha' }
]);

// Helper functions
const readData = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return [];
    }
};

const writeData = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
};

// Routes

// Dashboard
app.get('/', (req, res) => {
    res.render('dashboard', {
        title: 'Ramlila Pedhewale Factory',
        factoryName: 'Ramlila Pedhewale'
    });
});

// Sales Management Routes
// Sales list - show both simple and multi-product sales
app.get('/sales', async (req, res) => {
    try {
        const [simpleSales, multiSales] = await Promise.all([
            SimpleSale.find().sort({ createdAt: -1 }),
            Sale.find().sort({ createdAt: -1 })
        ]);

        const simpleMapped = simpleSales.map(s => ({
            ...s.toObject(),
            type: 'simple',
            totalAmount: s.amount
        }));

        const multiMapped = multiSales.map(sale => ({
            ...sale.toObject(),
            type: 'multiple',
            productName: sale.items.length > 1 ?
                `${sale.items[0].productName} + ${sale.items.length - 1} more` :
                sale.items[0]?.productName || 'Multiple Products'
        }));

        const allSales = [...simpleMapped, ...multiMapped]
            .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

        const totalSales = allSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
        const totalQuantity = multiSales.reduce((sum, sale) =>
            sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);

        res.render('sales/list', {
            sales: allSales,
            totalSales,
            totalQuantity,
            title: 'Sales Management'
        });
    } catch (error) {
        console.error('Error loading sales:', error);
        res.status(500).send('Error loading sales');
    }
});

// Single-product sale routes have been removed

// Stock Management Routes
app.get('/stock', (req, res) => {
    const stock = readData(STOCK_FILE);
    
    // Calculate stock levels
    const lowStockCount = stock.filter(item => item.quantity < 10).length;
    const mediumStockCount = stock.filter(item => item.quantity >= 10 && item.quantity < 50).length;
    const goodStockCount = stock.filter(item => item.quantity >= 50).length;
    
    res.render('stock/list', { 
        stock, 
        lowStockCount,
        mediumStockCount,
        goodStockCount,
        title: 'Stock Management' 
    });
});

app.get('/stock/add', (req, res) => {
    res.render('stock/add', { title: 'Add Stock' });
});

app.post('/stock/add', (req, res) => {
    const { name, quantity, unit } = req.body;
    
    const stockItem = {
        id: uuidv4(),
        name,
        quantity: parseFloat(quantity),
        unit,
        lastUpdated: new Date().toISOString()
    };
    
    const stock = readData(STOCK_FILE);
    stock.push(stockItem);
    
    if (writeData(STOCK_FILE, stock)) {
        res.redirect('/stock');
    } else {
        res.status(500).json({ error: 'Failed to save stock item' });
    }
});

app.get('/stock/edit/:id', (req, res) => {
    const stock = readData(STOCK_FILE);
    const stockItem = stock.find(s => s.id === req.params.id);
    
    if (!stockItem) {
        return res.status(404).send('Stock item not found');
    }
    
    res.render('stock/edit', { stockItem, title: 'Edit Stock' });
});

app.post('/stock/edit/:id', (req, res) => {
    const { name, quantity, unit } = req.body;
    
    const stock = readData(STOCK_FILE);
    const stockIndex = stock.findIndex(s => s.id === req.params.id);
    
    if (stockIndex === -1) {
        return res.status(404).json({ error: 'Stock item not found' });
    }
    
    stock[stockIndex] = {
        ...stock[stockIndex],
        name,
        quantity: parseFloat(quantity),
        unit,
        lastUpdated: new Date().toISOString()
    };
    
    if (writeData(STOCK_FILE, stock)) {
        res.redirect('/stock');
    } else {
        res.status(500).json({ error: 'Failed to update stock item' });
    }
});

app.post('/stock/delete/:id', (req, res) => {
    const stock = readData(STOCK_FILE);
    const filteredStock = stock.filter(s => s.id !== req.params.id);
    
    if (writeData(STOCK_FILE, filteredStock)) {
        res.redirect('/stock');
    } else {
        res.status(500).json({ error: 'Failed to delete stock item' });
    }
});

// Product Management Routes
app.get('/products', (req, res) => {
    const products = readData(PRODUCTS_FILE);
    
    // Calculate product statistics
    const prices = products.map(p => p.price);
    const averagePrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    
    res.render('products/list', { 
        products, 
        averagePrice,
        minPrice,
        maxPrice,
        title: 'Product Management' 
    });
});

app.get('/products/add', (req, res) => {
    res.render('products/add', { title: 'Add Product' });
});

app.post('/products/add', (req, res) => {
    const { name, price, unit, description } = req.body;
    
    const product = {
        id: uuidv4(),
        name,
        price: parseFloat(price),
        unit,
        description,
        createdAt: new Date().toISOString()
    };
    
    const products = readData(PRODUCTS_FILE);
    products.push(product);
    
    if (writeData(PRODUCTS_FILE, products)) {
        res.redirect('/products');
    } else {
        res.status(500).json({ error: 'Failed to save product' });
    }
});

app.get('/products/edit/:id', (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const product = products.find(p => p.id === req.params.id);
    
    if (!product) {
        return res.status(404).send('Product not found');
    }
    
    res.render('products/edit', { product, title: 'Edit Product' });
});

app.post('/products/edit/:id', (req, res) => {
    const { name, price, unit, description } = req.body;
    
    const products = readData(PRODUCTS_FILE);
    const productIndex = products.findIndex(p => p.id === req.params.id);
    
    if (productIndex === -1) {
        return res.status(404).json({ error: 'Product not found' });
    }
    
    products[productIndex] = {
        ...products[productIndex],
        name,
        price: parseFloat(price),
        unit,
        description,
        updatedAt: new Date().toISOString()
    };
    
    if (writeData(PRODUCTS_FILE, products)) {
        res.redirect('/products');
    } else {
        res.status(500).json({ error: 'Failed to update product' });
    }
});

app.post('/products/delete/:id', (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const filteredProducts = products.filter(p => p.id !== req.params.id);
    
    if (writeData(PRODUCTS_FILE, filteredProducts)) {
        res.redirect('/products');
    } else {
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Invoice Generation
app.post('/getInvoice', async (req, res) => {
    const { saleId } = req.body;
    
    if (!saleId) {
        return res.status(400).json({ error: 'Sale ID is required' });
    }
    
    try {
        // Try simple sale first, then complex sale
        let simple = await SimpleSale.findById(saleId);
        let sale = simple || await Sale.findById(saleId);
        
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        
        let invoiceHTML;
        
        if (!simple && sale && sale.items && sale.items.length > 0) {
            // Multiple product sale
            const itemsHTML = sale.items.map(item => `
                <tr>
                    <td>${item.productName}</td>
                    <td>${item.quantity} kg</td>
                    <td>₹${item.price}</td>
                    <td>₹${item.totalAmount}</td>
                </tr>
            `).join('');
            
            invoiceHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice - ${sale._id || sale.id}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .company-name { font-size: 24px; font-weight: bold; color: #2c3e50; }
                    .invoice-details { margin-bottom: 20px; }
                    .invoice-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    .invoice-table th, .invoice-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    .invoice-table th { background-color: #f2f2f2; }
                    .total { font-weight: bold; font-size: 18px; }
                    .footer { margin-top: 30px; text-align: center; color: #666; }
                    .summary { margin-top: 20px; }
                    .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="company-name">Ramlila Pedhewale Factory</div>
                    <p>Traditional Sweet Manufacturing</p>
                </div>
                
                <div class="invoice-details">
                    <h2>Invoice #${(sale._id || sale.id).toString().substring(0, 8)}</h2>
                    <p><strong>Date:</strong> ${moment(sale.date).format('DD-MM-YYYY')}</p>
                    <p><strong>Customer:</strong> ${sale.customerName}</p>
                    ${sale.customerPhone ? `<p><strong>Phone:</strong> ${sale.customerPhone}</p>` : ''}
                    ${sale.customerEmail ? `<p><strong>Email:</strong> ${sale.customerEmail}</p>` : ''}
                    ${sale.customerAddress ? `<p><strong>Address:</strong> ${sale.customerAddress}</p>` : ''}
                </div>
                
                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Quantity</th>
                            <th>Unit Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHTML}
                    </tbody>
                </table>
                
                <div class="summary">
                    <div class="summary-row">
                        <span>Subtotal:</span>
                        <span>₹${sale.subtotal}</span>
                    </div>
                    ${sale.discount > 0 ? `
                    <div class="summary-row">
                        <span>Discount:</span>
                        <span>-₹${sale.discount}</span>
                    </div>
                    ` : ''}
                    ${sale.tax > 0 ? `
                    <div class="summary-row">
                        <span>Tax:</span>
                        <span>₹${sale.tax}</span>
                    </div>
                    ` : ''}
                    <div class="summary-row total">
                        <span><strong>Total Amount:</strong></span>
                        <span><strong>₹${sale.totalAmount}</strong></span>
                    </div>
                </div>
                
                <div class="footer">
                    <p>Thank you for your business!</p>
                    <p>Ramlila Pedhewale Factory - Quality Sweets Since Generations</p>
                </div>
            </body>
            </html>
            `;
        } else if (simple) {
            // Simple sale invoice
            invoiceHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice - ${simple._id}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .company-name { font-size: 24px; font-weight: bold; color: #2c3e50; }
                    .invoice-details { margin-bottom: 20px; }
                    .invoice-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    .invoice-table th, .invoice-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    .invoice-table th { background-color: #f2f2f2; }
                    .total { font-weight: bold; font-size: 18px; }
                    .footer { margin-top: 30px; text-align: center; color: #666; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="company-name">Ramlila Pedhewale Factory</div>
                    <p>Traditional Sweet Manufacturing</p>
                </div>
                
                <div class="invoice-details">
                    <h2>Invoice #${simple._id.toString().substring(0, 8)}</h2>
                    <p><strong>Date:</strong> ${moment(simple.date).format('DD-MM-YYYY')}</p>
                    <p><strong>Customer:</strong> ${simple.customerName}</p>
                    ${simple.customerPhone ? `<p><strong>Phone:</strong> ${simple.customerPhone}</p>` : ''}
                </div>
                
                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Sale</td>
                            <td>₹${simple.amount}</td>
                        </tr>
                    </tbody>
                </table>
                
                <div class="total">
                    <p>Total Amount: ₹${simple.amount}</p>
                </div>
                
                <div class="footer">
                    <p>Thank you for your business!</p>
                    <p>Ramlila Pedhewale Factory - Quality Sweets Since Generations</p>
                </div>
            </body>
            </html>
            `;
        } else {
            return res.status(404).json({ error: 'Sale not found' });
        }
        
        await page.setContent(invoiceHTML);
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        
        await browser.close();
        
        res.setHeader('Content-Type', 'application/pdf');
        const code = (simple? simple._id : (sale._id || sale.id)).toString().substring(0,8);
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${code}.pdf"`);
        res.send(pdf);
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
});

// Reporting Routes
app.get('/reports', async (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const stock = readData(STOCK_FILE);

    const simpleSales = await SimpleSale.find().sort({ createdAt: -1 });
    const totalSales = simpleSales.reduce((sum, s) => sum + s.amount, 0);
    const totalSalesCount = simpleSales.length;

    const recentSales = simpleSales.slice(0, 10).map(s => ({
        date: moment(s.date).format('YYYY-MM-DD'),
        customerName: s.customerName,
        productName: 'Sale',
        quantity: 1,
        totalAmount: s.amount
    }));

    res.render('reports/dashboard', {
        sales: recentSales,
        products,
        stock,
        totalSales,
        totalQuantity: 0,
        totalSalesCount,
        salesByProduct: null,
        topProduct: null,
        averageOrder: simpleSales.length ? { amount: Math.round(totalSales / simpleSales.length), quantity: 1 } : null,
        lowStockItems: stock.filter(item => item.quantity < 10),
        title: 'Reports & Analytics'
    });
});

// Multiple Product Sales Routes
// Add sale (multi-product with add another product option)
app.get('/sales/add-multiple', (req, res) => {
    const products = readData(PRODUCTS_FILE);
    res.render('sales/add-multiple', { products, title: 'Add Sale' });
});

app.get('/sales/add', (req, res) => {
    const products = readData(PRODUCTS_FILE);
    res.render('sales/add-multiple', { products, title: 'Add Sale' });
});

app.post('/sales/add', async (req, res) => {
    try {
        const {
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            products,
            discount,
            tax,
            paymentMethod,
            date,
            notes
        } = req.body;

        // Normalize and compute items
        let normalized = [];
        if (Array.isArray(products)) {
            normalized = products;
        } else if (products && typeof products === 'object') {
            normalized = Object.values(products);
        }

        const productCatalog = readData(PRODUCTS_FILE);
        const items = [];
        let subtotal = 0;
        for (const p of normalized) {
            const productIdVal = p.productId || p["productId"];
            const quantityVal = parseFloat(p.quantity || p["quantity"] || 0);
            const priceVal = parseFloat(p.price || p["price"] || 0);
            if (!productIdVal || !quantityVal || !priceVal) continue;
            const match = productCatalog.find(pc => pc.id === productIdVal);
            const productName = match ? match.name : (p.productName || p["productName"] || 'Product');
            const totalAmount = quantityVal * priceVal;
            items.push({ productId: productIdVal, productName, quantity: quantityVal, price: priceVal, totalAmount });
            subtotal += totalAmount;
        }

        const disc = parseFloat(discount) || 0;
        const tx = parseFloat(tax) || 0;
        const totalAmount = Math.max(0, subtotal - disc + tx);

        const sale = new Sale({
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            items,
            subtotal,
            discount: disc,
            tax: tx,
            totalAmount,
            paymentMethod: paymentMethod || 'cash',
            date: date ? new Date(date) : new Date(),
            notes
        });
        await sale.save();
        res.redirect('/sales');
    } catch (error) {
        console.error('Error creating sale:', error);
        res.status(500).send('Failed to save sale');
    }
});

// Employee Management Routes
app.get('/employees', async (req, res) => {
    try {
        const employees = await Employee.find({ isActive: true }).sort({ createdAt: -1 });
        
        // Convert to plain objects to avoid Handlebars issues
        const plainEmployees = employees.map(emp => emp.toObject());
        
        // Calculate statistics
        const activeCount = plainEmployees.length;
        const averageSalary = plainEmployees.length > 0 
            ? Math.round(plainEmployees.reduce((sum, emp) => sum + emp.basicSalary, 0) / plainEmployees.length)
            : 0;
        const totalPayroll = plainEmployees.reduce((sum, emp) => sum + emp.basicSalary, 0);
        
        res.render('employees/list', {
            employees: plainEmployees,
            activeCount,
            averageSalary,
            totalPayroll,
            title: 'Employee Management'
        });
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).send('Error loading employees');
    }
});

app.get('/employees/add', (req, res) => {
    res.render('employees/add', { title: 'Add Employee' });
});

app.post('/employees/add', async (req, res) => {
    try {
        const { name, role, phone, basicSalary, joiningDate, address } = req.body;
        
        const employee = new Employee({
            name,
            role,
            phone,
            basicSalary: parseFloat(basicSalary),
            joiningDate: new Date(joiningDate),
            address
        });
        
        await employee.save();
        res.redirect('/employees');
    } catch (error) {
        console.error('Error creating employee:', error);
        res.status(500).send('Error creating employee');
    }
});

app.get('/employees/edit/:id', async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return res.status(404).send('Employee not found');
        }
        
        res.render('employees/edit', { employee: employee.toObject(), title: 'Edit Employee' });
    } catch (error) {
        console.error('Error fetching employee:', error);
        res.status(500).send('Error loading employee');
    }
});

app.post('/employees/edit/:id', async (req, res) => {
    try {
        const { name, role, phone, basicSalary, joiningDate, address } = req.body;
        
        await Employee.findByIdAndUpdate(req.params.id, {
            name,
            role,
            phone,
            basicSalary: parseFloat(basicSalary),
            joiningDate: new Date(joiningDate),
            address,
            updatedAt: Date.now()
        });
        
        res.redirect('/employees');
    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).send('Error updating employee');
    }
});

app.post('/employees/delete/:id', async (req, res) => {
    try {
        await Employee.findByIdAndUpdate(req.params.id, { isActive: false });
        res.redirect('/employees');
    } catch (error) {
        console.error('Error deleting employee:', error);
        res.status(500).send('Error deleting employee');
    }
});

// Attendance and Advance features removed

// Salary Management Routes
app.get('/employees/salary', async (req, res) => {
    try {
        const currentMonth = moment().month() + 1;
        const currentYear = moment().year();
        
        const salaries = await Salary.find({
            month: currentMonth,
            year: currentYear
        }).populate('employeeId');
        
        // Calculate salary summary
        const totalSalary = salaries.reduce((sum, salary) => sum + salary.netSalary, 0);
        const averageSalary = salaries.length > 0 ? Math.round(totalSalary / salaries.length) : 0;
        
        res.render('employees/salary', {
            salaries: salaries.map(sal => ({
                ...sal.toObject(),
                employeeId: sal.employeeId.toObject()
            })),
            currentMonth,
            currentYear,
            totalSalary,
            averageSalary,
            title: 'Salary Management'
        });
    } catch (error) {
        console.error('Error loading salaries:', error);
        res.status(500).send('Error loading salaries');
    }
});

app.post('/employees/salary/calculate', async (req, res) => {
    try {
        const { month, year } = req.body;
        const employees = await Employee.find({ isActive: true });
        
        for (const employee of employees) {
            // Check if salary already calculated for this month
            const existingSalary = await Salary.findOne({
                employeeId: employee._id,
                month: parseInt(month),
                year: parseInt(year)
            });
            
            if (existingSalary) continue;
            
            // Calculate attendance for the month
            const startDate = moment(`${year}-${month}-01`).startOf('month');
            const endDate = moment(`${year}-${month}-01`).endOf('month');
            
            const attendanceRecords = await Attendance.find({
                employeeId: employee._id,
                date: {
                    $gte: startDate.toDate(),
                    $lte: endDate.toDate()
                }
            });
            
            const presentDays = attendanceRecords.filter(a => a.status === 'present').length;
            const absentDays = attendanceRecords.filter(a => a.status === 'absent').length;
            const halfDays = attendanceRecords.filter(a => a.status === 'half-day').length;
            
            const totalWorkingDays = moment(`${year}-${month}-01`).daysInMonth();
            const calculatedSalary = (presentDays + (halfDays * 0.5)) * (employee.basicSalary / totalWorkingDays);
            
            // Calculate advance deductions
            const advances = await Advance.find({
                employeeId: employee._id,
                isDeducted: false,
                createdAt: {
                    $gte: startDate.toDate(),
                    $lte: endDate.toDate()
                }
            });
            
            const advanceDeductions = advances.reduce((sum, advance) => sum + advance.amount, 0);
            const netSalary = Math.max(0, calculatedSalary - advanceDeductions);
            
            // Create salary record
            const salary = new Salary({
                employeeId: employee._id,
                month: parseInt(month),
                year: parseInt(year),
                basicSalary: employee.basicSalary,
                presentDays,
                absentDays,
                halfDays,
                totalWorkingDays,
                calculatedSalary,
                advanceDeductions,
                netSalary
            });
            
            await salary.save();
            
            // Mark advances as deducted
            await Advance.updateMany(
                { _id: { $in: advances.map(a => a._id) } },
                { isDeducted: true, deductedDate: Date.now() }
            );
        }
        
        res.redirect('/employees/salary');
    } catch (error) {
        console.error('Error calculating salaries:', error);
        res.status(500).send('Error calculating salaries');
    }
});

// Individual Employee Salary Details Route
app.get('/employees/salary/:id', async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return res.status(404).send('Employee not found');
        }
        
        // Get all salary records for this employee
        const salaries = await Salary.find({ employeeId: req.params.id })
            .sort({ year: -1, month: -1 });
        
        // Get all advances for this employee
        const advances = await Advance.find({ employeeId: req.params.id })
            .sort({ createdAt: -1 });
        
        // Calculate totals
        const totalSalaryPaid = salaries.filter(s => s.status === 'paid').reduce((sum, s) => sum + s.netSalary, 0);
        const totalAdvances = advances.reduce((sum, a) => sum + a.amount, 0);
        const pendingAdvances = advances.filter(a => !a.isDeducted).reduce((sum, a) => sum + a.amount, 0);
        
        res.render('employees/salary-details', {
            employee: employee.toObject(),
            salaries: salaries.map(s => s.toObject()),
            advances: advances.map(a => a.toObject()),
            totalSalaryPaid,
            totalAdvances,
            pendingAdvances,
            title: `Salary Details - ${employee.name}`
        });
    } catch (error) {
        console.error('Error loading salary details:', error);
        res.status(500).send('Error loading salary details');
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Ramlila Pedhewale Factory app running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the application`);
});
