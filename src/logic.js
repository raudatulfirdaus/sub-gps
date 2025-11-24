const { parseISO, isBefore, isAfter, startOfMonth, endOfMonth, isWithinInterval, differenceInDays, getDaysInMonth } = require('date-fns');

/**
 * Calculate the status of a device for a specific report month.
 * @param {Object} device - The device object.
 * @param {string} reportMonth - The report month in 'YYYY-MM' format.
 * @param {Array} serviceLogs - List of service logs for this device.
 * @returns {Object} - { status: string, cost: number, note: string }
 */
function calculateStatus(device, reportMonth, serviceLogs) {
    // Validate required date fields
    if (!device.subStartDate || !device.subEndDate) {
        return { status: 'ERROR', cost: 0, note: 'Missing contract dates' };
    }

    const reportDate = parseISO(reportMonth + '-01'); // First day of report month
    const reportMonthStart = startOfMonth(reportDate);
    const reportMonthEnd = endOfMonth(reportDate);

    const subStartDate = parseISO(device.subStartDate);
    const subEndDate = parseISO(device.subEndDate);

    // Level 1: Logika Masa Kontrak
    // Cek apakah bulan rekap berada di luar masa kontrak

    // Jika awal bulan rekap sudah setelah akhir kontrak -> EXPIRED
    if (isAfter(reportMonthStart, subEndDate)) {
        return { status: 'EXPIRED', cost: 0, note: 'Contract Expired' };
    }

    // Jika akhir bulan rekap masih sebelum awal kontrak -> PENDING
    // (Meaning the whole month is before the start date)
    if (isBefore(reportMonthEnd, subStartDate)) {
        return { status: 'PENDING', cost: 0, note: 'Contract Not Started' };
    }

    // Level 2: Logika Servis
    // Cek apakah ada servis yang mencakup FULL satu bulan ini

    let isFullService = false;

    for (const log of serviceLogs) {
        // Skip logs without start date
        if (!log.startDate) continue;

        const srvStart = parseISO(log.startDate);
        const srvEnd = log.endDate ? parseISO(log.endDate) : new Date(); // If ongoing, assume until now/future

        // Check if service covers the entire report month
        // Service start must be <= Month Start AND Service end must be >= Month End
        if ((isBefore(srvStart, reportMonthStart) || srvStart.getTime() === reportMonthStart.getTime()) &&
            (isAfter(srvEnd, reportMonthEnd) || srvEnd.getTime() === reportMonthEnd.getTime())) {
            isFullService = true;
            break;
        }
    }

    if (isFullService) {
        return { status: 'SERVICE', cost: 0, note: 'Full Month Service' };
    }

    // Default: BILLABLE
    // Cost logic could be more complex, but for now let's assume a fixed rate or just flag it
    return { status: 'BILLABLE', cost: 100000, note: 'Active' }; // Example cost 100k
}

function aggregateByDivision(results) {
    const summary = {};

    results.forEach(item => {
        const div = item.device.division || 'Unassigned';
        if (!summary[div]) {
            summary[div] = {
                division: div,
                totalDevices: 0,
                billableCount: 0,
                totalCost: 0,
                items: []
            };
        }

        summary[div].totalDevices++;
        if (item.status === 'BILLABLE') {
            summary[div].billableCount++;
            summary[div].totalCost += item.cost;
        }
        summary[div].items.push(item);
    });

    return summary;
}

module.exports = {
    calculateStatus,
    aggregateByDivision
};
