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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.q || '';

    try {
        let sql = 'SELECT * FROM devices';
        let countSql = 'SELECT COUNT(*) as count FROM devices';
        let params = [];

        if (search) {
            const searchTerm = `%${search}%`;
            sql += ' WHERE deviceId LIKE ? OR name LIKE ? OR division LIKE ?';
            countSql += ' WHERE deviceId LIKE ? OR name LIKE ? OR division LIKE ?';
            params = [searchTerm, searchTerm, searchTerm];
        }

        sql += ' LIMIT ? OFFSET ?';
        const queryParams = [...params, limit, offset];

        const devices = await db.all(sql, queryParams);
        const countResult = await db.all(countSql, params);
        const totalCount = countResult[0].count;
        const totalPages = Math.ceil(totalCount / limit);

        res.render('master-data', {
            devices,
            currentPage: page,
            totalPages,
            search,
            totalCount
        });
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

                // Convert Excel serial dates to YYYY-MM-DD format
                const convertExcelDate = (excelDate) => {
                    if (!excelDate) return null;
                    // If it's already a string in date format, return it
                    if (typeof excelDate === 'string' && excelDate.includes('-')) {
                        return excelDate;
                    }
                    // If it's a number (Excel serial date)
                    if (typeof excelDate === 'number') {
                        const date = new Date((excelDate - 25569) * 86400 * 1000);
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                    }
                    return excelDate;
                };

                await db.run(
                    `INSERT OR REPLACE INTO devices (deviceId, name, branch, division, type, subStartDate, subEndDate, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        deviceId,
                        row.name,
                        row.branch || '',
                        row.division || '',
                        row.type || 'GPS Only',
                        convertExcelDate(row.subStartDate),
                        convertExcelDate(row.subEndDate),
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
        const devices = await db.all('SELECT deviceId, name FROM devices ORDER BY name');
        const logs = await db.all('SELECT * FROM service_logs ORDER BY startDate DESC');
        res.render('service-logs', { devices, logs });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

router.post('/service-logs/add', async (req, res) => {
    const { deviceId, description, repairType, startDate, endDate } = req.body;
    try {
        await db.run(
            'INSERT INTO service_logs (deviceId, description, repairType, startDate, endDate) VALUES (?, ?, ?, ?, ?)',
            [deviceId, description, repairType, startDate, endDate]
        );
        res.redirect('/service-logs');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding log");
    }
});

router.get('/service-logs/edit/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const log = await db.get('SELECT * FROM service_logs WHERE id = ?', [id]);
        const devices = await db.all('SELECT deviceId, name FROM devices ORDER BY name');
        if (!log) {
            return res.status(404).send("Log not found");
        }
        res.render('edit-service-log', { log, devices });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

router.post('/service-logs/update', async (req, res) => {
    const { id, deviceId, description, repairType, startDate, endDate } = req.body;
    try {
        await db.run(
            'UPDATE service_logs SET deviceId = ?, description = ?, repairType = ?, startDate = ?, endDate = ? WHERE id = ?',
            [deviceId, description, repairType, startDate, endDate, id]
        );
        res.redirect('/service-logs');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating log");
    }
});

router.post('/service-logs/delete', async (req, res) => {
    const { id } = req.body;
    try {
        await db.run('DELETE FROM service_logs WHERE id = ?', [id]);
        res.redirect('/service-logs');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting log");
    }
});

// Report
router.get('/report', async (req, res) => {
    const { month } = req.query;
    const reportMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM

    try {
        // Fetch all devices and logs
        const devices = await db.all('SELECT * FROM devices');
        const logs = await db.all('SELECT * FROM service_logs');

        // Calculate status for each device
        const reportData = devices.map(device => {
            const deviceLogs = logs.filter(l => l.deviceId === device.deviceId);
            const statusResult = logic.calculateStatus(device, reportMonth, deviceLogs);
            return {
                device: device,
                ...statusResult
            };
        });

        // Aggregate by division
        const summary = logic.aggregateByDivision(reportData);

        res.render('report', { summary, reportMonth });
    } catch (err) {
        console.error("Report Generation Error:", err);
        res.status(500).send("Error generating report: " + err.message);
    }
});

// Export Report to Excel
router.get('/report/export', async (req, res) => {
    const { month } = req.query;
    const reportMonth = month || new Date().toISOString().slice(0, 7);

    try {
        const devices = await db.all('SELECT * FROM devices');
        const logs = await db.all('SELECT * FROM service_logs');

        const reportData = devices.map(device => {
            const deviceLogs = logs.filter(l => l.deviceId === device.deviceId);
            const statusResult = logic.calculateStatus(device, reportMonth, deviceLogs);
            return {
                device: device,
                ...statusResult
            };
        });

        const summary = logic.aggregateByDivision(reportData);

        // Create Excel workbook
        const wb = xlsx.utils.book_new();

        // Create data for Excel
        const excelData = [];
        excelData.push(['GPS Reconciliation Report']);
        excelData.push(['Report Month:', reportMonth]);
        excelData.push([]);

        Object.keys(summary).forEach(division => {
            excelData.push([`Division: ${division}`]);
            excelData.push(['Total Devices:', summary[division].totalDevices, 'Billable:', summary[division].billableCount, 'Total Cost:', summary[division].totalCost]);
            excelData.push([]);
            excelData.push(['Device ID', 'Unit Name', 'Branch', 'Division', 'Type', 'Contract Start', 'Contract End', 'Status', 'Note', 'Cost']);

            summary[division].items.forEach(item => {
                excelData.push([
                    item.device.deviceId,
                    item.device.name,
                    item.device.branch,
                    item.device.division,
                    item.device.type,
                    item.device.subStartDate,
                    item.device.subEndDate,
                    item.status,
                    item.note,
                    item.cost
                ]);
            });

            excelData.push([]);
            excelData.push(['Subtotal:', '', '', '', '', '', '', '', '', summary[division].totalCost]);
            excelData.push([]);
        });

        const ws = xlsx.utils.aoa_to_sheet(excelData);
        xlsx.utils.book_append_sheet(wb, ws, 'Report');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="reconciliation_report_${reportMonth}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Error exporting report: " + err.message);
    }
});

module.exports = router;
