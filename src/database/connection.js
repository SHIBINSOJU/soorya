const mongoose = require('mongoose');
const logger = require('../core/logger');

let connected = false;
let useLocal = true;

async function connectDatabase(uri) {
    if (!uri || uri.includes('localhost') || uri.trim() === '') {
        useLocal = true;
        connected = true;
        logger.info('📦 Storage mode: Local disk storage (data/*.json). No MongoDB required.');
        return true;
    }

    try {
        mongoose.connection.on('connected', () => {
            connected = true;
            useLocal = false;
            logger.info('MongoDB connected.');
        });
        mongoose.connection.on('disconnected', () => {
            connected = true;
            useLocal = true;
            logger.warn('MongoDB disconnected. Switched to local disk storage fallback.');
        });
        mongoose.connection.on('error', (error) => {
            connected = true;
            useLocal = true;
            logger.warn(`MongoDB connection error: ${error.message}. Using local disk storage.`);
        });

        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        useLocal = false;
        connected = true;
        return true;
    } catch (error) {
        useLocal = true;
        connected = true;
        logger.info(`📦 Storage mode: Local disk storage (data/*.json). No external MongoDB required.`);
        return true;
    }
}

function isDatabaseReady() {
    return true; // Local storage or MongoDB is always ready
}

function requireDatabase() {
    return true;
}

function isUsingLocalStorage() {
    return useLocal;
}

module.exports = {
    connectDatabase,
    isDatabaseReady,
    requireDatabase,
    isUsingLocalStorage
};
