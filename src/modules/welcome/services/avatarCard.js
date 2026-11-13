// "Card" welcome layout: one image with the member's avatar on the left and
// three configurable text lines on the right (heading / server name / member
// number), drawn on top of an admin-supplied background (PNG/JPG or animated
// GIF). Nothing on disk is ever modified — every card is rendered in memory.

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { GifUtil, GifFrame, BitmapImage, GifCodec } = require('gifwrap');
const logger = require('../../../core/logger');
const { fillPlaceholders } = require('../../../utils/placeholders');
const {
    toDrawable,
    loadFont,
    flattenFrames,
    buildTextSprite,
    outlineThickness
} = require('./welcomeCard');

const codec = new GifCodec();

// Bitmap fonts only exist at these sizes, so each line picks the biggest one
// that still fits its column.
const HEADING_FONTS = [Jimp.FONT_SANS_32_WHITE, Jimp.FONT_SANS_16_WHITE, Jimp.FONT_SANS_8_WHITE];
const TITLE_FONTS = [Jimp.FONT_SANS_64_WHITE, Jimp.FONT_SANS_32_WHITE, Jimp.FONT_SANS_16_WHITE];
const SUBTITLE_FONTS = [Jimp.FONT_SANS_32_WHITE, Jimp.FONT_SANS_16_WHITE, Jimp.FONT_SANS_8_WHITE];

// Used when no background is configured (or it cannot be loaded).
const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 400;
const FALLBACK_COLOR = 0x1b1f24ff;

// Guards against a huge animated background eating all memory / CPU.
const MAX_FRAMES = 40;
const MAX_WIDTH = 1400;

function parseHexColor(color, fallback) {
    const hex = typeof color === 'string' ? color.replace('#', '').trim() : '';
    if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
    return (parseInt(hex, 16) << 8 | 0xff) >>> 0;
}

function isGifBuffer(buffer) {
    return buffer.length > 6 && buffer.toString('ascii', 0, 3) === 'GIF';
}

/**
 * Reads the configured background: `path` (local, wins) then `url`.
 * Returns a Buffer or null — a broken background must never crash a welcome.
 */
async function readBackground(source) {
    const file = typeof source?.path === 'string' ? source.path.trim() : '';
    if (file) {
        try {
            const resolved = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return fs.readFileSync(resolved);
            logger.warn(`Welcome card: background not found:\n${file}`);
        } catch (error) {
            logger.warn(`Welcome card: background could not be read: ${error.message}`);
        }
    }

    const url = typeof source?.url === 'string' ? source.url.trim() : '';
    if (/^https?:\/\/\S+$/i.test(url)) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            logger.warn(`Welcome card: background download failed (${error.message}). Using a plain card instead.`);
        }
    }

    return null;
}

/**
 * Loads the background and flattens it into full frames. Animated GIFs stay
 * animated (up to MAX_FRAMES); everything else becomes a single static card.
 */
async function loadBackground(config) {
    const buffer = await readBackground(config?.card?.background);
    if (!buffer) return null;

    if (isGifBuffer(buffer)) {
        try {
            const source = await GifUtil.read(buffer);
            const animated = source.frames.length > 1
                && source.frames.length <= MAX_FRAMES
                && source.width <= MAX_WIDTH;
            return {
                animated,
                source,
                canvases: flattenFrames(source),
                width: source.width,
                height: source.height
            };
        } catch (error) {
            logger.warn(`Welcome card: background GIF could not be decoded: ${error.message}`);
        }
    }

    try {
        const image = await Jimp.read(buffer);
        const canvas = new BitmapImage({
            width: image.bitmap.width,
            height: image.bitmap.height,
            data: Buffer.from(image.bitmap.data)
        });
        // BitmapImage exposes dimensions only through `bitmap` — reading
        // `canvas.width` yields undefined and would silently fall back to the
        // 960x400 layout on a full-size canvas.
        return {
            animated: false,
            source: null,
            canvases: [canvas],
            width: image.bitmap.width,
            height: image.bitmap.height
        };
    } catch (error) {
        logger.warn(`Welcome card: background image could not be decoded: ${error.message}`);
        return null;
    }
}

/** Round mask with a one-pixel soft edge (no plugin dependency). */
function circleMask(image) {
    const { width, height, data } = image.bitmap;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(cx, cy);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const index = (y * width + x) * 4 + 3;
            if (distance > radius) data[index] = 0;
            else if (distance > radius - 1.5) {
                data[index] = Math.round(255 * Math.max(0, (radius - distance) / 1.5));
            }
        }
    }
    return image;
}

/**
 * Downloads the member's avatar and masks it into a circle. When the download
 * fails (offline, CDN hiccup) a solid accent circle keeps the card intact.
 */
async function loadAvatar(member, size, accentColor) {
    const url = member?.user?.displayAvatarURL?.({ extension: 'png', size: 512 });
    if (url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const image = await Jimp.read(Buffer.from(await response.arrayBuffer()));
            image.cover(size, size);
            return circleMask(image);
        } catch (error) {
            logger.warn(`Welcome card: avatar download failed (${error.message}). Using a placeholder.`);
        }
    }
    return circleMask(new Jimp(size, size, accentColor));
}

/** Font of the ladder whose size is closest to the wanted size. */
async function nearestFont(ladder, target) {
    let best = null;
    for (const key of ladder) {
        const font = await loadFont(key);
        const size = Number(font.info?.size) || 32;
        if (!best || Math.abs(size - target) < Math.abs(best.size - target)) best = { font, size };
    }
    return best.font;
}

/** Shrinks a text sprite proportionally so it never spills out of its column. */
function fitSprite(sprite, pad, maxWidth) {
    const inner = sprite.bitmap.width - pad * 2;
    if (inner <= maxWidth) return { sprite, pad };
    const factor = maxWidth / inner;
    return {
        sprite: sprite.resize(
            Math.max(1, Math.round(sprite.bitmap.width * factor)),
            Math.max(1, Math.round(sprite.bitmap.height * factor))
        ),
        pad: Math.round(pad * factor)
    };
}

/** The three configurable lines, placeholder-expanded and font-safe. */
function resolveLines(member, config) {
    const card = config?.card || {};
    const expand = (value) => (typeof value === 'string' ? fillPlaceholders(value, member).trim() : '');
    const heading = expand(card.heading);
    const title = expand(card.title ?? '{server}');
    const subtitle = expand(card.subtitle);

    // `size` is a fraction of the card height, so one config fits every artwork.
    const lines = [];
    if (heading) lines.push({ text: toDrawable(heading), fonts: HEADING_FONTS, size: 0.1 });
    if (title) lines.push({ text: toDrawable(title), fonts: TITLE_FONTS, size: 0.22 });
    if (subtitle) lines.push({ text: toDrawable(subtitle), fonts: SUBTITLE_FONTS, size: 0.095 });
    return lines.filter((line) => line.text.length > 0);
}

/** Rounded rectangle with a soft edge, used as the text scrim. */
function roundedPanel(width, height, radius, color) {
    const panel = new Jimp(width, height, color);
    const data = panel.bitmap.data;
    const r = Math.max(1, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
            const dy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
            if (dx <= 0 || dy <= 0) continue;
            const distance = Math.hypot(dx, dy);
            const index = (y * width + x) * 4 + 3;
            if (distance > r) data[index] = 0;
            else if (distance > r - 1.5) data[index] = Math.round(data[index] * ((r - distance) / 1.5));
        }
    }
    return panel;
}

/**
 * Draws scrim + ring + avatar + text into one transparent layer, so the
 * (possibly hundred-frame) background only gets a single composite per frame.
 */
async function buildOverlay({ width, height, avatar, avatarX, avatarY, avatarSize, lines, textX, textWidth, accentColor, scrimColor, borderColor = null }) {
    const overlay = new Jimp(width, height, 0x00000000);

    // Each line: font sized from the canvas height, then scaled to fit its
    // column. Every line is synthetically bolded (bitmap fonts have one weight).
    const sprites = [];
    for (const line of lines) {
        const font = await nearestFont(line.fonts, line.size * height);
        const bold = Math.max(1, Math.round((Number(font.info?.size) || 32) / 24));
        const { sprite, pad } = buildTextSprite(font, line.text, outlineThickness(font), bold);
        sprites.push(fitSprite(sprite, pad, textWidth));
    }

    const gap = Math.round(height * 0.035);
    const flows = sprites.map((entry) => entry.sprite.bitmap.height - entry.pad * 2);
    const total = flows.reduce((sum, flow) => sum + flow, 0) + gap * (sprites.length - 1);
    const top = Math.round((height - total) / 2);

    // The text block is centred in the column to the right of the avatar: left
    // aligned at `textX` it leaves a dead gap on wide artwork.
    const widest = Math.max(...sprites.map((entry) => entry.sprite.bitmap.width - entry.pad * 2));
    const rightEdge = width - Math.round(width * 0.05);
    const columnWidth = Math.max(widest, rightEdge - textX);
    const shift = Math.max(0, Math.round((columnWidth - widest) / 2));
    const drawX = textX + shift;

    if (scrimColor !== null) {
        const padX = Math.round(width * 0.03);
        const padY = Math.round(height * 0.075);
        const left = Math.round(drawX - padX);
        // Snug plate: the widest line plus padding, never wider than the canvas.
        const panelWidth = Math.min(Math.round(width * 0.975) - left, widest + padX * 2);
        const panelHeight = Math.min(height - Math.round(height * 0.045), Math.round(total + padY * 2));
        const panelTop = Math.round((height - panelHeight) / 2);
        const radius = Math.round(height * 0.06);
        if (panelWidth > 0 && panelHeight > 0) {
            if (borderColor !== null) {
                // 2px accent hairline: a slightly larger plate drawn underneath.
                const ring = 2;
                overlay.composite(
                    roundedPanel(panelWidth + ring * 2, panelHeight + ring * 2, radius + ring, borderColor),
                    left - ring,
                    panelTop - ring
                );
            }
            overlay.composite(roundedPanel(panelWidth, panelHeight, radius, scrimColor), left, panelTop);
        }
    }

    const ring = Math.max(2, Math.round(avatarSize * 0.03));
    overlay.composite(circleMask(new Jimp(avatarSize + ring * 2, avatarSize + ring * 2, accentColor)), avatarX - ring, avatarY - ring);
    overlay.composite(avatar, avatarX, avatarY);

    let y = top;
    sprites.forEach((entry, index) => {
        overlay.composite(entry.sprite, Math.round(drawX - entry.pad), Math.round(y - entry.pad));
        y += flows[index] + gap;
    });

    return overlay;
}

/**
 * Renders the "card" welcome image.
 * Returns { buffer, name } (GIF when the background animates, PNG otherwise)
 * or null when there is nothing to draw — callers must handle null.
 */
async function composeAvatarCard(member, config = {}) {
    const background = await loadBackground(config);
    const width = background?.width || FALLBACK_WIDTH;
    const height = background?.height || FALLBACK_HEIGHT;

    const lines = resolveLines(member, config);
    if (lines.length === 0) return null;

    const accentColor = parseHexColor(config.accentColor, 0x57f287ff);
    // Plate behind the text: `scrimColor` is the tint (dark violet by default
    // for the YT HIVE artwork) and `scrimOpacity` how solid it looks.
    const scrimOpacity = Math.min(1, Math.max(0, Number(config?.card?.scrimOpacity ?? 0.62)));
    const scrimTint = parseHexColor(config?.card?.scrimColor, 0x000000);
    const scrimColor = config?.card?.scrim === false
        ? null
        : (((((scrimTint >>> 8) & 0xffffff) << 8) | Math.round(scrimOpacity * 255)) >>> 0);
    // 2px accent hairline around the plate (off with `card.scrimBorder: false`).
    const borderColor = scrimColor === null || config?.card?.scrimBorder === false
        ? null
        : (((((accentColor >>> 8) & 0xffffff) << 8) | 150) >>> 0);

    const avatarSize = Math.round(Math.min(height * 0.52, width * 0.3));
    const avatarX = Math.round(width * 0.055);
    const avatarY = Math.round((height - avatarSize) / 2);
    const textX = avatarX + avatarSize + Math.round(width * 0.045);
    const textWidth = Math.max(80, width - textX - Math.round(width * 0.05));

    const avatar = await loadAvatar(member, avatarSize, accentColor);
    const overlay = await buildOverlay({
        width,
        height,
        avatar,
        avatarX,
        avatarY,
        avatarSize,
        lines,
        textX,
        textWidth,
        accentColor,
        scrimColor,
        borderColor
    });

    if (!background) {
        const canvas = new Jimp(width, height, FALLBACK_COLOR);
        canvas.composite(overlay, 0, 0);
        return { buffer: await canvas.getBufferAsync(Jimp.MIME_PNG), name: 'welcome-card.png' };
    }

    if (!background.animated) {
        const canvas = GifUtil.shareAsJimp(Jimp, background.canvases[0]);
        canvas.composite(overlay, 0, 0);
        // A photographic background is fully opaque, so the static card is sent
        // as high-quality JPEG — roughly 8x smaller than the same PNG.
        canvas.quality(92);
        return { buffer: await canvas.getBufferAsync(Jimp.MIME_JPEG), name: 'welcome-card.jpg' };
    }

    for (const canvas of background.canvases) {
        GifUtil.shareAsJimp(Jimp, canvas).composite(overlay, 0, 0);
    }

    // The ring, the mask and the text outline add anti-aliased colours: index
    // the frames (max 256 each) before GifFrame copies their pixels.
    await GifUtil.quantizeDekker(background.canvases, 255);

    const frames = background.canvases.map((canvas, index) => new GifFrame(canvas, {
        delayCentisecs: background.source.frames[index].delayCentisecs,
        disposalMethod: 1
    }));

    const gif = await codec.encodeGif(frames, { loops: background.source.loops });
    return { buffer: gif.buffer, name: 'welcome-card.gif' };
}

module.exports = { composeAvatarCard };
