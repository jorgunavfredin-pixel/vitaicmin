/**
 * Logger — File-based logging with rotation
 * Writes to logs/bot.log + console
 * Auto-rotates when file exceeds MAX_SIZE
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_FILES = 5; // Keep 5 rotated files

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Rotate log files if current one exceeds MAX_SIZE
const rotateIfNeeded = () => {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const stats = fs.statSync(LOG_FILE);
        if (stats.size < MAX_SIZE) return;

        // Shift existing rotated files
        for (let i = MAX_FILES - 1; i >= 1; i--) {
            const from = path.join(LOG_DIR, `bot.${i}.log`);
            const to = path.join(LOG_DIR, `bot.${i + 1}.log`);
            if (fs.existsSync(from)) {
                if (i + 1 >= MAX_FILES) {
                    fs.unlinkSync(from); // Delete oldest
                } else {
                    fs.renameSync(from, to);
                }
            }
        }

        // Rename current to .1
        fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'bot.1.log'));
    } catch (e) {
        // Silently handle rotation errors
    }
};

// Format timestamp in WIB
const getTimestamp = () => {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

// Write log entry to file
const writeToFile = (level, message) => {
    try {
        rotateIfNeeded();
        const line = `[${getTimestamp()}] [${level}] ${message}\n`;
        fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch (e) {
        // Don't crash if log writing fails
    }
};

// Paksa satu event = satu baris. Payload upstream kadang berisi tutorial multiline;
// tanpa sanitasi, satu log entry terlihat seperti puluhan baris dan sulit dibaca.
const oneLine = (value) => String(value).replace(/\s+/g, ' ').trim();

const stringifyArg = (value, includeStack = false) => {
    if (value instanceof Error) {
        return oneLine(includeStack && value.stack ? `${value.message} | ${value.stack}` : value.message);
    }
    if (typeof value === 'object' && value !== null) {
        try { return oneLine(JSON.stringify(value)); } catch (e) { return '[unserializable object]'; }
    }
    return oneLine(value);
};

// Logger methods
const logger = {
    info: (...args) => {
        const msg = args.map(a => stringifyArg(a)).join(' ');
        console.log(msg);
        writeToFile('INFO', msg);
    },

    warn: (...args) => {
        const msg = args.map(a => stringifyArg(a)).join(' ');
        console.warn(msg);
        writeToFile('WARN', msg);
    },

    error: (...args) => {
        const msg = args.map(a => stringifyArg(a, true)).join(' ');
        console.error(msg);
        writeToFile('ERROR', msg);
    }
};

module.exports = logger;
