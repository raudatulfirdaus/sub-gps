const express = require('express');
const router = express.Router();
const db = require('./db');
const logic = require('./logic');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Home
router.get('/', async (req, res) => {
    try {
        const devices = await db.all('SELECT COUNT(*) as count FROM devices');
        const logs = await db.all('SELECT COUNT(*) as count FROM service_logs');
        res.render('index', {
            deviceCount: devices[0].count,
            logCount: logs[0].count
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

// Master Data
router.get('/master-data', async (req, res) => {
    try {
        const devices = await db.all('SELECT * FROM devices');
        res.render('master-data', { devices });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

router.post('/master-data/add', async (req, res) => {
    const { deviceId, name, branch, division, type, subStartDate, subEndDate, status } = req.body;
    try {
        await db.run(
            `INSERT INTO devices (deviceId, name, branch, division, type, subStartDate, subEndDate, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [deviceId, name, branch, division, type, subStartDate, subEndDate, status]
        );
        res.redirect('/master-data');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding device: " + err.message);
    }
});

router.post('/master-data/delete', async (req, res) => {
    const { deviceId } = req.body;
    try {
        await db.run('DELETE FROM devices WHERE deviceId = ?', [deviceId]);
        res.redirect('/master-data');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting device");
    }
});

// Excel Template Download
router.get('/master-data/template', (req, res) => {
    const wb = xlsx.utils.book_new();
    const wsData = [
        ['deviceId', 'name', 'branch', 'division', 'type', 'subStartDate', 'subEndDate', 'status'],
        ['12345', 'Truck A', 'Jakarta', 'Logistics', 'GPS Only', '2023-01-01', '2024-01-01', 'Active']
    ];
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, 'Template');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="device_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// Excel Upload
router.post('/master-data/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        for (const row of data) {
            // Basic validation
            if (row.deviceId && row.name) {
                // Sanitize Device ID (remove trailing .0)
                let deviceId = String(row.deviceId).trim();
                if (deviceId.endsWith('.0')) {
                    deviceId = deviceId.slice(0, -2);
                }

                await db.run(
                    `INSERT OR REPLACE INTO devices (deviceId, name, branch, division, type, subStartDate, subEndDate, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        deviceId,
                        row.name,
                        row.branch || '',
                        row.division || '',
                        row.type || 'GPS Only',
                        row.subStartDate,
                        row.subEndDate,
                        row.status || 'Active'
                    ]
                );
            }
        }

        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);

        res.redirect('/master-data');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error processing file: " + err.message);
    }
});

// Edit Device
router.get('/master-data/edit/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const device = await db.get('SELECT * FROM devices WHERE deviceId = ?', [id]);
        if (!device) {
            return res.status(404).send("Device not found");
        }
        res.render('edit-device', { device });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

router.post('/master-data/update', async (req, res) => {
    const { originalDeviceId, deviceId, name, branch, division, type, subStartDate, subEndDate, status } = req.body;
    try {
        // If ID changed, we might need to handle it carefully (delete old, insert new, update logs)
        // For simplicity, let's assume ID edit is allowed but might break logs if not cascaded.
        // Better approach: Update ID and cascade if DB supports it, or just update other fields.
        // Here we will just update the record identified by originalDeviceId

        await db.run(
            `UPDATE devices SET deviceId = ?, name = ?, branch = ?, division = ?, type = ?, subStartDate = ?, subEndDate = ?, status = ? 
             WHERE deviceId = ?`,
            [deviceId, name, branch, division, type, subStartDate, subEndDate, status, originalDeviceId]
        );

        res.redirect('/master-data');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating device: " + err.message);
    }
});

// Service Logs
router.get('/service-logs', async (req, res) => {
    try {
        const logs = await db.all('SELECT * FROM service_logs ORDER BY startDate DESC');
        const devices = await db.all('SELECT deviceId, name FROM devices');
        res.render('service-logs', { logs, devices });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

router.post('/service-logs/add', async (req, res) => {
    const { deviceId, startDate, endDate, description } = req.body;
    try {
        await db.run(
            `INSERT INTO service_logs (deviceId, startDate, endDate, description) 
             VALUES (?, ?, ?, ?)`,
            [deviceId, startDate, endDate, description]
        );
        res.redirect('/service-logs');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding log");
    }
});

// Report
router.get('/report', async (req, res) => {
    const reportMonth = req.query.month || new Date().toISOString().slice(0, 7); // Default current month YYYY-MM

    try {
        const devices = await db.all('SELECT * FROM devices');
        const logs = await db.all('SELECT * FROM service_logs');

        // Calculate status for all devices
        const results = devices.map(device => {
            const deviceLogs = logs.filter(l => l.deviceId === device.deviceId);
            const statusResult = logic.calculateStatus(device, reportMonth, deviceLogs);
            return {
                device,
                ...statusResult
            };
        });

        const summary = logic.aggregateByDivision(results);

        res.render('report', { reportMonth, summary });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

module.exports = router;
