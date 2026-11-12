const PRESET_COLORS = {
    blurple: 0x5865F2,
    red: 0xED4245,
    green: 0x57F287,
    yellow: 0xFEE75C,
    gold: 0xF1C40F,
    purple: 0x9B59B6,
    pink: 0xEB459E,
    cyan: 0x00AFF4,
    dark: 0x2B2D31,
    white: 0xFFFFFF
};

function resolveColor(input, defaultColor = 0x5865F2) {
    if (!input) return defaultColor;
    if (typeof input === 'number') return input;

    const str = String(input).trim().toLowerCase();
    if (PRESET_COLORS[str] !== undefined) {
        return PRESET_COLORS[str];
    }

    const hexMatch = str.match(/^#?([0-9a-f]{6})$/i);
    if (hexMatch) {
        return parseInt(hexMatch[1], 16);
    }

    return defaultColor;
}

module.exports = {
    resolveColor,
    PRESET_COLORS
};
