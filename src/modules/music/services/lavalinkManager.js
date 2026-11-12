const { Kazagumo } = require('kazagumo');
const { Connectors } = require('shoukaku');
const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    MessageFlags
} = require('discord.js');
const logger = require('../../../core/logger');
const configService = require('../../../core/configService');
const { formatDuration } = require('./musicUtils');

let kazagumoInstance = null;

function getNodes() {
    // 1. Check environment variables
    if (process.env.LAVALINK_HOST) {
        const host = process.env.LAVALINK_HOST;
        const port = process.env.LAVALINK_PORT || '2333';
        const auth = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
        const secure = process.env.LAVALINK_SECURE === 'true';
        return [{
            name: 'Env-Lavalink',
            url: `${host}:${port}`,
            auth,
            secure
        }];
    }

    // 2. Check config.yml
    const configNodes = configService.get('music.nodes', []);
    if (Array.isArray(configNodes) && configNodes.length > 0) {
        return configNodes;
    }

    // 3. Default fallback
    return [{
        name: 'Default-Node',
        url: 'localhost:2333',
        auth: 'youshallnotpass',
        secure: false
    }];
}

function initLavalink(client) {
    if (kazagumoInstance) return kazagumoInstance;

    const nodes = getNodes();
    const defaultSearchEngine = configService.get('music.defaultSearchEngine', 'youtube');

    logger.info(`Lavalink: Initializing Kazagumo with ${nodes.length} node(s)...`);

    kazagumoInstance = new Kazagumo({
        defaultSearchEngine,
        send: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        }
    }, new Connectors.DiscordJS(client), nodes);

    // Shoukaku (Node) events
    kazagumoInstance.shoukaku.on('ready', (name) => {
        logger.info(`Lavalink Node [${name}] connected successfully!`);
    });

    kazagumoInstance.shoukaku.on('error', (name, error) => {
        logger.error(`Lavalink Node [${name}] error: ${error?.message || error}`);
    });

    kazagumoInstance.shoukaku.on('close', (name, code, reason) => {
        logger.warn(`Lavalink Node [${name}] closed (code: ${code}, reason: ${reason || 'none'}).`);
    });

    kazagumoInstance.shoukaku.on('disconnect', (name, count) => {
        logger.warn(`Lavalink Node [${name}] disconnected (reconnecting attempt: ${count}).`);
    });

    // Kazagumo (Player) events
    kazagumoInstance.on('playerStart', async (player, track) => {
        try {
            if (!player.textId) return;
            const channel = client.channels.cache.get(player.textId) || await client.channels.fetch(player.textId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const container = new ContainerBuilder().setAccentColor(0x5865F2);

            const section = new SectionBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## 🎵 Now Playing\n**[${track.title}](${track.uri})**`)
            );
            if (track.thumbnail) {
                section.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
            }
            container.addSectionComponents(section);

            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );

            const lines = [
                `👤 **Author:** ${track.author || 'Unknown'}`,
                `⏱️ **Duration:** \`${formatDuration(track.length)}\``,
                `🙋 **Requested by:** <@${track.requester?.id || player.requester?.id || 'unknown'}>`
            ];

            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

            await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container]
            });
        } catch (err) {
            logger.error(`Lavalink playerStart notification failed: ${err.message}`);
        }
    });

    kazagumoInstance.on('playerEmpty', async (player) => {
        const leaveDelay = configService.get('music.leaveOnEmptyDelayMs', 60000);
        setTimeout(async () => {
            if (player && player.queue.length === 0 && !player.playing) {
                try {
                    player.destroy();
                    if (player.textId) {
                        const channel = client.channels.cache.get(player.textId);
                        if (channel && channel.isTextBased()) {
                            await channel.send('👋 Queue ended. Left voice channel to save resources.').catch(() => {});
                        }
                    }
                } catch {}
            }
        }, leaveDelay);
    });

    return kazagumoInstance;
}

function getKazagumo() {
    return kazagumoInstance;
}

module.exports = {
    initLavalink,
    getKazagumo
};
