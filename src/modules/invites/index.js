const { initInviteCache } = require('./services/inviteCache');
const guildMemberAdd = require('./events/guildMemberAdd');
const guildMemberRemove = require('./events/guildMemberRemove');
const inviteCreate = require('./events/inviteCreate');
const inviteDelete = require('./events/inviteDelete');
const guildCreate = require('./events/guildCreate');
const invitesCommand = require('./commands/invites');

module.exports = {
    name: 'invites',
    commands: [
        invitesCommand
    ],
    events: [
        guildMemberAdd,
        guildMemberRemove,
        inviteCreate,
        inviteDelete,
        guildCreate
    ],
    components: [],
    async initialize({ client }) {
        if (client.isReady()) {
            await initInviteCache(client);
        } else {
            client.once('ready', async () => {
                await initInviteCache(client);
            });
        }
    }
};
