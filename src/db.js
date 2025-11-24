const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../sub-gps.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Create Devices table
        db.run(`CREATE TABLE IF NOT EXISTS devices (
            deviceId TEXT PRIMARY KEY,
            name TEXT,
            branch TEXT,
            division TEXT,
            type TEXT,
            subStartDate TEXT,
            subEndDate TEXT,
            status TEXT
        )`);

        // Create Service Logs table
        db.run(`CREATE TABLE IF NOT EXISTS service_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deviceId TEXT,
            startDate TEXT,
            endDate TEXT,
            description TEXT,
            repairType TEXT,
            FOREIGN KEY(deviceId) REFERENCES devices(deviceId)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS vendor_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deviceId TEXT,
        reportMonth TEXT,
        customers TEXT,
        division TEXT,
        type TEXT,
        uploadDate TEXT
    )`);
    });
}

// Helper functions for async DB operations
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

module.exports = {
    db,
    all,
    run,
    get
};
