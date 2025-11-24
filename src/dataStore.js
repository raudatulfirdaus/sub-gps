// Simple in-memory data store
// In a real application, this would be a database

const dataStore = {
    devices: [], // Master Data
    serviceLogs: [] // Service History
};

// Seed some initial data for testing if needed
// dataStore.devices.push({
//     deviceId: "12345",
//     name: "Truck A",
//     branch: "Jakarta",
//     division: "Logistics",
//     type: "GPS Only",
//     subStartDate: "2023-01-01",
//     subEndDate: "2024-01-01",
//     status: "Active"
// });

module.exports = dataStore;
