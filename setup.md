# Setup Guide — YT HIVE Discord Bot

Get your YT HIVE Bot online in a few simple steps.

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18+ (`node -v` to check) |
| **npm** | Bundled with Node.js |
| **MongoDB** | Local MongoDB (`mongodb://localhost:27017/yt_hive_bot`) or free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster |
| **Discord Account** | Developer permissions to create applications and invite bots |

---

## 2. Create Your Discord Application & Bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** → Name it **YT HIVE** (or your preferred name) → Click **Create**.
3. Go to **Bot** in the left sidebar:
   - Click **Reset Token** (or Copy Token). This is your `DISCORD_TOKEN`.
   - Scroll down to **Privileged Gateway Intents** and enable both:
     - ✅ **Server Members Intent** (Required for welcome, autorole, and invite tracking)
     - ✅ **Message Content Intent** (Required for automod and antilink)
   - Click **Save Changes**.
4. Go to **General Information** in the left sidebar:
   - Copy the **Application ID**. This is your `CLIENT_ID`.

---

## 3. Invite the Bot to Your Server

Generate an invite URL with required permissions (replace `YOUR_CLIENT_ID` with your Application ID):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

- `permissions=8` grants Administrator permissions (recommended so the bot can create ticket channels, manage roles, and delete messages).
- The bot role should be placed **above** the roles it assigns in your Discord server's **Server Settings → Roles**.

---

## 4. Configure Environment Variables (`.env`)

Open `.env` in the bot's root folder and fill in your details:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_server_guild_id_here
MONGODB_URI=mongodb://localhost:27017/yt_hive_bot
```

### How to get your Server (Guild) ID:
1. In Discord, go to **User Settings** → **Advanced** → Enable **Developer Mode**.
2. Right-click your Discord server icon in the left sidebar → Click **Copy Server ID**.
3. Paste it into `GUILD_ID`. (Using `GUILD_ID` ensures all 47 slash commands register instantly to your server without Discord's 1-hour global cache delay).

---

## 5. Configure Channels & Roles (`src/config/config.yml`)

Open `src/config/config.yml` to set up your server channel and role IDs:

### Tickets Setup (`tickets:`)
```yaml
tickets:
  enabled: true
  panel:
    channelId: "YOUR_SUPPORT_CHANNEL_ID"      # Channel where /ticket panel is posted
    title: "🎫 YT HIVE Support Center"
    description: "Need help? Select a category below.\nOur support team will assist you shortly."
  logs:
    enabled: true
    channelId: "YOUR_TICKET_LOGS_CHANNEL_ID"  # Channel where ticket transcripts & logs are sent
  support_role_id: "YOUR_SUPPORT_ROLE_ID"     # Role pinged when a new ticket is opened
  categories:
    general:
      name: "General Support"
      description: "Get help with general questions"
      emoji: "🎫"
      categoryId: "DISCORD_CATEGORY_ID_1"      # Discord category where tickets open
      staffRoleIds: ["YOUR_SUPPORT_ROLE_ID"]
    report:
      name: "Technical Support / Report"
      description: "Report an issue, user, or bug"
      emoji: "🛠️"
      categoryId: "DISCORD_CATEGORY_ID_2"
      staffRoleIds: ["YOUR_SUPPORT_ROLE_ID"]
    purchase:
      name: "Purchase / Donation Support"
      description: "Get help with purchases or donations"
      emoji: "💰"
      categoryId: "DISCORD_CATEGORY_ID_1"
      staffRoleIds: ["YOUR_SUPPORT_ROLE_ID"]
```

### Invite Tracking Setup (`invites:`)
```yaml
invites:
  enabled: true
  logChannelId: "YOUR_INVITE_LOGS_CHANNEL_ID" # Or leave empty to use logs.invite channel
  minAccountAgeDays: 3                        # Flags accounts under 3 days old as fake
  trackLeaves: true                           # Decrements active count when an invited member leaves
```

### Server Logs Setup (`logs:`)
```yaml
logs:
  enabled: true
  member: { enabled: true, channelId: "YOUR_MEMBER_LOGS_CHANNEL_ID" }
  message: { enabled: true, channelId: "YOUR_MESSAGE_LOGS_CHANNEL_ID" }
  voice: { enabled: true, channelId: "YOUR_VOICE_LOGS_CHANNEL_ID" }
  channel: { enabled: true, channelId: "YOUR_CHANNEL_LOGS_CHANNEL_ID" }
  role: { enabled: true, channelId: "YOUR_ROLE_LOGS_CHANNEL_ID" }
  moderation: { enabled: true, channelId: "YOUR_MOD_LOGS_CHANNEL_ID" }
  server: { enabled: true, channelId: "YOUR_SERVER_LOGS_CHANNEL_ID" }
  invite: { enabled: true, channelId: "YOUR_INVITE_LOGS_CHANNEL_ID" }
```

### Welcome Messages (`welcome:`)
```yaml
welcome:
  enabled: true
  channelId: "YOUR_WELCOME_CHANNEL_ID"
  layout: "card"                          # "card" = one generated image, "classic" = copy blocks
  accentColor: "#FF9F1C"                  # accent bar + avatar ring
  card:
    background:
      path: "./assets/welcome-yt-hive.png"   # local artwork (wins over url)
      url: ""
    heading: "WELCOME TO"
    title: "{server}"
    subtitle: "You are member #{membercount} of the hive"
    mention: "{mention}"                  # the ping above the card ("" = no ping)
    icon: true                            # server icon next to the mention line
    scrim: true                           # translucent panel behind the text
    scrimOpacity: 0.45
```
The card is rendered in memory for every join (avatar on the left, text on the right). Change `card.background.path` to swap the artwork — any PNG/JPG, or an animated GIF if you want it to move. `/welcome` edits all of this live per server.

---

## 6. Run the Bot

```bash
# Install dependencies (if not already installed)
npm install

# Start the bot
npm start

# Or run in development mode (with auto-restart)
npm run dev
```

### Healthy Startup Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        🤖 BOT INITIALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Loading modules...
...
📊 Total Commands Loaded: 47
📊 Total Events Loaded: 33
[INFO] Logged in as YT HIVE#0000!
✅ Successfully registered 47 slash commands.
```

---

## 7. First-Time In-Discord Setup

1. **Deploy Ticket Panel**:
   Go to your support channel and type:
   ```
   /ticket panel
   ```
   The bot will post the interactive Components V2 ticket panel with department select menus!

2. **Check Invites**:
   Type `/invites user` to check your personal invite stats or `/invites leaderboard` to view the top inviters in your server.

3. **Check Logs & Welcome**:
   Test welcome messages using `/testwelcome` or customize settings in real-time with `/welcome`.
