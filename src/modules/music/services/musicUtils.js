function formatDuration(ms) {
    if (!ms || isNaN(ms) || ms < 0) return '0:00';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    const s = seconds < 10 ? `0${seconds}` : `${seconds}`;
    if (hours > 0) {
        const m = minutes < 10 ? `0${minutes}` : `${minutes}`;
        return `${hours}:${m}:${s}`;
    }
    return `${minutes}:${s}`;
}

function createProgressBar(current, total, size = 15) {
    if (!total || isNaN(total) || total <= 0) return '🔘' + '▬'.repeat(size - 1);
    const progress = Math.min(Math.max(current / total, 0), 1);
    const progressIndex = Math.round(progress * (size - 1));

    let bar = '';
    for (let i = 0; i < size; i++) {
        if (i === progressIndex) {
            bar += '🔘';
        } else {
            bar += '▬';
        }
    }
    return bar;
}

module.exports = {
    formatDuration,
    createProgressBar
};
