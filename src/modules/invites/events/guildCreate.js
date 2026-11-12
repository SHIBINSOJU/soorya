const { cacheGuildInvites } = require('../services/inviteCache');

module.exports = {
    name: 'guildCreate',
    async execute(guild) {
        await cacheGuildInvites(guild);
    }
};
