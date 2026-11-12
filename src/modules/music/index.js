const { initLavalink } = require('./services/lavalinkManager');
const play = require('./commands/play');
const pause = require('./commands/pause');
const resume = require('./commands/resume');
const skip = require('./commands/skip');
const stop = require('./commands/stop');
const nowplaying = require('./commands/nowplaying');
const queue = require('./commands/queue');
const volume = require('./commands/volume');
const loop = require('./commands/loop');
const shuffle = require('./commands/shuffle');

module.exports = {
    name: 'music',
    commands: [
        play,
        pause,
        resume,
        skip,
        stop,
        nowplaying,
        queue,
        volume,
        loop,
        shuffle
    ],
    events: [],
    components: [],
    async initialize({ client }) {
        if (client.isReady()) {
            initLavalink(client);
        } else {
            client.once('ready', () => {
                initLavalink(client);
            });
        }
    }
};
