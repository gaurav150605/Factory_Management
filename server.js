require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const moment = require('moment');
const session = require('express-session');
const MongoStore = require('connect-mongo');


// Import models
const Employee = require('./models/Employee');
const Attendance = require('./models/Attendance');
const Advance = require('./models/Advance');
const Salary = require('./models/Salary');
const Sale = require('./models/Sale');
const SimpleSale = require('./models/SimpleSale');
const User = require('./models/User');
const dburl =process.env.URL;
const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB connection
mongoose.connect(dburl ,{
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

const store=MongoStore.create({
    mongoUrl:dburl,
    crypto:{
        secret:process.env.SECRET,
    }
})

// Session middleware
app.use(session({
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/auth/login');
    }
};

// Make user data available to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Routes

// Authentication Routes
app.get('/auth/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.render('auth/login', { title: 'Login', layout: false });
});

app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findOne({ 
            $or: [{ username }, { email: username }],
            isActive: true 
        });
        
        if (!user) {
            return res.render('auth/login', { 
                error: 'Invalid username or password',
                title: 'Login',
                layout: false
            });
        }
        
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.render('auth/login', { 
                error: 'Invalid username or password',
                title: 'Login',
                layout: false
            });
        }
        
        // Update last login
        user.lastLogin = new Date();
        await user.save();
        
        // Set session
        req.session.userId = user._id;
        req.session.user = {
            id: user._id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            role: user.role
        };
        
        res.redirect('/');
    } catch (error) {
        console.error('Login error:', error);
        res.render('auth/login', { 
            error: 'An error occurred during login',
            title: 'Login',
            layout: false
        });
    }
});

app.get('/auth/register', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.render('auth/register', { title: 'Register', layout: false });
});

app.post('/auth/register', async (req, res) => {
    try {
        const { username, email, password, confirmPassword, fullName, role } = req.body;
        
        // Validation
        if (password !== confirmPassword) {
            return res.render('auth/register', { 
                error: 'Passwords do not match',
                title: 'Register',
                layout: false
            });
        }
        
        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ username }, { email }]
        });
        
        if (existingUser) {
            return res.render('auth/register', { 
                error: 'Username or email already exists',
                title: 'Register',
                layout: false
            });
        }
        
        // Create new user
        const user = new User({
            username,
            email,
            password,
            fullName,
            role: role || 'employee'
        });
        
        await user.save();
        
        res.render('auth/login', { 
            success: 'Account created successfully! Please login.',
            title: 'Login',
            layout: false
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.render('auth/register', { 
            error: 'An error occurred during registration',
            title: 'Register',
            layout: false
        });
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/auth/login');
    });
});

// Dashboard
app.get('/', requireAuth, (req, res) => {
    res.render('dashboard', {
        title: 'Ramlila Pedhewale Factory',
        factoryName: 'Ramlila Pedhewale-Bidkar'
    });
});

// Sales Management Routes
// Sales list - show both simple and multi-product sales
app.get('/sales', requireAuth, async (req, res) => {
    try {
        const [simpleSales, multiSales] = await Promise.all([
            SimpleSale.find({ userId: req.session.userId }).sort({ createdAt: -1 }),
            Sale.find({ userId: req.session.userId }).sort({ createdAt: -1 })
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
app.get('/stock', requireAuth, (req, res) => {
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

app.get('/stock/add', requireAuth, (req, res) => {
    res.render('stock/add', { title: 'Add Stock' });
});

app.post('/stock/add', requireAuth, (req, res) => {
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

app.get('/stock/edit/:id', requireAuth, (req, res) => {
    const stock = readData(STOCK_FILE);
    const stockItem = stock.find(s => s.id === req.params.id);
    
    if (!stockItem) {
        return res.status(404).send('Stock item not found');
    }
    
    res.render('stock/edit', { stockItem, title: 'Edit Stock' });
});

app.post('/stock/edit/:id', requireAuth, (req, res) => {
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

app.post('/stock/delete/:id', requireAuth, (req, res) => {
    const stock = readData(STOCK_FILE);
    const filteredStock = stock.filter(s => s.id !== req.params.id);
    
    if (writeData(STOCK_FILE, filteredStock)) {
        res.redirect('/stock');
    } else {
        res.status(500).json({ error: 'Failed to delete stock item' });
    }
});

// Product Management Routes
app.get('/products', requireAuth, (req, res) => {
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

app.get('/products/add', requireAuth, (req, res) => {
    res.render('products/add', { title: 'Add Product' });
});

app.post('/products/add', requireAuth, (req, res) => {
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

app.get('/products/edit/:id', requireAuth, (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const product = products.find(p => p.id === req.params.id);
    
    if (!product) {
        return res.status(404).send('Product not found');
    }
    
    res.render('products/edit', { product, title: 'Edit Product' });
});

app.post('/products/edit/:id', requireAuth, (req, res) => {
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

app.post('/products/delete/:id', requireAuth, (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const filteredProducts = products.filter(p => p.id !== req.params.id);
    
    if (writeData(PRODUCTS_FILE, filteredProducts)) {
        res.redirect('/products');
    } else {
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Invoice Generation
const buildPuppeteerLaunchOptions = () => {
    // retained for fallback; not used by PDFKit path
    const commonArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
    const isRender = !!process.env.RENDER;
    const isWin = process.platform === 'win32';
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
        || process.env.CHROMIUM_PATH
        || (isWin ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    return { headless: 'new', args: isRender ? [...commonArgs, '--single-process', '--no-zygote', '--disable-gpu'] : commonArgs, executablePath: executablePath || undefined };
};

const handleInvoice = async (req, res) => {
    const saleId = (req.params && req.params.id) || (req.body && req.body.saleId) || (req.query && req.query.saleId);
    
    if (!saleId) {
        return res.status(400).json({ error: 'Sale ID is required' });
    }
    
    try {
        // Try simple sale first, then complex sale
        let simple = await SimpleSale.findOne({ _id: saleId, userId: req.session.userId });
        let sale = simple || await Sale.findOne({ _id: saleId, userId: req.session.userId });
        
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        
        // Generate PDF with PDFKit (avoids headless browser issues)
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
            const pdf = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            const code = (simple? simple._id : (sale._id || sale.id)).toString().substring(0,8);
            res.setHeader('Content-Disposition', `attachment; filename="invoice-${code}.pdf"`);
            res.send(pdf);
        });

        // Header
        doc.fontSize(20).text('Ramlila Pedhewale Factory', { align: 'center' });
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#555').text('Traditional Sweet Manufacturing', { align: 'center' });
        doc.moveDown(1);
        doc.fillColor('#000');

        // Invoice meta
        const invId = (simple? simple._id : (sale._id || sale.id)).toString().substring(0,8);
        const invDate = moment((simple? simple.date : sale.date) || (simple? simple.createdAt : sale.createdAt) || new Date()).format('DD-MM-YYYY');
        doc.fontSize(14).text(`Invoice #${invId}`);
        doc.fontSize(10).text(`Date: ${invDate}`);
        doc.moveDown(0.5);

        // Customer
        const customerName = (simple? simple.customerName : sale.customerName) || 'Customer';
        const customerPhone = (simple? simple.customerPhone : sale.customerPhone) || '';
        const customerAddress = sale && sale.customerAddress ? sale.customerAddress : '';
        doc.fontSize(12).text(`Customer: ${customerName}`);
        if (customerPhone) doc.text(`Phone: ${customerPhone}`);
        if (customerAddress) doc.text(`Address: ${customerAddress}`);
        doc.moveDown(1);

        // Items/Amounts with proper table layout
        if (!simple && sale && sale.items && sale.items.length > 0) {
            const tableTop = doc.y + 5;
            const colX = [40, 260, 320, 420];
            const colW = [220, 60, 100, 120];
            const rowH = 22;

            // Header background
            doc.save();
            doc.rect(colX[0], tableTop, colW[0] + colW[1] + colW[2] + colW[3], rowH).fill('#F2F2F2');
            doc.restore();

            // Header text
            doc.fontSize(11).fillColor('#000');
            doc.text('Product', colX[0] + 6, tableTop + 6);
            doc.text('Qty', colX[1] + 6, tableTop + 6);
            doc.text('Unit Price', colX[2] + 6, tableTop + 6);
            doc.text('Line Total', colX[3] + 6, tableTop + 6);

            // Header border
            doc.moveTo(colX[0], tableTop)
               .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], tableTop)
               .stroke();
            doc.moveTo(colX[0], tableTop + rowH)
               .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], tableTop + rowH)
               .stroke();

            // Vertical header lines
            let xAcc = colX[0];
            [colW[0], colW[1], colW[2], colW[3]].forEach((w) => {
                doc.moveTo(xAcc, tableTop)
                   .lineTo(xAcc, tableTop + rowH)
                   .stroke();
                xAcc += w;
            });
            // Right-most line
            doc.moveTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], tableTop)
               .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], tableTop + rowH)
               .stroke();

            // Rows
            let y = tableTop + rowH;
            doc.fontSize(10);
            sale.items.forEach((item) => {
                const name = item.productName || 'Product';
                const qty = Number(item.quantity) || 0;
                const price = Number(item.price) || 0;
                const lineTotal = Number.isFinite(Number(item.totalAmount)) ? Number(item.totalAmount) : qty * price;

                // Row border top
                doc.moveTo(colX[0], y)
                   .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], y)
                   .stroke();

                // Text
                doc.text(name, colX[0] + 6, y + 6, { width: colW[0] - 12 });
                doc.text(`${qty} kg`, colX[1] + 6, y + 6, { width: colW[1] - 12 });
                doc.text(`₹${price.toFixed(2)}`, colX[2] + 6, y + 6, { width: colW[2] - 12, align: 'right' });
                doc.text(`₹${lineTotal.toFixed(2)}`, colX[3] + 6, y + 6, { width: colW[3] - 12, align: 'right' });

                // Vertical lines for row
                let x = colX[0];
                [colW[0], colW[1], colW[2], colW[3]].forEach((w) => {
                    doc.moveTo(x, y)
                       .lineTo(x, y + rowH)
                       .stroke();
                    x += w;
                });
                // Right-most line
                doc.moveTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], y)
                   .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], y + rowH)
                   .stroke();

                y += rowH;
            });

            // Bottom border
            doc.moveTo(colX[0], y)
               .lineTo(colX[0] + colW[0] + colW[1] + colW[2] + colW[3], y)
               .stroke();

            doc.moveDown(1.2);

            // Summary box (right aligned)
            const subtotal = Number(sale.subtotal) || 0;
            const discount = Number(sale.discount) || 0;
            const tax = Number(sale.tax) || 0;
            const total = Number(sale.totalAmount) || Math.max(0, subtotal - discount + tax);

            const boxW = 240;
            const boxX = 400;
            let boxY = y + 10;
            const lineGap = 18;
            doc.fontSize(11);
            doc.text('Subtotal:', boxX, boxY, { width: 120, align: 'left' });
            doc.text(`₹${subtotal.toFixed(2)}`, boxX + 120, boxY, { width: 120, align: 'right' });
            boxY += lineGap;
            if (discount > 0) {
                doc.text('Discount:', boxX, boxY, { width: 120, align: 'left' });
                doc.text(`-₹${discount.toFixed(2)}`, boxX + 120, boxY, { width: 120, align: 'right' });
                boxY += lineGap;
            }
            if (tax > 0) {
                doc.text('Tax:', boxX, boxY, { width: 120, align: 'left' });
                doc.text(`₹${tax.toFixed(2)}`, boxX + 120, boxY, { width: 120, align: 'right' });
                boxY += lineGap;
            }
            doc.fontSize(12).text('Total:', boxX, boxY + 4, { width: 120, align: 'left' });
            doc.fontSize(12).text(`₹${total.toFixed(2)}`, boxX + 120, boxY + 4, { width: 120, align: 'right' });
        } else {
            const amt = Number(simple.amount) || 0;

            const tableTop = doc.y + 5;
            const colX = [40, 360];
            const colW = [320, 180];
            const rowH = 22;

            // Header background
            doc.save();
            doc.rect(colX[0], tableTop, colW[0] + colW[1], rowH).fill('#F2F2F2');
            doc.restore();

            // Header
            doc.fontSize(11).fillColor('#000');
            doc.text('Description', colX[0] + 6, tableTop + 6);
            doc.text('Amount', colX[1] + 6, tableTop + 6, { width: colW[1] - 12, align: 'right' });

            // Borders
            doc.moveTo(colX[0], tableTop).lineTo(colX[0] + colW[0] + colW[1], tableTop).stroke();
            doc.moveTo(colX[0], tableTop + rowH).lineTo(colX[0] + colW[0] + colW[1], tableTop + rowH).stroke();
            doc.moveTo(colX[0], tableTop).lineTo(colX[0], tableTop + rowH).stroke();
            doc.moveTo(colX[0] + colW[0], tableTop).lineTo(colX[0] + colW[0], tableTop + rowH).stroke();
            doc.moveTo(colX[0] + colW[0] + colW[1], tableTop).lineTo(colX[0] + colW[0] + colW[1], tableTop + rowH).stroke();

            // Row
            const y = tableTop + rowH;
            doc.moveTo(colX[0], y).lineTo(colX[0] + colW[0] + colW[1], y).stroke();
            doc.text('Sale', colX[0] + 6, y + 6);
            doc.text(`₹${amt.toFixed(2)}`, colX[1] + 6, y + 6, { width: colW[1] - 12, align: 'right' });
            // Bottom border
            doc.moveTo(colX[0], y + rowH).lineTo(colX[0] + colW[0] + colW[1], y + rowH).stroke();

            // Total bold line
            doc.moveDown(1.2);
            doc.fontSize(12).text('Total:', colX[1] - 80, y + rowH + 10, { width: 80, align: 'left' });
            doc.fontSize(12).text(`₹${amt.toFixed(2)}`, colX[1], y + rowH + 10, { width: colW[1], align: 'right' });
        }

        // Footer
        doc.moveDown(2);
        doc.fontSize(10).fillColor('#555').text('Thank you for your business!', { align: 'center' });
        doc.fontSize(9).text('Ramlila Pedhewale Factory - Quality Sweets Since Generations', { align: 'center' });

        doc.end();
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
};

app.post('/getInvoice', requireAuth, handleInvoice);
app.get('/getInvoice', requireAuth, handleInvoice);
app.get('/sales/invoice/:id', requireAuth, handleInvoice);

// Reporting Routes
app.get('/reports', requireAuth, async (req, res) => {
    const products = readData(PRODUCTS_FILE);
    const stock = readData(STOCK_FILE);
    
    const simpleSales = await SimpleSale.find({ userId: req.session.userId }).sort({ createdAt: -1 });
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
app.get('/sales/add-multiple', requireAuth, (req, res) => {
    const products = readData(PRODUCTS_FILE);
    res.render('sales/add-multiple', { products, title: 'Add Sale' });
});

app.get('/sales/add', requireAuth, (req, res) => {
    const products = readData(PRODUCTS_FILE);
    res.render('sales/add-multiple', { products, title: 'Add Sale' });
});

app.post('/sales/add', requireAuth, async (req, res) => {
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
            userId: req.session.userId,
            customerName,
            customerPhone,
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
app.get('/employees', requireAuth, async (req, res) => {
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

app.get('/employees/add', requireAuth, (req, res) => {
    res.render('employees/add', { title: 'Add Employee' });
});

app.post('/employees/add', requireAuth, async (req, res) => {
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

app.get('/employees/edit/:id', requireAuth, async (req, res) => {
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

app.post('/employees/edit/:id', requireAuth, async (req, res) => {
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

app.post('/employees/delete/:id', requireAuth, async (req, res) => {
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
app.get('/employees/salary', requireAuth, async (req, res) => {
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

app.post('/employees/salary/calculate', requireAuth, async (req, res) => {
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
app.get('/employees/salary/:id', requireAuth, async (req, res) => {
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
