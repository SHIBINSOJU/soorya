require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('./src/core/logger');
const configService = require('./src/core/configService');
const ModuleManager = require('./src/core/moduleManager');
const createCoreModule = require('./src/core/coreModule');
const { connectDatabase } = require('./src/database/connection');
const { isTransientError } = require('./src/utils/retry');

function createBotClient(privileged = true) {
    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildScheduledEvents
    ];

    if (privileged) {
        intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent);
    }

    const c = new Client({
        intents,
        partials: [
            Partials.Message,
            Partials.Channel,
            Partials.GuildMember,
            Partials.Reaction,
            Partials.User,
            Partials.ThreadMember,
            Partials.GuildScheduledEvent
        ]
    });

    c.on('error', (error) => {
        logger.error(`Client error: ${error.message}`);
    });

    return c;
}

let client = createBotClient(true);
let moduleManager = new ModuleManager(client, configService);

process.on('unhandledRejection', (error) => {
    if (error && error.message === 'Used disallowed intents') {
        logger.warn('Privileged intents disallowed: running with standard gateway intents.');
        return;
    }
    if (isTransientError(error)) {
        logger.warn(`Transient network blip (ignored, the client reconnects on its own): ${error?.message || error}`);
        return;
    }
    logger.error(`Unhandled promise rejection: ${error}`);
});

process.on('uncaughtException', (error) => {
    // Flaky networks can abort the gateway WebSocket handshake; discord.js
    // retries the connection by itself, so this must not look fatal.
    if (isTransientError(error)) {
        logger.warn(`Transient network blip (ignored, the client reconnects on its own): ${error.message}`);
        return;
    }
    logger.error(`Uncaught exception: ${error.stack || error}`);
});

if (!process.env.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN is missing in environment variables.');
    process.exit(1);
}

async function loginWithRetry(maxAttempts = 8, delayMs = 5000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (error) {
            // A bad token or config never heals — only ride out network blips.
            if (!isTransientError(error)) throw error;
            if (attempt === maxAttempts) throw error;
            const wait = Math.min(delayMs * attempt, 30000);
            logger.warn(`Login attempt ${attempt}/${maxAttempts} failed (${error.message}). Retrying in ${Math.round(wait / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, wait));
        }
    }
}

async function detectPrivilegedIntents() {
    const probe = createBotClient(true);
    try {
        await probe.login(process.env.DISCORD_TOKEN);
        probe.destroy();
        return true;
    } catch (err) {
        if (err && err.message === 'Used disallowed intents') {
            return false;
        }
        return true;
    }
}

async function start() {
    await connectDatabase(process.env.MONGODB_URI);

    const hasPrivileged = await detectPrivilegedIntents();
    if (!hasPrivileged) {
        logger.warn('⚠️ Server Members Intent or Message Content Intent is disabled in the Discord Developer Portal.');
        logger.warn('⚠️ Running with standard gateway intents so all slash commands, tickets, music, and admin features run normally.');
        logger.warn('⚠️ (To enable Invite Tracking and AutoMod, turn them ON at https://discord.com/developers/applications/1566350596339142726/bot)');
        client = createBotClient(false);
        moduleManager = new ModuleManager(client, configService);
    }

    const ctx = { client, moduleManager, config: configService };
    await moduleManager.loadModules(createCoreModule(ctx));

    await loginWithRetry();
}

start().catch((error) => {
    logger.error(`Fatal startup error: ${error.stack || error}`);
    process.exit(1);
});
