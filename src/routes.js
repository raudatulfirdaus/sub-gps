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

// Vendor Invoice Template Download
router.get('/report/vendor-template', (req, res) => {
    const wb = xlsx.utils.book_new();
    const wsData = [
        ['MONTH', 'PLAT NO'],
        ['2024-11', '868738070001157'],
        ['2024-11', '868738070001158'],
        ['2024-11', '868738070001159']
    ];
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, 'Vendor Invoice');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="vendor_invoice_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// Upload Vendor Invoice
router.post('/report/upload-vendor', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const { month } = req.body;
    if (!month) {
        return res.status(400).send('Report month is required.');
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        // Clear existing vendor data for this month
        await db.run('DELETE FROM vendor_invoices WHERE reportMonth = ?', [month]);

        // Insert vendor data
        const uploadDate = new Date().toISOString();
        for (const row of data) {
            let deviceId = row['PLAT NO'] || row['PLAT_NO'] || row.deviceId;
            if (deviceId) {
                // Sanitize Device ID
                deviceId = String(deviceId).trim();
                if (deviceId.endsWith('.0')) {
                    deviceId = deviceId.slice(0, -2);
                }

                await db.run(
                    `INSERT INTO vendor_invoices (deviceId, reportMonth, uploadDate) 
                     VALUES (?, ?, ?)`,
                    [deviceId, month, uploadDate]
                );
            }
        }

        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);

        res.redirect(`/report/reconcile?month=${month}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error processing vendor file: " + err.message);
    }
});

// Reconciliation Report
router.get('/report/reconcile', async (req, res) => {
    const { month } = req.query;
    const reportMonth = month || new Date().toISOString().slice(0, 7);

    try {
        // Get all devices and logs
        const devices = await db.all('SELECT * FROM devices');
        const logs = await db.all('SELECT * FROM service_logs');
        const vendorData = await db.all('SELECT * FROM vendor_invoices WHERE reportMonth = ?', [reportMonth]);

        // Calculate internal status for all devices
        const internalData = devices.map(device => {
            const deviceLogs = logs.filter(l => l.deviceId === device.deviceId);
            const statusResult = logic.calculateStatus(device, reportMonth, deviceLogs);
            return {
                device: device,
                ...statusResult
            };
        });

        // Create reconciliation results
        const reconciliation = [];
        const vendorDeviceIds = new Set(vendorData.map(v => v.deviceId));

        // Process vendor billed devices
        vendorData.forEach(vendorItem => {
            const internalItem = internalData.find(d => d.device.deviceId === vendorItem.deviceId);

            if (internalItem) {
                const shouldBeBilled = internalItem.status === 'BILLABLE';
                const vendorBilling = 'BILLED';
                const ourRecommendation = shouldBeBilled ? 'BILLED' : 'UNBILLED';
                const discrepancy = shouldBeBilled ? 'MATCH' : 'DISPUTE';

                reconciliation.push({
                    deviceId: vendorItem.deviceId,
                    device: internalItem.device,
                    vendorStatus: vendorBilling,
                    internalStatus: internalItem.status,
                    ourRecommendation: ourRecommendation,
                    discrepancy: discrepancy,
                    reason: internalItem.note,
                    cost: internalItem.cost
                });
            } else {
                // Vendor billing device not in our master data
                reconciliation.push({
                    deviceId: vendorItem.deviceId,
                    device: { deviceId: vendorItem.deviceId, name: 'Unknown', division: vendorItem.division },
                    vendorStatus: 'BILLED',
                    internalStatus: 'NOT_IN_MASTER',
                    ourRecommendation: 'UNBILLED',
                    discrepancy: 'DISPUTE',
                    reason: 'Device not in master data',
                    cost: 0
                });
            }
        });

        // Check for devices we expect to bill but vendor doesn't
        internalData.forEach(internalItem => {
            if (internalItem.status === 'BILLABLE' && !vendorDeviceIds.has(internalItem.device.deviceId)) {
                reconciliation.push({
                    deviceId: internalItem.device.deviceId,
                    device: internalItem.device,
                    vendorStatus: 'NOT_BILLED',
                    internalStatus: internalItem.status,
                    ourRecommendation: 'BILLED',
                    discrepancy: 'MISSING',
                    reason: 'Should be billed but vendor not billing',
                    cost: internalItem.cost
                });
            }
        });

        // Calculate summary
        const summary = {
            total: reconciliation.length,
            matched: reconciliation.filter(r => r.discrepancy === 'MATCH').length,
            disputes: reconciliation.filter(r => r.discrepancy === 'DISPUTE').length,
            missing: reconciliation.filter(r => r.discrepancy === 'MISSING').length,
            vendorTotal: vendorData.length,
            ourBillableTotal: internalData.filter(d => d.status === 'BILLABLE').length
        };

        res.render('reconcile', { reconciliation, summary, reportMonth, hasVendorData: vendorData.length > 0 });
    } catch (err) {
        console.error("Reconciliation Error:", err);
        res.status(500).send("Error generating reconciliation: " + err.message);
    }
});

// Export Reconciliation to Excel
router.get('/report/reconcile/export', async (req, res) => {
    const { month } = req.query;
    const reportMonth = month || new Date().toISOString().slice(0, 7);

    try {
        // Get all devices and logs
        const devices = await db.all('SELECT * FROM devices');
        const logs = await db.all('SELECT * FROM service_logs');
        const vendorData = await db.all('SELECT * FROM vendor_invoices WHERE reportMonth = ?', [reportMonth]);

        // Calculate internal status for all devices
        const internalData = devices.map(device => {
            const deviceLogs = logs.filter(l => l.deviceId === device.deviceId);
            const statusResult = logic.calculateStatus(device, reportMonth, deviceLogs);
            return {
                device: device,
                ...statusResult
            };
        });

        // Create reconciliation results
        const reconciliation = [];
        const vendorDeviceIds = new Set(vendorData.map(v => v.deviceId));

        vendorData.forEach(vendorItem => {
            const internalItem = internalData.find(d => d.device.deviceId === vendorItem.deviceId);

            if (internalItem) {
                const shouldBeBilled = internalItem.status === 'BILLABLE';
                reconciliation.push({
                    deviceId: vendorItem.deviceId,
                    name: internalItem.device.name,
                    division: internalItem.device.division,
                    vendorStatus: 'BILLED',
                    internalStatus: internalItem.status,
                    ourRecommendation: shouldBeBilled ? 'BILLED' : 'UNBILLED',
                    discrepancy: shouldBeBilled ? 'MATCH' : 'DISPUTE',
                    reason: internalItem.note
                });
            } else {
                reconciliation.push({
                    deviceId: vendorItem.deviceId,
                    name: 'Unknown',
                    division: vendorItem.division,
                    vendorStatus: 'BILLED',
                    internalStatus: 'NOT_IN_MASTER',
                    ourRecommendation: 'UNBILLED',
                    discrepancy: 'DISPUTE',
                    reason: 'Device not in master data'
                });
            }
        });

        // Create Excel
        const wb = xlsx.utils.book_new();
        const excelData = [];

        excelData.push(['Vendor Reconciliation Report']);
        excelData.push(['Report Month:', reportMonth]);
        excelData.push([]);
        excelData.push(['Device ID', 'Unit Name', 'Division', 'Vendor Status', 'Internal Status', 'Our Recommendation', 'Discrepancy', 'Reason']);

        reconciliation.forEach(item => {
            excelData.push([
                item.deviceId,
                item.name,
                item.division,
                item.vendorStatus,
                item.internalStatus,
                item.ourRecommendation,
                item.discrepancy,
                item.reason
            ]);
        });

        const ws = xlsx.utils.aoa_to_sheet(excelData);
        xlsx.utils.book_append_sheet(wb, ws, 'Reconciliation');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="vendor_reconciliation_${reportMonth}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Error exporting reconciliation: " + err.message);
    }
});

module.exports = router;
