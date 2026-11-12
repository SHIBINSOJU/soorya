const logger = require('../../core/logger');
const { validateWelcomeGif } = require('./services/welcomeMedia');
const { normalizeLayout } = require('./services/settings');

module.exports = {
    name: 'Welcome',

    // Runs once when the module is registered: validates the GIF configuration
    // up front so problems are visible at startup instead of at first welcome.
    async initialize({ config }) {
        const welcome = config.get('welcome', {}) || {};

        const result = validateWelcomeGif(welcome);
        if (result.ok) {
            logger.info(`Welcome GIF: ${result.message}`);
        } else {
            logger.warn(`Welcome GIF: ${result.message}`);
        }

        // The header thumbnail and the banner image are the primary visuals;
        // the legacy GIF above only kicks in when no banner url is configured.
        const banner = welcome.image?.enabled !== false && Boolean(welcome.image?.url?.trim());
        const thumbnail = welcome.thumbnail?.enabled !== false && Boolean(welcome.thumbnail?.url?.trim());
        logger.info(`Welcome media: thumbnail ${thumbnail ? 'configured' : 'member avatar'}, banner ${banner ? 'configured' : 'none'}.`);

        const background = Boolean(welcome.card?.background?.path?.trim() || welcome.card?.background?.url?.trim());
        logger.info(`Welcome layout: ${normalizeLayout(welcome.layout)}${background ? ' (card background configured)' : ''}.`);
    },

    commands: [
        require('./commands/welcome'),
        require('./commands/testwelcome')
    ],
    events: [
        require('./events/guildMemberAdd')
    ],
    components: [
        require('./components/welcomeRouter')
    ]
};
