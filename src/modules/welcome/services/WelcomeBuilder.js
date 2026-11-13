const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    AttachmentBuilder,
    MessageFlags
} = require('discord.js');
const { fillPlaceholders } = require('../../../utils/placeholders');
const logger = require('../../../core/logger');
const { resolveWelcomeMedia, resolvePictureSource } = require('./welcomeMedia');
const { composeWelcomeCard } = require('./welcomeCard');
const { composeAvatarCard } = require('./avatarCard');
const { resolveInviteCredit } = require('./inviteCredit');
const { normalizeLayout } = require('./settings');

const CARD_ATTACHMENT = 'welcome-card.gif';

function parseColor(color) {
    if (typeof color === 'number') return color;
    if (typeof color === 'string') {
        const hex = color.replace('#', '');
        const parsed = parseInt(hex, 16);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
}

/**
 * Highest-quality URL for the joining member's own Discord avatar
 * (size 4096; keeps animated avatars intact). Returns null only if the
 * member object exposes no avatar method, so the welcome never breaks.
 */
function resolveAvatarURL(member) {
    try {
        const source = member?.user ?? member;
        if (typeof source?.displayAvatarURL === 'function') return source.displayAvatarURL({ size: 4096 });
        if (typeof member?.displayAvatarURL === 'function') return member.displayAvatarURL({ size: 4096 });
    } catch { /* fall through — thumbnail is optional */ }
    return null;
}

/**
 * Header thumbnail (the small square picture next to the title):
 *  - `thumbnail.url` / `thumbnail.path` when configured (e.g. the server logo),
 *  - otherwise the joining member's own avatar (the previous behaviour).
 * `thumbnail.enabled: false` removes it entirely.
 */
function resolveThumbnailURL(member, config, files) {
    if (config?.thumbnail?.enabled === false) return null;
    const configured = resolvePictureSource(config?.thumbnail, { files, prefix: 'thumb' });
    return configured || resolveAvatarURL(member);
}

/**
 * Banner image (the wide picture at the bottom of the message). The configured
 * `image.url` / `image.path` is the primary source; the legacy welcome card and
 * `gif` config remain as fallbacks so existing setups keep working.
 */
async function resolveMedia(member, config, files) {
    const banner = resolvePictureSource(config?.image, { files, prefix: 'banner' });
    if (banner) return { url: banner, nameInCard: false };

    // Legacy path: the animated welcome card with the member's name baked into
    // a throwaway copy of the GIF, then the configured GIF, then nothing.
    const card = config?.usernameInCard === false
        ? null
        : await composeWelcomeCard(member, config).catch(() => null);

    if (card) {
        files.push(new AttachmentBuilder(card, { name: CARD_ATTACHMENT }));
        return { url: `attachment://${CARD_ATTACHMENT}`, nameInCard: true };
    }

    const media = resolveWelcomeMedia(config);
    if (media) {
        files.push(...media.files);
        return { url: media.url, nameInCard: false };
    }

    return { url: null, nameInCard: false };
}

/**
 * In the card layout the message thumbnail is the SERVER icon (the image the
 * card is advertising), never the joining member's avatar.
 */
function resolveServerIconURL(member, config, files) {
    if (config?.card?.icon === false) return null;
    const configured = resolvePictureSource(config?.thumbnail, { files, prefix: 'icon' });
    if (configured) return configured;
    try {
        return member?.guild?.iconURL?.({ size: 256 }) || null;
    } catch {
        return null;
    }
}

/**
 * "Card" layout, top → bottom:
 *   greeting ("👋 Welcome, {displayname}")  [server icon]
 *   -# mention (the ping)
 *   [card image]
 *   ──────────
 *   -# invitedBy ("📨 Invited by @x")
 *   -# footer ("Enjoy your stay in YT HIVE.")
 * Every line above/below the image is Discord text — the artwork never carries
 * copy. `extra` carries resolved tokens such as {inviter}.
 */
async function buildCardPayload(member, config, extra = {}) {
    const container = new ContainerBuilder();
    const accent = parseColor(config.accentColor);
    if (accent !== null) container.setAccentColor(accent);

    const files = [];
    const expand = (value) => (typeof value === 'string' ? fillPlaceholders(value, member, extra).trim() : '');

    const greeting = expand(config.greeting);
    const mention = typeof config?.card?.mention === 'string'
        ? expand(config.card.mention)
        : fillPlaceholders('{mention}', member, extra);
    const icon = resolveServerIconURL(member, config, files);

    if (greeting) {
        const text = new TextDisplayBuilder().setContent(greeting);
        // A Section always needs an accessory, so the icon is only attached
        // when one resolvable exist; otherwise the line stands alone.
        if (icon) {
            container.addSectionComponents(
                new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(icon)
                )
            );
        } else {
            container.addTextDisplayComponents(text);
        }
    }

    if (mention) {
        const text = new TextDisplayBuilder().setContent(`-# ${mention}`);
        // The icon already decorates the greeting — never show it twice.
        if (!greeting && icon) {
            container.addSectionComponents(
                new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(icon)
                )
            );
        } else {
            container.addTextDisplayComponents(text);
        }
    }

    const card = await composeAvatarCard(member, config).catch((error) => {
        logger.warn(`Welcome card layout failed: ${error.message}. Falling back to the banner image.`);
        return null;
    });

    if (card) {
        files.push(new AttachmentBuilder(card.buffer, { name: card.name }));
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${card.name}`)
            )
        );
    } else {
        // Never send an empty container: fall back to the configured banner.
        const banner = resolvePictureSource(config?.image, { files, prefix: 'banner' });
        if (banner) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner))
            );
        } else {
            const media = resolveWelcomeMedia(config);
            if (media) {
                files.push(...media.files);
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(media.url))
                );
            }
        }
    }

    const invitedBy = expand(config.invitedBy);
    const footer = config?.footer?.enabled ? expand(config.footer.text) : '';

    if (invitedBy || footer) {
        if (config.separatorEnabled !== false) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
        }
        if (invitedBy) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${invitedBy}`));
        }
        if (footer) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
        }
    }

    if (container.components.length === 0) {
        throw new Error('the welcome card layout produced no content — configure card.background or image.url');
    }

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        // Same mention policy as the classic layout: only the joining member.
        allowedMentions: { parse: [], users: [member.id] },
        ...(files.length > 0 ? { files } : {})
    };
}

/**
 * Builds the welcome UI with Discord Components V2 (no embeds).
 * Used by BOTH the guildMemberAdd event and /testwelcome so the
 * preview is always identical to the real message.
 *
 * Layout (top → bottom), every block driven by config.yml so the copy can be
 * changed without touching this renderer:
 *
 *   # Title                     [thumbnail]
 *   ───────────────────────────────────────
 *   description   (greeting · body copy)
 *   ───────────────────────────────────────
 *   steps         ("GET STARTED" list)
 *   ───────────────────────────────────────
 *   outro         ("Enjoy your stay!")
 *   [banner image]
 *   ───────────────────────────────────────
 *   -# footer
 */
class WelcomeBuilder {
    static async build(member, config = {}) {
        // {inviter} is resolved once, only when a line actually asks for it.
        const extra = config?.invitedBy ? await resolveInviteCredit(member) : {};

        // "card" is the avatar card layout; anything else is the sectioned copy.
        if (normalizeLayout(config.layout) === 'card') return buildCardPayload(member, config, extra);

        const container = new ContainerBuilder();

        // Dividers between blocks, switchable from the /welcome panel.
        const showSeparators = config.separatorEnabled !== false;

        const accent = parseColor(config.accentColor);
        if (accent !== null) container.setAccentColor(accent);

        const text = (content) => new TextDisplayBuilder().setContent(content);
        const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
        const expand = (value) => {
            if (typeof value !== 'string') return '';
            return fillPlaceholders(value, member, extra).trim();
        };

        // Pictures may be remote URLs or local files uploaded as attachments,
        // so both are collected into one shared `files` array.
        const files = [];

        // Media is resolved first: whether the member's name is baked into the
        // card decides if the standalone greeting line would be a duplicate.
        const media = await resolveMedia(member, config, files);

        const blocks = [];
        const description = expand(config.description);
        if (description) blocks.push(description);

        // Legacy greeting line (the styled username under the card). Skipped
        // when the name already lives inside the welcome card image.
        const greeting = expand(config.greeting);
        if (greeting && !media.nameInCard) blocks.push(greeting);

        const steps = expand(config.steps);
        if (steps) blocks.push(steps);

        const outro = expand(config.outro);
        if (outro) blocks.push(outro);

        // Header: the title carries the thumbnail as its Section accessory.
        // Without a title the thumbnail attaches to the first body block
        // instead (a Section needs text next to its accessory).
        const title = expand(config.title);
        const thumbnailURL = resolveThumbnailURL(member, config, files);

        // A Section always needs an accessory, so it is only used when there is
        // a thumbnail to attach; otherwise the text renders on its own.
        if (thumbnailURL && title) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(text(`# ${title}`))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailURL))
            );
        } else if (title) {
            container.addTextDisplayComponents(text(`# ${title}`));
        } else if (thumbnailURL && blocks.length > 0) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(text(blocks.shift()))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailURL))
            );
        }

        for (const block of blocks) {
            if (showSeparators) container.addSeparatorComponents(divider());
            container.addTextDisplayComponents(text(block));
        }

        if (media.url) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(media.url)
                )
            );
        }

        if (config.footer?.enabled && config.footer?.text) {
            if (showSeparators) container.addSeparatorComponents(divider());
            container.addTextDisplayComponents(text(`-# ${expand(config.footer.text)}`));
        }

        return {
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            // Only the joining member may be pinged — never roles, staff,
            // @everyone or @here (the new member IS intentionally mentioned
            // in the intro line above).
            allowedMentions: { parse: [], users: [member.id] },
            ...(files.length > 0 ? { files } : {})
        };
    }
}

module.exports = WelcomeBuilder;
